"""Ежедневная загрузка цен и акций супермаркетов в Supabase.

Источник — официальные файлы прозрачности цен (закон о конкуренции в пищевой отрасли, 2014).
Для каждой сети берём один магазин: онлайн-магазин, если сеть его публикует, иначе самый крупный.

  g_items        — товар по штрихкоду (общий для всех сетей);
  g_prices       — текущая цена в сети (+ история изменений пишется триггером в g_price_history);
  g_promos       — акции со структурой: тип выгоды, мин./макс. количество, цена/процент, клуб, купон, даты;
  g_promo_items  — какие товары входят в акцию.

Внутренние коды сетей (весовой товар, овощи без штрихкода) сохраняем с префиксом сети
(«ramilevy:1234»), чтобы они не путались между сетями.

Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python scraper/grocery_ingest.py [сеть …]
"""

import json
import os
import re
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_supermarkets import opener, get, parse_xml, low, txt  # noqa: E402
from save_to_db import Supabase  # noqa: E402

CHAINS = {
    # id: источник, имя входа (Cerberus), предпочтительный магазин (онлайн), если есть
    "shufersal": {"source": "shufersal", "store": "413"},
    "ramilevy": {"source": "cerberus", "user": "RamiLevi", "store": "039"},
    "tivtaam": {"source": "cerberus", "user": "TivTaam"},
    "yochananof": {"source": "cerberus", "user": "yohananof"},
    "osherad": {"source": "cerberus", "user": "osherad"},
}
CERBERUS = "https://url.publishedprices.co.il"
MAX_PROMO_ITEMS = 300   # «5% на всю марку» и общие купоны на тысячи товаров корзине не помогают
FILE_RE = re.compile(r"Full\d+-(?:\d{3}-)?(\d{3,4})-(\d{8})", re.I)


# ---------- скачивание ----------
def cerberus_files(user):
    op = opener()
    page = get(op, f"{CERBERUS}/login").decode("utf-8", "replace")
    m = re.search(r'name="csrftoken"\s+(?:content|value)="([^"]+)"', page)
    form = {"username": user, "password": "", "Submit": "Sign in"}
    if m:
        form["csrftoken"] = m.group(1)
    get(op, f"{CERBERUS}/login/user", form)
    page = get(op, f"{CERBERUS}/file").decode("utf-8", "replace")
    token = re.search(r'name="csrftoken"\s+content="([^"]+)"', page).group(1)
    raw = get(op, f"{CERBERUS}/file/json/dir", {
        "sEcho": 1, "iColumns": 5, "iDisplayStart": 0, "iDisplayLength": 100000,
        "mDataProp_0": "fname", "sSearch": "", "cd": "/", "csrftoken": token})
    rows = [r for r in json.loads(raw).get("aaData", []) if r.get("fname")]
    return op, rows


def pick_cerberus(rows, store=None):
    """Возвращает (store, price_file, promo_file) — самые свежие полные файлы одного магазина."""
    recent = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y%m%d")
    files = []
    for r in rows:
        m = FILE_RE.search(r["fname"])
        if m and m.group(2) >= recent:
            kind = "price" if r["fname"].lower().startswith("pricefull") else (
                "promo" if r["fname"].lower().startswith("promofull") else None)
            if kind:
                files.append({"kind": kind, "store": m.group(1), "name": r["fname"], "size": int(r.get("size") or 0)})
    if not store:  # самый крупный магазин по размеру файла цен
        prices = sorted([f for f in files if f["kind"] == "price"], key=lambda f: -f["size"])
        if not prices:
            raise RuntimeError("нет свежих файлов PriceFull")
        store = prices[0]["store"]

    def latest(kind):
        c = sorted([f["name"] for f in files if f["kind"] == kind and f["store"] == store],
                   key=lambda n: re.sub(r"\D", "", n.split("-", 1)[1]))
        return c[-1] if c else None
    return store, latest("price"), latest("promo")


