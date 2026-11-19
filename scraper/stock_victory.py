"""Наличие товаров в интернет-магазине Victory (victoryonline.co.il) → таблица g_stock (chain_id='victory').

По robots.txt сайта закрыт только /api — его не трогаем. Берём карту сайта (sitemap/products.xml) и страницы товаров:
в разметке schema.org у каждой есть sku (у фасованных это штрихкод) и availability (InStock / OutOfStock).
Пауза между страницами (по умолчанию 3 с; robots.txt её не задаёт). Честный user agent, стоп при 403/429.
Если страница отдалась без разметки товара — ничего не записываем (неизвестно ≠ нет в наличии).

Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 scraper/stock_victory.py [--limit N]
"""
import json, os, re, sys, time, urllib.error, urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SITE = "https://www.victoryonline.co.il"
PAUSE = max(2.0, float(os.environ.get("STOCK_PAUSE", "3")))
HOURS = float(os.environ.get("STOCK_HOURS", "20"))
UA = "Mozilla/5.0 (compatible; ProductInfoBot/1.0)"


def get(url):
    r = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "he-IL,he;q=0.9"})
    with urllib.request.urlopen(r, timeout=40) as resp:
        return resp.read().decode("utf-8", "replace")


def save(rows):
    if not rows:
        return
    r = urllib.request.Request(f"{URL}/rest/v1/rpc/g_stock_save", method="POST",
                               data=json.dumps({"p_chain": "victory", "p_rows": rows}).encode(),
                               headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    urllib.request.urlopen(r, timeout=120).read()


def product(page):
    for blk in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', page, re.S):
        try:
            j = json.loads(blk)
        except ValueError:
            continue
        for g in j.get("@graph", [j]) if isinstance(j, dict) else []:
            if g.get("@type") == "Product":
                return g
    return None


def main(argv):
    limit = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else None
    urls = re.findall(r"<loc>([^<]+)</loc>", get(f"{SITE}/sitemap/products.xml"))
    print(f"товаров в карте сайта: {len(urls)}", flush=True)
    if limit:
        urls = urls[:limit]
    end = time.time() + HOURS * 3600
    batch, done, oos, empty = [], 0, 0, 0
    for u in urls:
        if time.time() > end:
            break
        time.sleep(PAUSE)
        try:
            p = product(get(u))
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 503):
                print(f"стоп: {e.code}", flush=True)
                break
            continue
        except Exception as e:
            print(f"ошибка: {e}", flush=True)
            continue
        if not p:
            empty += 1
            if empty >= 20 and done == 0:
                print("стоп: страницы приходят без данных о товаре", flush=True)
                break
            continue
        sku = str(p.get("sku") or "")
        off = p.get("offers") or {}
        off = off[0] if isinstance(off, list) else off
        av = (off.get("availability") or "").rsplit("/", 1)[-1]
        if not re.fullmatch(r"\d{6,14}", sku) or av not in ("InStock", "OutOfStock"):
            continue
        batch.append({"barcode": sku, "in_stock": av == "InStock", "active": True})
        done += 1; oos += av == "OutOfStock"
        if len(batch) >= 50:
            save(batch); batch = []
            print(f"проверено {done}, нет в наличии {oos}", flush=True)
    save(batch)
    print(f"готово: проверено {done}, нет в наличии {oos}, страниц без данных {empty}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
