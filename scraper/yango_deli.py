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
import html, json, os, re, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone

BASE = "https://deli.yango.com"
URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PAUSE = max(1.5, float(os.environ.get("YANGO_PAUSE", "2")))
UA = "Mozilla/5.0 (compatible; ProductInfoBot/1.0)"


def get(url):
    r = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "he-IL,he;q=0.9"})
    with urllib.request.urlopen(r, timeout=40) as resp:
        return resp.read().decode("utf-8", "replace")


def sb(path, body, prefer=""):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    r = urllib.request.Request(f"{URL}/rest/v1/{path}", method="POST", data=json.dumps(body).encode(), headers=h)
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
    for blk in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', page, re.S):
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
    urls = goods_urls()
    print(f"товаров в карте сайта: {len(urls)}", flush=True)
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
    print("сопоставлено с нашими штрихкодами:", sb("rpc/g_yango_match", {"p_only_new": False}), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
