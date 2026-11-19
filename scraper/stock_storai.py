"""Наличие товаров в интернет-магазине Тив Таам (платформа Stor.ai) → таблица g_stock.

Сайт отвечает только израильским адресам — скрипт работает в задаче Cloud Run в Тель-Авиве.
Строго по robots.txt сайта: не чаще одного запроса в 4 секунды (Crawl-delay: 4), закрытые разделы не трогаем.
Один товар — один запрос по штрихкоду (массовую выгрузку сайт не отдаёт, и обходить это мы не будем).
Очередь из базы (g_stock_todo): сначала то, что сравнение может выбрать в корзину, потом остальной ассортимент.
Сохраняем пачками по 50 (g_stock_save), стоп при 403/429.

Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 scraper/stock_storai.py tivtaam
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HOURS = float(os.environ.get("STOCK_HOURS", "20"))  # сколько часов работать за запуск
UA = "Mozilla/5.0 (compatible; ProductInfoBot/1.0)"
# сеть → (сайт, retailer, branch интернет-магазина, пауза из robots.txt)
CHAINS = {
    "tivtaam": ("https://www.tivtaam.co.il", 1062, 924, 4.0),
}


def sb(fn, body):
    r = urllib.request.Request(f"{URL}/rest/v1/rpc/{fn}", method="POST", data=json.dumps(body).encode(),
                               headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read() or "null")


def check(chain, barcode):
    site, retailer, branch, _ = CHAINS[chain]
    q = urllib.parse.urlencode({"appId": 4, "barcode": barcode, "from": 0, "size": 1})
    r = urllib.request.Request(f"{site}/v2/retailers/{retailer}/branches/{branch}/products?{q}",
                               headers={"Accept": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(r, timeout=30) as resp:
        j = json.loads(resp.read())
    ps = j.get("products") or []
    if not ps:  # «не нашли» не считаем отсутствием: сайт может просто не отдавать нам данные
        return None
    p = ps[0]
    b = p.get("branch") or {}
    active = bool(b.get("isActive", True)) and bool(b.get("isVisible", True)) \
        and bool(b.get("isForSaleOnline", p.get("isForSaleOnline", True)))
    return {"barcode": barcode, "in_stock": active and not b.get("isOutOfStock", False), "active": active}


def main(chain):
    pause = max(CHAINS[chain][3], 4.0)
    end = time.time() + HOURS * 3600
    done = oos = empty_run = 0
    batch = []
    while time.time() < end:
        todo = sb("g_stock_todo", {"p_chain": chain, "p_limit": 500}) or []
        if not todo or empty_run >= 20:
            break
        for t in todo:
            if time.time() >= end:
                break
            time.sleep(pause)
            try:
                row = check(chain, t["barcode"])
            except urllib.error.HTTPError as e:
                if e.code in (403, 429, 503):
                    print(f"стоп: {e.code}", flush=True)
                    sb("g_stock_save", {"p_chain": chain, "p_rows": batch})
                    return
                continue
            except Exception as e:  # сеть/таймаут — пропускаем товар до следующего круга
                print(f"ошибка {t['barcode']}: {e}", flush=True)
                continue
            if row is None:
                empty_run += 1
                if empty_run >= 20:  # подряд пусто — сайт, похоже, не отдаёт нам данные; ничего не выдумываем
                    print("стоп: 20 пустых ответов подряд — сайт не отдаёт данные с этого адреса", flush=True)
                    break
                continue
            empty_run = 0
            batch.append(row); done += 1; oos += not row["in_stock"]
            if len(batch) >= 50:
                sb("g_stock_save", {"p_chain": chain, "p_rows": batch}); batch = []
                print(f"проверено {done}, нет в наличии {oos}", flush=True)
    if batch:
        sb("g_stock_save", {"p_chain": chain, "p_rows": batch})
    print(f"готово: проверено {done}, нет в наличии {oos}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "tivtaam")
