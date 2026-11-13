"""Сборщик скидок на детские товары.

Читает список магазинов из stores.json. У каждого магазина есть "type":
  - "shopify": магазин на Shopify. Товары берутся из его открытого
    JSON-каталога (/collections/<имя>/products.json). Бесплатно и точно.
  - "ai" (по умолчанию): любой другой сайт. Страницу разбирает ИИ
    через ScrapeGraph API (POST /api/extract), нужен SGAI_API_KEY.

Результат: data/deals.json и сводная таблица data/deals.md.

Запуск:
    SGAI_API_KEY=... python scraper/scrape_deals.py

Только стандартная библиотека Python, ничего ставить не нужно.
"""

import json
import os
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


def fetch_shopify(store_url: str) -> list:
    """Товары со скидкой из Shopify-коллекции: compare_at_price > price."""
    parts = urllib.parse.urlsplit(store_url)
    base = f"{parts.scheme}://{parts.netloc}"
    path = parts.path.rstrip("/") or "/collections/all"
    products, page = [], 1
    while page <= 20:  # предохранитель: максимум 5000 товаров
        req = urllib.request.Request(
            f"{base}{path}/products.json?limit=250&page={page}",
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            batch = json.load(resp).get("products", [])
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
            if best:
                products.append({
                    "name": item["title"],
                    **best,
                    "currency": "ILS" if parts.netloc.endswith(".il") else "",
                    "url": f"{base}/products/{item['handle']}",
                })
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
            products = fetch_shopify(store["url"]) if kind == "shopify" else fetch_ai(api_key, store["url"])
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
