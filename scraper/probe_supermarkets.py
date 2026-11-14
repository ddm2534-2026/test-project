"""Разведка: можно ли брать акции супермаркетов из официальных файлов прозрачности цен.

По закону о продвижении конкуренции в пищевой отрасли (2014) сети с 3+ магазинами публикуют
XML-файлы цен (PriceFull) и акций (PromoFull). Скрипт для каждой сети:
  1) находит свежие PriceFull и PromoFull одного магазина;
  2) скачивает и разбирает их;
  3) считает акции и ищет среди них детские товары (подгузники, смеси, салфетки…).
Результат — research/supermarkets.md и research/supermarkets.json.

Сети:
  shufersal — портал prices.shufersal.co.il (ссылки на файлы в HTML-таблице);
  ramilevy, tivtaam — портал Cerberus (url.publishedprices.co.il), вход по имени без пароля.
"""

import gzip
import http.cookiejar
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
OUT = Path(__file__).resolve().parent.parent / "research"

# Слова, по которым узнаём детские товары в названиях (иврит)
BABY = ["חיתול", "האגיס", "פמפרס", "טיטולים", "מטרנה", "סימילאק", "נוטרילון", "אפטמיל", "מטרנה", "תמ\"ל", "תמל ",
        "מגבונים", "מגבוני", "תינוק", "תינוקות", "בייבי", "baby", "מוצץ", "בקבוק האכלה", "דייסה", "גרבר",
        "פרי מחית", "מחית", "ג'ונסון בייבי", "מוצצים", "פיפי", "לילדים", "צעצוע"]


def opener():
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    op.addheaders = [("User-Agent", UA)]
    return op


def get(op, url, data=None, timeout=90):
    if isinstance(data, dict):
        data = urllib.parse.urlencode(data).encode()
    with op.open(url, data=data, timeout=timeout) as r:
        return r.read()


def unpack(raw: bytes) -> bytes:
    if raw[:2] == b"\x1f\x8b":
        return gzip.decompress(raw)
    if raw[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(raw))
        return z.read(z.namelist()[0])
    return raw


def parse_xml(raw: bytes) -> ET.Element:
    raw = unpack(raw)
    # некоторые сети пишут encoding, которого нет на самом деле — снимаем декларацию
    text = raw.decode("utf-8", errors="replace") if raw[:3] != b"\xef\xbb\xbf" else raw[3:].decode("utf-8", "replace")
    text = re.sub(r"^\s*<\?xml[^>]*\?>", "", text)
    return ET.fromstring(text)


def low(el):  # поиск без учёта регистра тегов (у сетей Item/item, ItemCode/Itemcode…)
    for e in el.iter():
        e.tag = e.tag.split("}")[-1].lower()
    return el


def txt(el, tag):
    x = el.find(tag)
    return (x.text or "").strip() if x is not None and x.text else ""


def names_from_prices(root) -> dict:
    out = {}
    for it in root.iter("item"):
        code = txt(it, "itemcode")
        if code:
            out[code] = {"name": txt(it, "itemname") or txt(it, "itemnm"), "price": txt(it, "itemprice"),
                         "maker": txt(it, "manufacturername")}
    return out


def promos(root) -> list:
    res = []
    for p in root.iter("promotion"):
        items = [txt(i, "itemcode") for i in p.iter("item") if txt(i, "itemcode")]
        res.append({
            "id": txt(p, "promotionid"), "desc": txt(p, "promotiondescription"),
            "start": txt(p, "promotionstartdate"), "end": txt(p, "promotionenddate"),
            "min_qty": txt(p, "minqty"), "price": txt(p, "discountedprice"),
            "rate": txt(p, "discountrate"), "club": txt(p, "clubid"),
            "items": items,
        })
    return res


def show_structure(chain, root):
    p = next(root.iter("promotion"), None)
    if p is not None:
        print(f"[{chain}] первая акция:\n" + ET.tostring(p, encoding="unicode")[:1800])
    it = next(root.iter("item"), None)


def analyse(chain, price_root, promo_root, files) -> dict:
    names = names_from_prices(low(price_root))
    show_structure(chain, low(promo_root))
    pr = promos(low(promo_root))
    baby = []
    for p in pr:
        hits = [c for c in p["items"] if any(w.lower() in names.get(c, {}).get("name", "").lower() for w in BABY)]
        if hits or any(w.lower() in p["desc"].lower() for w in BABY):
            baby.append({**p, "sample_items": [names.get(c, {"name": c})["name"] for c in (hits or p["items"])[:3]],
                         "n_items": len(p["items"])})
    clubs = Counter(p["club"] or "—" for p in pr)
    return {
        "chain": chain, "ok": True, "files": files,
        "products_in_store": len(names), "promotions": len(pr),
        "promotion_items": sum(len(p["items"]) for p in pr),
        "with_price": sum(1 for p in pr if p["price"]), "with_rate": sum(1 for p in pr if p["rate"]),
        "club_ids": dict(clubs.most_common(5)),
        "baby_promotions": len(baby), "baby_examples": baby[:15],
        "example_promotions": [{k: p[k] for k in ("desc", "start", "end", "min_qty", "price", "club")} | {"n_items": len(p["items"])}
                               for p in pr[:5]],
    }


