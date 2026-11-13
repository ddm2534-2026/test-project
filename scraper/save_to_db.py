"""Сохраняет сегодняшний сбор в Supabase.

Читает data/catalog.json (его пишет scrape_deals.py) и через REST API Supabase:
  1. обновляет таблицу stores;
  2. добавляет/обновляет товары (products) — по паре (магазин, id товара в магазине);
  3. записывает сегодняшние цены в price_snapshots (одна запись на товар в день);
  4. помечает «нет в наличии» товары, которых сегодня в магазине не было.

Нужны переменные окружения SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY
(ключ secret / service_role — только из секретов GitHub, не из кода).
Если их нет, скрипт ничего не делает и не падает.
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
CATALOG = ROOT / "data" / "catalog.json"
STORES_FILE = ROOT / "stores.json"
BATCH = 500


class Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):  # старый формат ключа (JWT) нужен ещё и в Authorization
            self.headers["Authorization"] = f"Bearer {key}"

    def request(self, method: str, path: str, body=None, prefer: str = ""):
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path.split('?')[0]} → HTTP {e.code}: {e.read().decode()[:300]}") from e

    def upsert(self, table: str, rows: list, on_conflict: str, returning: bool = False):
        prefer = "resolution=merge-duplicates," + ("return=representation" if returning else "return=minimal")
        out = []
        for i in range(0, len(rows), BATCH):
            res = self.request("POST", f"/{table}?on_conflict={on_conflict}", rows[i:i + BATCH], prefer)
            if returning and res:
                out.extend(res)
        return out


def main() -> int:
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы — пропускаю запись в базу")
        return 0
    if not CATALOG.exists():
        print("Нет data/catalog.json — сначала запустите scrape_deals.py", file=sys.stderr)
        return 1

    db = Supabase(url, key)
    catalog = json.loads(CATALOG.read_text("utf-8"))
    today = datetime.now(timezone.utc).date().isoformat()
    stores = [s for s in json.loads(STORES_FILE.read_text("utf-8")) if s.get("enabled", True) and s.get("id")]

    db.upsert("stores", [{"id": s["id"], "name": s["name"], "url": s["url"], "platform": s.get("type")} for s in stores], "id")

    items = [i for i in catalog["items"] if i.get("store_id")]
    # Один товар может попасть дважды (например, в двух коллекциях) — оставляем первый
    seen, unique = set(), []
    for i in items:
        k = (i["store_id"], str(i["external_id"]))
        if k not in seen:
            seen.add(k)
            unique.append(i)

    product_rows = [{
        "store_id": i["store_id"],
        "external_id": str(i["external_id"]),
        "name": i["name"][:500],
        "url": i.get("url"),
        "image": i.get("image"),
        "sku": i.get("sku"),
        "brand": i.get("brand"),
        "model_number": i.get("model_number"),
        "age_min": i.get("age_min"),
        "age_max": i.get("age_max"),
        "in_stock": True,
        "last_seen": today,
        "price": round(float(i["price"]), 2) if i.get("price") else None,
        "old_price": round(float(i["old_price"]), 2) if i.get("old_price") else None,
        "promo": i.get("promo"),
    } for i in unique]
    saved = db.upsert("products", product_rows, "store_id,external_id", returning=True)
    ids = {(r["store_id"], r["external_id"]): r["id"] for r in saved}
    print(f"Товаров записано: {len(saved)}")

    price_rows = []
    for i in unique:
        pid = ids.get((i["store_id"], str(i["external_id"])))
        if pid and i.get("price"):
            price_rows.append({
                "product_id": pid,
                "day": today,
                "price": round(float(i["price"]), 2),
                "old_price": round(float(i["old_price"]), 2) if i.get("old_price") else None,
                "promo": i.get("promo"),
            })
    db.upsert("price_snapshots", price_rows, "product_id,day")
    print(f"Цен за {today} записано: {len(price_rows)}")

    # Чего сегодня не было в успешно собранных магазинах — помечаем «нет в наличии»
    for sid in catalog.get("ok_stores", []):
        db.request("PATCH", f"/products?store_id=eq.{urllib.parse.quote(sid)}&last_seen=lt.{today}",
                   {"in_stock": False}, "return=minimal")
    return 0


if __name__ == "__main__":
    sys.exit(main())