def fetch_chain(chain_id, cfg):
    if cfg["source"] == "shufersal":
        op = opener()
        base = "https://prices.shufersal.co.il/FileObject/UpdateCategory"

        def link(cat):
            page = get(op, f"{base}?catID={cat}&storeId={cfg['store']}").decode("utf-8", "replace")
            ls = [x.replace("&amp;", "&") for x in re.findall(r'href="(https://[^"]+?\.gz[^"]*)"', page)]
            if not ls:
                raise RuntimeError(f"Shufersal: нет файла категории {cat} для магазина {cfg['store']}")
            return ls[0]
        price_url, promo_url = link(2), link(4)
        price_root = parse_xml(get(op, price_url, timeout=300))
        time.sleep(1)
        promo_root = parse_xml(get(op, promo_url, timeout=300))
        return cfg["store"], price_root, promo_root, price_url.split("?")[0].rsplit("/", 1)[-1]

    op, rows = cerberus_files(cfg["user"])
    store, price_name, promo_name = pick_cerberus(rows, cfg.get("store"))
    if not price_name:
        raise RuntimeError(f"нет файла цен для магазина {store}")
    price_root = parse_xml(get(op, f"{CERBERUS}/file/d/{price_name}", timeout=300))
    promo_root = None
    if promo_name:
        time.sleep(1)
        promo_root = parse_xml(get(op, f"{CERBERUS}/file/d/{promo_name}", timeout=300))
    return store, price_root, promo_root, price_name


# ---------- разбор ----------
def num(s):
    try:
        return float(s.replace(",", "")) if s not in (None, "") else None
    except ValueError:
        return None


def when(date_s, time_s=""):
    """'2026-11-14T00:00:00.000' / '2026-11-14' + '23:59' → строка времени по Израилю."""
    if not date_s:
        return None
    d = date_s.replace("T", " ")[:19]
    if len(d) == 10:
        d += " " + ((time_s or "00:00:00")[:8] if time_s else "00:00:00")
    return d + "+02:00"


def item_key(chain_id, code, item_type):
    code = code.lstrip("0") if len(code) > 13 else code
    if item_type == "0" or len(code) < 8:
        return f"{chain_id}:{code}"
    return code


def parse_prices(chain_id, root):
    items = {}
    for it in low(root).iter("item"):
        code = txt(it, "itemcode")
        price = num(txt(it, "itemprice"))
        if not code or price is None or price <= 0:
            continue
        key = item_key(chain_id, code, txt(it, "itemtype"))
        items[key] = {
            "code": code, "barcode": key,
            "name": txt(it, "itemname") or txt(it, "itemnm") or code,
            "maker": txt(it, "manufacturername") or None,
            "quantity": num(txt(it, "quantity")),
            "unit": txt(it, "unitofmeasure") or txt(it, "unitqty") or None,
            "is_weighted": txt(it, "bisweighted") in ("1", "true"),
            "price": price,
            "unit_price": num(txt(it, "unitofmeasureprice")),
            "price_updated_at": when(txt(it, "priceupdatedate")),
        }
    return items


def parse_promos(chain_id, root, code_to_key):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    promos, links = [], []
    if root is None:
        return promos, links
    for p in low(root).iter("promotion"):
        pid = txt(p, "promotionid")
        rows = list(p.iter("promotionitem")) or list(p.iter("item"))
        codes = [txt(i, "itemcode") for i in rows if txt(i, "itemcode")]
        if not pid or not codes or len(codes) > MAX_PROMO_ITEMS:
            continue
        ends = when(txt(p, "promotionenddate") or txt(p, "promotionenddatetime"), txt(p, "promotionendhour"))
        if ends and ends[:10] < now:
            continue
        first = rows[0]
        group = p.find(".//group")
        club = txt(p, "clubid")
        promo = {
            "chain_id": chain_id, "promo_id": pid,
            "description": txt(p, "promotiondescription"),
            "starts_at": when(txt(p, "promotionstartdate") or txt(p, "promotionstartdatetime"), txt(p, "promotionstarthour")),
            "ends_at": ends,
            "reward_type": int(num(txt(p, "rewardtype") or txt(first, "rewardtype")) or 0) or None,
            "min_qty": num(txt(p, "minqty") or txt(first, "minqty")),
            "max_qty": num(txt(p, "maxqty") or txt(first, "maxqty")),
            "discounted_price": num(txt(p, "discountedprice") or txt(first, "discountedprice")),
            "price_per_unit": num(txt(p, "discountedpricepermida") or txt(first, "discountedpricepermida")),
            "discount_rate": num(txt(p, "discountrate") or txt(first, "discountrate")),
            "min_purchase": num(txt(p, "minpurchaseamount") or (txt(group, "minpurchaseamount") if group is not None else "")),
            "club": club or None,
            "is_club": bool(club) and not club.strip().startswith("0"),
            "is_coupon": txt(p, "additionaliscoupon") == "1",
            "is_gift": txt(p, "isgiftitem") == "1",
            "allow_multiple": txt(p, "allowmultiplediscounts") == "1",
            "n_items": len(codes),
        }
        promos.append(promo)
        seen = set()
        for i in rows:
            code = txt(i, "itemcode")
            key = code_to_key.get(code)
            if not key or key in seen:  # товара нет в нашем магазине — пропускаем
                continue
            seen.add(key)
            links.append({
                "chain_id": chain_id, "promo_id": pid, "barcode": key,
                "discounted_price": num(txt(i, "discountedprice")) if i is not p else promo["discounted_price"],
                "price_per_unit": num(txt(i, "discountedpricepermida")) if i is not p else promo["price_per_unit"],
                "discount_rate": num(txt(i, "discountrate")) if i is not p else promo["discount_rate"],
                "min_qty": num(txt(i, "minqty")) or promo["min_qty"],
            })
    # акции, у которых в нашем магазине не осталось ни одного товара, не нужны
    used = {l["promo_id"] for l in links}
    return [p for p in promos if p["promo_id"] in used], links


