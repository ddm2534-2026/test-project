"""Состав, аллергены, пищевая ценность и кашрут с карточек товаров Шуферсаль Онлайн → таблица g_item_info.

Сайт Шуферсаля открывается только из Израиля, поэтому скрипт запускается на израильской машине.

Строго по robots.txt сайта (https://www.shufersal.co.il/robots.txt):
  - не чаще одной страницы в 10 секунд (Crawl-delay: 10, Request-rate: 1/10);
  - только с 04:00 до 08:45 UTC (Visit-time: 0400-0845) — вне окна скрипт сразу выходит,
    а внутри окна останавливается, когда оно закончилось;
  - ходим только на карточки товаров /online/he/p/…, корзину, поиск и личный кабинет не трогаем.
Честный user agent со ссылкой на страницу проекта. При 403/429 или странице техработ — останавливается до следующего запуска.

Очередь берётся из базы (shuf_info_todo): сначала товары, привязанные к нашим продуктам, потом остальные.
Найденное сохраняется пачками (shuf_info_save), так что прерванный запуск ничего не теряет.

Запуск (только стандартная библиотека Python 3), раз в сутки cron'ом, например в 04:05 UTC:
    5 4 * * *  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python3 /path/shufersal_info.py >> shufersal_info.log 2>&1
"""
import html, json, os, re, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PAUSE = max(10.0, float(os.environ.get("SHUF_PAUSE", "10")))  # меньше 10 с robots.txt не разрешает
LIMIT = int(os.environ.get("SHUF_LIMIT", "1700"))
WINDOW = ((4, 0), (8, 45))  # UTC, из robots.txt
UA = "Mozilla/5.0 (compatible; SaliInfo/1.0; +https://ddm2534-2026.github.io/test-project/privacy.html)"


def sb(fn, body):
    r = urllib.request.Request(f"{URL}/rest/v1/rpc/{fn}", method="POST", data=json.dumps(body).encode(),
                               headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read() or "null")


def in_window():
    n = datetime.now(timezone.utc)
    return WINDOW[0] <= (n.hour, n.minute) < WINDOW[1]


def page_code(b):
    # как на сайте: товары с префиксом 729000 — без «729000» и ведущих нулей (7290000000046 → 46)
    return str(int(b[6:])) if re.fullmatch(r"729000\d{7}", b) else b


def text(s):
    s = re.sub(r"<br\s*/?>", ", ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(re.sub(r"\s+", " ", s)).strip(" ,")
    return re.sub(r"\s*,\s*,\s*", ", ", s) or None


def block(page, cls):
    # содержимое <div class="cls"> до закрывающего </div> (внутри этих блоков нет вложенных div)
    m = re.search(rf'<div class="{cls}"[^>]*>(.*?)</div>', page, re.S)
    return text(m.group(1)) if m else None


def parse(page):
    i = page.find('<ul class="productContainer"')
    if i < 0:
        return None
    j = page.find('legalNotes', i)
    p = page[i:j if j > 0 else i + 60000]
    data = {}
    dl = re.search(r'<ul class="dataList">(.*?)</ul>', p, re.S)
    for name, val in re.findall(r'<div class="name">(.*?)</div>\s*<div class="text[^"]*"[^>]*>(.*?)</div>', dl.group(1) if dl else "", re.S):
        k, v = text(name), text(val)
        if k and v:
            data[k.rstrip(":")] = v
    nut = []
    for num, unit, name in re.findall(
            r'<div class="nutritionItem">\s*<div class="number[^"]*"[^>]*>(.*?)</div>\s*<div class="name">(.*?)</div>\s*<div class="text">(.*?)</div>', p, re.S):
        nut.append({"name": text(name), "value": text(num), "unit": text(unit)})
    per = re.search(r'nutritionListTitle.*?<div class="subInfo">(.*?)</div>', p, re.S)
    marks = [text(x) for x in re.findall(r'<div class="markingItem">.*?<div class="text">(.*?)</div>', p, re.S)]
    remark = re.search(r'<div class="remarksText">(.*?)</div>\s*</div>', p, re.S)
    return {
        "found": True,
        "ingredients": re.sub(r"\.?ttrn$", ".", block(p, "componentsText") or "") or None,  # «ttrn» — мусор в конце текста на самом сайте
        "contains": block(p, "alergiesProperties"),
        "may_contain": block(p, "alergiesTracesProperties"),
        "features": block(p, "featuresList"),
        "health_marks": [m for m in marks if m] or None,
        "nutrition": {"per": text(per.group(1)) if per else None, "items": nut} if nut else None,
        "data": data or None,
        "remark": text(remark.group(1)) if remark else None,
    }


class Stop(Exception):
    pass


def fetch(barcode):
    r = urllib.request.Request(f"https://www.shufersal.co.il/online/he/p/P_{page_code(barcode)}",
                               headers={"User-Agent": UA, "Accept": "text/html", "Accept-Language": "he"})
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            page = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"found": False}
        if e.code in (403, 429, 503):
            raise Stop(f"HTTP {e.code}")
        raise
    if "Maintenance" in page[:3000] and "productContainer" not in page:
        raise Stop("страница техработ / сайт закрыт для этого адреса")
    return parse(page) or {"found": False}


def main():
    if not in_window():
        print("вне окна 04:00–08:45 UTC из robots.txt — выходим")
        return
    todo = [r["barcode"] for r in (sb("shuf_info_todo", {"p_limit": LIMIT}) or [])]
    print(f"{datetime.now(timezone.utc):%Y-%m-%d %H:%M} к проверке: {len(todo)}")
    batch, done, found, rich = [], 0, 0, 0
    for b in todo:
        if not in_window():
            print("окно закончилось")
            break
        t0 = time.time()
        try:
            row = fetch(b)
        except Stop as e:
            print(f"остановка: {e}")
            break
        except Exception as e:  # сеть, таймаут — пропускаем товар, попробуем в другой день
            print(f"{b}: {e}")
            row = None
        if row is not None:
            batch.append({"barcode": b, **row})
            done += 1
            found += row.get("found", False)
            rich += bool(row.get("ingredients") or row.get("nutrition"))
        if len(batch) >= 25:
            sb("shuf_info_save", {"p_rows": batch}); batch = []
        time.sleep(max(0, PAUSE - (time.time() - t0)))
    if batch:
        sb("shuf_info_save", {"p_rows": batch})
    print(f"проверено {done}, карточка есть у {found}, состав или пищевая ценность — у {rich}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
