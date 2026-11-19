"""Каталог Yango Deli (экспресс-доставка) → таблица g_yango_items, затем сопоставление с нашими штрихкодами (g_yango_match).

По robots.txt сайта (https://deli.yango.com/robots.txt):
  - берём только карту сайта и страницы товаров /he-il/good/… (разрешены);
  - не трогаем /api/, корзину, адреса и URL с параметрами (запрещены);
  - пауза между страницами (по умолчанию 2 с), честный user agent без названия проекта.
Цены у Yango Deli одинаковые на всех складах, наличие зависит от склада (мы видим склад «по умолчанию»).
Данные берём из разметки schema.org (Product/Offer) и старую цену — из данных той же страницы.
Фото не сохраняем. Стоп при 403/429.

Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 scraper/yango_deli.py [--limit N]
"""
import html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from grocery_categories import classify  # noqa: E402
from datetime import datetime, timedelta, timezone

BASE = "https://deli.yango.com"
URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PAUSE = max(1.5, float(os.environ.get("YANGO_PAUSE", "2")))
UA = "Mozilla/5.0 (compatible; ProductInfoBot/1.0)"


def get(url):
    r = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "he-IL,he;q=0.9"})
    with urllib.request.urlopen(r, timeout=40) as resp:
        return resp.read().decode("utf-8", "replace")


def sb(path, body, prefer="", method="POST"):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    r = urllib.request.Request(f"{URL}/rest/v1/{path}", method=method, data=None if body is None else json.dumps(body).encode(), headers=h)
    with urllib.request.urlopen(r, timeout=120) as resp:
        t = resp.read()
        return json.loads(t) if t else None


def goods_urls():
    idx = get(f"{BASE}/sitemap.xml")
    urls = []
    for sm in re.findall(r"<loc>([^<]+)</loc>", idx):
        if "catalog" not in sm:
            continue
        time.sleep(PAUSE)
        urls += [u for u in re.findall(r"<loc>([^<]+)</loc>", get(sm)) if "/good/" in u]
    # карта сайта на английском — берём ивритскую версию страницы (названия как на чеках и в наших данных)
    return sorted({re.sub(r"^https://deli\.yango\.com/[a-z]{2}-[a-z]{2}/", f"{BASE}/he-il/", u) for u in urls})


UNITS = [  # (регулярка единицы, вид, множитель)
    (r'ק"ג|ק״ג|קג|קילו', "г", 1000), (r"ג'|גר(?:ם)?|ג(?=\b|$)", "г", 1),
    (r"ל'|ליטר", "мл", 1000), (r'מ"ל|מ״ל|מל', "мл", 1), (r"יח'|יחידות|יח", "шт", 1),
]


def pack(t):
    if not t:
        return None, None
    t = t.replace("×", "x").replace(",", ".")
    m = re.search(r"(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*(" + "|".join(u for u, _, _ in UNITS) + ")", t)
    if not m:
        return None, None
    for u, kind, mul in UNITS:
        if re.fullmatch(u, m.group(3)):
            return round(float(m.group(2)) * mul * (int(m.group(1)) if m.group(1) else 1), 2), kind
    return None, None


def parse(page, url):
    prod = None
    for blk in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', page, re.S):
        try:
            j = json.loads(blk)
        except ValueError:
            continue
        for g in j.get("@graph", [j]):
            if g.get("@type") == "Product":
                prod = g
    if not prod:
        return None
    off = prod.get("offers") or {}
    off = off[0] if isinstance(off, list) else off
    amount = (prod.get("weight") or {}).get("value")
    yid = prod.get("@id")
    old = None
    if yid:
        p = page.replace('\\"', '"')
        i = p.find(f'"id":"{yid}"')
        m = re.search(r'"oldPrice":(\d+(?:\.\d+)?)', p[i:i + 3000]) if i >= 0 else None
        old = float(m.group(1)) if m else None
    until = re.search(r"בתוקף עד (\d{1,2})\.(\d{1,2})\.(\d{4})", prod.get("description") or "")
    pa, pk = pack(amount)
    price = off.get("price")
    return {
        "slug": url.rsplit("/good/", 1)[1], "yid": yid, "name": html.unescape(prod.get("name") or "").strip(),
        "brand": ((prod.get("brand") or {}).get("name") or None), "amount_text": amount,
        "pack_amount": pa, "pack_kind": pk, "price": float(price) if price is not None else None,
        "old_price": old if old and price and old > float(price) else None,
        "promo_until": f"{until.group(3)}-{int(until.group(2)):02d}-{int(until.group(1)):02d}" if until else None,
        "in_stock": (off.get("availability") or "").endswith("InStock"),
        "seen_at": datetime.now(timezone.utc).isoformat(),
    }


def save(rows):
    if rows:
        sb("g_yango_items?on_conflict=slug", rows, "resolution=merge-duplicates,return=minimal")