# ---------- Shufersal ----------
def shufersal() -> dict:
    op = opener()
    base = "https://prices.shufersal.co.il/FileObject/UpdateCategory"

    def links(cat):
        page = get(op, f"{base}?catID={cat}&storeId=0&page=1").decode("utf-8", "replace")
        return re.findall(r'href="(https://[^"]+?\.gz[^"]*)"', page)

    promo_links = [l.replace("&amp;", "&") for l in links(4)]   # 4 = PromoFull
    price_links = [l.replace("&amp;", "&") for l in links(2)]   # 2 = PriceFull
    if not promo_links or not price_links:
        raise RuntimeError(f"нет ссылок: promo {len(promo_links)}, price {len(price_links)}")
    # берём один и тот же магазин: номер в имени файла PromoFull7290027600007-001-...
    def store_of(u):
        m = re.search(r"Full\d+-(?:\d{3}-)?(\d{3})-\d{8}", u, re.I)
        return m.group(1) if m else None
    price_by_store = {store_of(u): u for u in price_links}
    promo = next((u for u in promo_links if store_of(u) in price_by_store), promo_links[0])
    price = price_by_store.get(store_of(promo), price_links[0])
    time.sleep(1)
    promo_root = parse_xml(get(op, promo, timeout=180))
    time.sleep(1)
    price_root = parse_xml(get(op, price, timeout=180))
    return analyse("shufersal", price_root, promo_root,
                   [urllib.parse.urlparse(promo).path.split("/")[-1], urllib.parse.urlparse(price).path.split("/")[-1]])


# ---------- Cerberus (Rami Levy, Tiv Taam) ----------
def cerberus(chain, user) -> dict:
    last = None
    for host in ("https://url.publishedprices.co.il", "https://url.retail.publishedprices.co.il"):
        try:
            op = opener()
            page = get(op, f"{host}/login").decode("utf-8", "replace")
            csrf = re.search(r'name="csrftoken"\s+content="([^"]+)"', page) or re.search(r'name="csrftoken"\s+value="([^"]+)"', page)
            form = {"username": user, "password": "", "Submit": "Sign in"}
            if csrf:
                form["csrftoken"] = csrf.group(1)
            get(op, f"{host}/login/user", form)
            page = get(op, f"{host}/file").decode("utf-8", "replace")
            csrf = re.search(r'name="csrftoken"\s+content="([^"]+)"', page)
            if not csrf:
                raise RuntimeError("не удалось войти (нет csrftoken на странице файлов)")
            token = csrf.group(1)

            def listing(search):
                raw = get(op, f"{host}/file/json/dir", {
                    "sEcho": 1, "iColumns": 5, "iDisplayStart": 0, "iDisplayLength": 100000,
                    "mDataProp_0": "fname", "sSearch": search, "cd": "/", "csrftoken": token})
                rows = [r for r in json.loads(raw).get("aaData", []) if r.get("fname")]
                return [r["fname"] for r in sorted(rows, key=lambda r: -int(r.get("size") or 0))]

            promos_ = listing("PromoFull")
            prices_ = listing("PriceFull")
            if not promos_ or not prices_:
                raise RuntimeError(f"файлы не найдены: PromoFull {len(promos_)}, PriceFull {len(prices_)}")

            def store_of(f):
                m = re.search(r"Full\d+-(?:\d{3}-)?(\d{3})-\d{8}", f, re.I)
                return m.group(1) if m else None
            price_by_store = {}
            for f in prices_:
                price_by_store.setdefault(store_of(f), f)
            promo = next((f for f in promos_ if store_of(f) in price_by_store), promos_[0])
            price = price_by_store.get(store_of(promo), prices_[0])
            time.sleep(1)
            promo_root = parse_xml(get(op, f"{host}/file/d/{promo}", timeout=180))
            time.sleep(1)
            price_root = parse_xml(get(op, f"{host}/file/d/{price}", timeout=180))
            res = analyse(chain, price_root, promo_root, [promo, price])
            res["host"] = host
            res["files_listed"] = {"PromoFull": len(promos_), "PriceFull": len(prices_)}
            return res
        except Exception as e:  # пробуем следующий адрес портала
            last = f"{host}: {e}"
    raise RuntimeError(last)


def main() -> int:
    results = []
    for chain, fn in [("shufersal", shufersal),
                      ("ramilevy", lambda: cerberus("ramilevy", "RamiLevi")),
                      ("tivtaam", lambda: cerberus("tivtaam", "TivTaam"))]:
        print(f"== {chain}")
        try:
            r = fn()
        except Exception as e:
            r = {"chain": chain, "ok": False, "error": str(e)[:400]}
        print(json.dumps({k: v for k, v in r.items() if k not in ("baby_examples",)}, ensure_ascii=False)[:1500])
        results.append(r)

    OUT.mkdir(exist_ok=True)
    (OUT / "supermarkets.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    md = ["# Супермаркеты: акции из файлов прозрачности цен", ""]
    for r in results:
        md.append(f"## {r['chain']}")
        if not r["ok"]:
            md += [f"❌ {r['error']}", ""]
            continue
        md += [f"- файлы: {', '.join(r['files'])}",
               f"- товаров в магазине: {r['products_in_store']}; акций: {r['promotions']} (товаров в акциях: {r['promotion_items']})",
               f"- с ценой по акции: {r['with_price']}; со скидкой в %: {r['with_rate']}; ClubId: {r['club_ids']}",
               f"- **акций на детские товары: {r['baby_promotions']}**", ""]
        for b in r["baby_examples"][:10]:
            md.append(f"  - {b['desc']} — {b['price'] or b['rate']} (мин. {b['min_qty']}, клуб {b['club'] or '—'}, "
                      f"{b['start'][:10]}–{b['end'][:10]}, товаров {b['n_items']}): {'; '.join(b['sample_items'])}")
        md.append("")
    (OUT / "supermarkets.md").write_text("\n".join(md))
    print("\n".join(md))
    return 0


if __name__ == "__main__":
    sys.exit(main())
