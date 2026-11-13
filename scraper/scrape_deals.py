"""Сборщик скидок на детские товары.

Читает список магазинов из stores.json. У каждого магазина есть "type":
  - "shopify": магазин на Shopify. Товары берутся из его открытого
    JSON-каталога (/collections/<имя>/products.json). Бесплатно и точно.
  - "konimbo": магазин на израильской платформе Konimbo. Цены берутся
    из готового HTML страниц категории. Бесплатно.
  - "ai" (по умолчанию): любой другой сайт. Страницу разбирает ИИ
    через ScrapeGraph API (POST /api/extract), нужен SGAI_API_KEY.

Результат: data/deals.json и сводная таблица data/deals.md.

Запуск:
    SGAI_API_KEY=... python scraper/scrape_deals.py

Только стандартная библиотека Python, ничего ставить не нужно.
"""

import html as html_lib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORES_FILE = ROOT / "stores.json"
DATA_DIR = ROOT / "data"

API_URL = os.environ.get("SGAI_API_URL", "https://v2-api.scrapegraphai.com/api").rstrip("/")
TIMEOUT_SECONDS = 180

PROMPT = (
    "Find all products on this page that are discounted (have a sale price "
    "lower than the regular price, or a visible discount badge). For each, "
    "return the product name, the current price, the old price if shown, "
    "the discount in percent if shown, the promotion text if any (for example "
    "'second item at 50%'), the currency, and the absolute product link. "
    "Keep product names and promotion text in the original language of the page."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "products": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "price": {"type": "number"},
                    "old_price": {"type": "number"},
                    "discount_percent": {"type": "number"},
                    "promo": {"type": "string"},
                    "currency": {"type": "string"},
                    "url": {"type": "string"},
                },
                "required": ["name", "price"],
            },
        }
    },
    "required": ["products"],
}


