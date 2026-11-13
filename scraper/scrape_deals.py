"""Сборщик скидок на детские товары через ScrapeGraph API (v2).

Читает список магазинов из stores.json, для каждого вызывает
POST /api/extract и сохраняет найденные товары в data/deals.json
и краткую сводку в data/deals.md.

Запуск:
    SGAI_API_KEY=... python scraper/scrape_deals.py

Только стандартная библиотека Python, ничего ставить не нужно.
"""

import json
import os
import sys
import urllib.error
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
    "the discount in percent if shown, the currency, and the absolute product "
    "link. Keep product names in the original language of the page."
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


def with_discount(p: dict) -> dict:
    """Досчитывает процент скидки, если есть обе цены, а процента нет."""
    if not p.get("discount_percent") and p.get("old_price") and p.get("price"):
        old, new = p["old_price"], p["price"]
        if old > new > 0:
            p["discount_percent"] = round((old - new) / old * 100)
    return p


def main() -> int:
    api_key = os.environ.get("SGAI_API_KEY")
    if not api_key:
        print("Не задан SGAI_API_KEY", file=sys.stderr)
        return 1

    stores = [s for s in json.loads(STORES_FILE.read_text("utf-8")) if s.get("enabled", True)]
    if not stores:
        print("В stores.json нет включённых магазинов (enabled: true)", file=sys.stderr)
        return 1

    deals, errors = [], []
    for store in stores:
        print(f"→ {store['name']}: {store['url']}")
        try:
            result = extract(api_key, store["url"])
            products = (result.get("json") or {}).get("products") or []
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

    lines = [f"# Скидки\n\nОбновлено: {now}\n", "| Магазин | Товар | Цена | Было | Скидка |", "|---|---|---|---|---|"]
    for d in deals:
        name = d["name"].replace("|", "/")
        if d.get("url"):
            name = f"[{name}]({d['url']})"
        cur = d.get("currency", "")
        lines.append(
            f"| {d['store']} | {name} | {d['price']} {cur} | {d.get('old_price') or ''} | "
            f"{str(d['discount_percent']) + '%' if d.get('discount_percent') else ''} |"
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