def main(argv):
    limit = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else None
    run = datetime.now(timezone.utc).isoformat()
    if "--sync-only" in argv:  # только перенести уже собранное в «сеть» yango
        sb("rpc/g_yango_match", {"p_only_new": True})
        return sync(run, (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat())
    urls = goods_urls()
    print(f"товаров в карте сайта: {len(urls)}", flush=True)
    # продолжение после обрыва: что уже собрано за последние 20 часов, второй раз не открываем
    since = (datetime.now(timezone.utc) - timedelta(hours=20)).isoformat()
    fresh, off = set(), 0
    while True:
        part = sb_get(f"g_yango_items?select=slug&seen_at=gte.{urllib.parse.quote(since)}&order=slug&offset={off}&limit=1000")
        fresh |= {r["slug"] for r in part}; off += 1000
        if len(part) < 1000:
            break
    urls = [u for u in urls if u.rsplit("/good/", 1)[1] not in fresh]
    print(f"уже собрано за сутки: {len(fresh)}, осталось: {len(urls)}", flush=True)
    if limit:
        urls = urls[:limit]
    batch, ok, miss = [], 0, 0
    for k, u in enumerate(urls, 1):
        time.sleep(PAUSE)
        try:
            page = get(u)
            row = parse(page, u)
            if not row and miss < 2:
                print(f"нет карточки: {u} · {len(page)} байт · ld+json: {page.count('application/ld+json')} · <title>{(re.search(r'<title>(.*?)</title>', page, re.S) or [None, ''])[1][:120]}", flush=True)
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 503):
                print(f"стоп: {e.code} на {u}", flush=True)
                break
            miss += 1
            continue
        except Exception as e:  # сеть, таймаут — пропускаем страницу
            print(f"ошибка {u}: {e}", flush=True)
            miss += 1
            continue
        if row and row["name"]:
            batch.append(row); ok += 1
        else:
            miss += 1
        if len(batch) >= 50:
            save(batch); batch = []
            print(f"{k}/{len(urls)}: сохранено {ok}, пропущено {miss}", flush=True)
    save(batch)
    print(f"готово: {ok} товаров, пропущено {miss}", flush=True)
    try:
        print("сопоставлено с нашими штрихкодами:", sb("rpc/g_yango_match", {"p_only_new": False}), flush=True)
    except urllib.error.HTTPError as e:
        print("сопоставление не запустилось:", e.code, e.read()[:300], flush=True)
        sys.exit(1)
    if not limit:  # пробный прогон на части каталога не должен стирать остальные цены
        sync(run, since)


def sb_get(path):
    r = urllib.request.Request(f"{URL}/rest/v1/{path}", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())


def sync(run, since=None):
    """Yango как «сеть» yango: цена под нашим штрихкодом (если сопоставлен) или под собственным кодом yango:<slug>,
    несопоставленные товары заводятся в g_items (дальше их раскладывает по справочнику общая классификация)."""
    rows, off = [], 0
    while True:
        part = sb_get(f"g_yango_items?select=slug,name,brand,amount_text,pack_amount,pack_kind,price,barcode"
                      f"&price=gt.0&seen_at=gte.{urllib.parse.quote(since or run)}&order=slug&offset={off}&limit=1000")
        rows += part; off += 1000
        if len(part) < 1000:
            break
    items, prices = [], {}
    for y in rows:
        code = y["barcode"] or f"yango:{y['slug']}"
        if not y["barcode"]:
            full = f"{y['name']} {y['amount_text'] or ''}".strip()
            items.append({"barcode": code, "name": full, "name_norm": full, "maker": y["brand"], "quantity": y["pack_amount"],
                          "unit": y["amount_text"], "is_weighted": False, "pack_amount": y["pack_amount"], "pack_kind": y["pack_kind"],
                          "category": classify(full), "updated_at": run})
        p = prices.get(code)
        if not p or y["price"] < p["price"]:
            prices[code] = {"chain_id": "yango", "barcode": code, "name": y["name"], "price": y["price"], "seen_at": run, "price_updated_at": run}
    for i in range(0, len(items), 500):
        sb("g_items?on_conflict=barcode", items[i:i + 500], "resolution=merge-duplicates,return=minimal")
    pl = list(prices.values())
    for i in range(0, len(pl), 500):
        sb("g_prices?on_conflict=chain_id,barcode", pl[i:i + 500], "resolution=merge-duplicates,return=minimal")
    # чего сегодня не было (пропало с сайта или теперь сопоставлено с нашим штрихкодом) — убираем из текущих цен
    sb(f"g_prices?chain_id=eq.yango&seen_at=lt.{urllib.parse.quote(run)}", None, "return=minimal", "DELETE")
    sb("g_chains?id=eq.yango", {"prices_at": run, "updated_at": run}, "return=minimal", "PATCH")
    print(f"сеть yango: {len(pl)} цен, своих товаров {len(items)}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