def extract(api_key: str, url: str) -> dict:
    body = json.dumps({"url": url, "prompt": PROMPT, "schema": SCHEMA}).encode()
    req = urllib.request.Request(
        f"{API_URL}/extract",
        data=body,
        method="POST",
        headers={
            "SGAI-APIKEY": api_key,
            "Content-Type": "application/json",
            "SGAI-Session-Id": "deals-" + datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        hints = {
            401: "нет ключа",
            402: "закончились кредиты",
            403: "неверный ключ",
            429: "слишком много запросов",
        }
        raise RuntimeError(f"HTTP {e.code} ({hints.get(e.code, 'ошибка')}): {detail}") from e


USER_AGENT = "test-project-deals-bot/0.1 (+https://github.com/ddm2534-2026/test-project)"


def http_get(url: str, accept: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.geturl() != url:
            print(f"  (переадресация: {url} → {resp.geturl()})")
        return resp.read()


def fetch_member_prices(base: str, path: str, css_class: str) -> dict:
    """Клубные цены (VIP и т.п.) из HTML страниц коллекции: {handle: цена}.

    Shopify не отдаёт их в JSON, сайт рисует их в карточке товара.
    Каждая цена привязывается к последней ссылке на товар перед ней.
    """
    pattern = re.compile(
        r'href="(?:/[a-z-]+)?/products/([^"?#/]+)|' + re.escape(css_class) + r'">\s*([\d,.]+)'
    )
    prices, page = {}, 1
    while page <= 50:
        html = http_get(f"{base}{path}?page={page}", "text/html").decode("utf-8", "replace")
        found, current = 0, None
        for m in pattern.finditer(html):
            if m.group(1):
                current = urllib.parse.unquote(m.group(1))
            elif current and current not in prices:
                prices[current] = float(m.group(2).replace(",", ""))
                found += 1
        if not found:
            break
        page += 1
    return prices


def fetch_shopify(store: dict) -> list:
    """Товары со скидкой из Shopify-коллекции.

    Скидка — это либо compare_at_price > price (обычная распродажа),
    либо клубная цена ниже обычной, если в stores.json задан member_price_class.
    """
    parts = urllib.parse.urlsplit(store["url"])
    base = f"{parts.scheme}://{parts.netloc}"
    path = parts.path.rstrip("/") or "/collections/all"
    currency = "ILS" if parts.netloc.endswith(".il") else ""
    member = {}
    if store.get("member_price_class"):
        member = fetch_member_prices(base, path, store["member_price_class"])
        print(f"  клубных цен на страницах: {len(member)}")
    label = store.get("member_label", "Цена для членов клуба")

    products, page = [], 1
    while page <= 20:  # предохранитель: максимум 5000 товаров
        batch = json.loads(http_get(f"{base}{path}/products.json?limit=250&page={page}", "application/json")).get("products", [])
        if not batch:
            break
        for item in batch:
            best = None
            for v in item.get("variants", []):
                if not v.get("available", True):
                    continue  # нет в наличии: такая скидка родителям бесполезна
                price = float(v.get("price") or 0)
                old = float(v.get("compare_at_price") or 0)
                if price > 0 and old > price and (best is None or price < best["price"]):
                    best = {"price": price, "old_price": old}
                elif price > 0 and best is None:
                    best = {"price": price, "old_price": None}  # пока без скидки
            if not best:
                continue
            club = member.get(item["handle"])
            regular = best["old_price"] or best["price"]
            if club and club < best["price"]:
                best = {"price": club, "old_price": regular, "promo": label}
            if best["old_price"]:
                products.append({
                    "name": item["title"],
                    **best,
                    "currency": currency,
                    "url": f"{base}/products/{item['handle']}",
                })
        page += 1
    return products


def _money(text: str):
    m = re.search(r"[\d][\d,]*(?:\.\d+)?", text or "")
    return float(m.group(0).replace(",", "")) if m else None


def fetch_konimbo(store: dict) -> list:
    """Товары со скидкой со страницы категории магазина на Konimbo.

    Konimbo отдаёт страницы готовым HTML: у карточки (div.layout_list_item)
    есть название (h4.title), старая цена (p.origin_price) и новая (p.price).
    """
    parts = urllib.parse.urlsplit(store["url"])
    base = f"{parts.scheme}://{parts.netloc}"
    products, seen, page = [], set(), 1
    while page <= 50:
        sep = "&" if parts.query else "?"
        html = http_get(f"{store['url']}{sep}page={page}", "text/html").decode("utf-8", "replace")
        chunks = re.split(r'<div id="item_id_(\d+)"', html)[1:]
        if page == 1 and not chunks:
            t = re.search(r"<title>(.*?)</title>", html, re.S)
            raise RuntimeError(
                f"на странице нет карточек товаров (размер {len(html)} байт, "
                f"title: {t.group(1).strip()[:80] if t else '-'!r}, начало: {html[:200]!r})"
            )
        new = 0
        for item_id, chunk in zip(chunks[0::2], chunks[1::2]):
            if item_id in seen:
                continue
            seen.add(item_id)
            new += 1
            title = re.search(r'<h4 class="title[^"]*">(.*?)</h4>', chunk, re.S)
            href = re.search(r'href="\s*(/items/[^"\s]+)', chunk)
            old = re.search(r'class="origin_price[^"]*">(.*?)</p>', chunk, re.S)
            cur = re.search(r'class="price[^"]*">(.*?)</p>', chunk, re.S)
            price = _money(re.sub(r"<[^>]+>", " ", cur.group(1))) if cur else None
            old_price = _money(re.sub(r"<[^>]+>", " ", old.group(1))) if old else None
            if title and price and old_price and old_price > price:
                products.append({
                    "name": html_lib.unescape(re.sub(r"\s+", " ", title.group(1))).strip(),
                    "price": price,
                    "old_price": old_price,
                    "currency": "ILS" if "₪" in chunk else "",
                    "url": base + href.group(1) if href else store["url"],
                })
        if not new:  # страницы кончились (или сайт вернул уже виденные товары)
            break
        page += 1
    return products


def fetch_ai(api_key: str, url: str) -> list:
    if not api_key:
        raise RuntimeError("для type=ai нужен SGAI_API_KEY")
    return (extract(api_key, url).get("json") or {}).get("products") or []


def with_discount(p: dict) -> dict:
    """Досчитывает процент скидки, если есть обе цены, а процента нет."""
    if not p.get("discount_percent") and p.get("old_price") and p.get("price"):
        old, new = p["old_price"], p["price"]
        if old > new > 0:
            p["discount_percent"] = round((old - new) / old * 100)
    return p


def main() -> int:
    api_key = os.environ.get("SGAI_API_KEY", "")

    stores = [s for s in json.loads(STORES_FILE.read_text("utf-8")) if s.get("enabled", True)]
    if not stores:
        print("В stores.json нет включённых магазинов (enabled: true)", file=sys.stderr)
        return 1

    deals, errors = [], []
    for store in stores:
        kind = store.get("type", "ai")
        print(f"→ {store['name']} [{kind}]: {store['url']}")
        try:
            fetchers = {"shopify": fetch_shopify, "konimbo": fetch_konimbo}
            products = fetchers[kind](store) if kind in fetchers else fetch_ai(api_key, store["url"])
            for p in products:
                deals.append({"store": store["name"], **with_discount(p)})
            print(f"  найдено товаров со скидкой: {len(products)}")
        except Exception as e:  # один упавший магазин не должен ронять весь запуск
            errors.append({"store": store["name"], "error": str(e)})
            print(f"  ошибка: {e}", file=sys.stderr)

    deals.sort(key=lambda d: d.get("discount_percent") or 0, reverse=True)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "deals.json").write_text(
        json.dumps({"updated_at": now, "deals": deals, "errors": errors}, ensure_ascii=False, indent=2),
        "utf-8",
    )

    lines = [f"# Скидки\n\nОбновлено: {now} · товаров: {len(deals)}\n", "| Магазин | Товар | Цена | Было | Скидка | Акция |", "|---|---|---|---|---|---|"]
    for d in deals:
        name = d["name"].replace("|", "/")
        if d.get("url"):
            name = f"[{name}]({d['url']})"
        cur = d.get("currency", "")
        lines.append(
            f"| {d['store']} | {name} | {d['price']} {cur} | {d.get('old_price') or ''} | "
            f"{str(d['discount_percent']) + '%' if d.get('discount_percent') else ''} | "
            f"{(d.get('promo') or '').replace('|', '/')} |"
        )
    if errors:
        lines.append("\n## Ошибки\n")
        lines += [f"- {e['store']}: {e['error']}" for e in errors]
    (DATA_DIR / "deals.md").write_text("\n".join(lines) + "\n", "utf-8")

    print(f"Готово: {len(deals)} товаров, ошибок: {len(errors)}")
    # Ошибка только если не сработал вообще ни один магазин
    return 1 if errors and not deals and len(errors) == len(stores) else 0


if __name__ == "__main__":
    sys.exit(main())