# ---------- запись ----------
def save(db, chain_id, store, items, promos, links, file_name):
    run = datetime.now(timezone.utc).isoformat()
    db.upsert("g_items", [{"barcode": i["barcode"], "name": i["name"], "maker": i["maker"], "quantity": i["quantity"],
                           "unit": i["unit"], "is_weighted": i["is_weighted"], "updated_at": run}
                          for i in items.values()], "barcode")
    db.upsert("g_prices", [{"chain_id": chain_id, "barcode": i["barcode"], "name": i["name"], "price": i["price"],
                            "unit_price": i["unit_price"], "unit_of_measure": i["unit"],
                            "price_updated_at": i["price_updated_at"], "seen_at": run}
                           for i in items.values()], "chain_id,barcode")
    # товары, которых сегодня нет в файле — убираем из текущих цен (история остаётся)
    db.request("DELETE", f"/g_prices?chain_id=eq.{chain_id}&seen_at=lt.{run.replace('+', '%2B')}", prefer="return=minimal")
    # акции — полностью заменяем свежим снимком
    db.request("DELETE", f"/g_promos?chain_id=eq.{chain_id}", prefer="return=minimal")
    db.upsert("g_promos", promos, "chain_id,promo_id")
    db.upsert("g_promo_items", links, "chain_id,promo_id,barcode")
    db.request("PATCH", f"/g_chains?id=eq.{chain_id}", {
        "store_id": store, "store_name": file_name, "is_online": chain_id in ("shufersal", "ramilevy"),
        "prices_at": run, "promos_at": run, "updated_at": run}, "return=minimal")


def main(argv):
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    db = Supabase(url, key) if url and key else None
    wanted = argv or list(CHAINS)
    failed = []
    for chain_id in wanted:
        t0 = time.time()
        try:
            store, price_root, promo_root, fname = fetch_chain(chain_id, CHAINS[chain_id])
            items = parse_prices(chain_id, price_root)
            code_to_key = {i["code"]: k for k, i in items.items()}
            promos, links = parse_promos(chain_id, promo_root, code_to_key)
            kinds = {}
            for p in promos:
                kinds[p["reward_type"]] = kinds.get(p["reward_type"], 0) + 1
            print(f"{chain_id}: магазин {store} ({fname}) — товаров {len(items)}, акций {len(promos)} "
                  f"(клубных {sum(p['is_club'] for p in promos)}, купонов {sum(p['is_coupon'] for p in promos)}, "
                  f"типы {kinds}), связей {len(links)}")
            if db:
                save(db, chain_id, store, items, promos, links, fname)
                print(f"  записано в базу за {time.time() - t0:.0f} c")
        except Exception:
            failed.append(chain_id)
            print(f"{chain_id}: ОШИБКА\n" + traceback.format_exc()[-1500:])
    if failed:
        print("Не загрузились:", ", ".join(failed))
    return 1 if len(failed) == len(wanted) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
