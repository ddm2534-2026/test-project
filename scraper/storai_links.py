"""Номера товаров на сайтах Тив Таам и Кешет (платформа Stor.ai): штрихкод → catalogProduct.

Нужны, чтобы кнопка «На сайте» в корзине Sali вела прямо в карточку товара.
API сетей отвечает только с израильских адресов, поэтому скрипт запускается на израильской машине.

Бережно: один запрос в секунду, не больше LIMIT товаров за запуск, останавливается
при первом отказе сети (403/429). Берёт из базы то, что нужно проверить (сначала товары,
по которым нажимали на сайте, потом товары под рецепты), и записывает найденные номера.

Запуск (только стандартная библиотека Python 3):
    SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 storai_links.py
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
LIMIT = int(os.environ.get("STORAI_LIMIT", "300"))
PAUSE = float(os.environ.get("STORAI_PAUSE", "1.0"))

# сайт сети → номера магазина в API Stor.ai (видны в запросах самого сайта)
CHAINS = {
    "tivtaam": ("https://www.tivtaam.co.il", 1062, 924),
    "keshet": ("https://www.keshet-teamim.co.il", 1219, 2585),
}
UA = "Mozilla/5.0 (compatible; SaliLinks/1.0; +https://ddm2534-2026.github.io/test-project/privacy.html)"


def sb(fn, body):
    r = urllib.request.Request(f"{URL}/rest/v1/rpc/{fn}", method="POST", data=json.dumps(body).encode(),
                               headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read() or "null")


def lookup(chain, barcode):
    site, retailer, branch = CHAINS[chain]
    q = urllib.parse.urlencode({"appId": 4, "barcode": barcode, "from": 0, "size": 1})
    r = urllib.request.Request(f"{site}/v2/retailers/{retailer}/branches/{branch}/products?{q}",
                               headers={"Accept": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(r, timeout=20) as resp:
        data = json.loads(resp.read())
    for p in data.get("products") or []:
        if p.get("productId"):
            return int(p["productId"])
    return None


def main():
    todo = sb("storai_todo", {"p_limit": LIMIT}) or []
    print(f"к проверке: {len(todo)}")
    done, found, batch = 0, 0, []
    for row in todo:
        chain, barcode = row["chain"], row["barcode"]
        if chain not in CHAINS:
            continue
        try:
            pid = lookup(chain, barcode)
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                print(f"сеть {chain} ответила {e.code} — останавливаемся")
                break
            print(f"{chain} {barcode}: HTTP {e.code}")
            pid = None
        except Exception as e:  # сеть, таймаут — пропускаем, проверим в следующий раз
            print(f"{chain} {barcode}: {e}")
            time.sleep(PAUSE)
            continue
        batch.append({"chain": chain, "barcode": barcode, "product_id": pid})
        done += 1
        found += pid is not None
        if len(batch) >= 50:
            sb("storai_put", {"p_rows": batch})
            batch = []
        time.sleep(PAUSE)
    if batch:
        sb("storai_put", {"p_rows": batch})
    print(f"проверено {done}, найдено {found}")


if __name__ == "__main__":
    sys.exit(main())
