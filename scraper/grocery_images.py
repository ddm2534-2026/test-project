"""Фото товаров супермаркетов по штрихкоду из Open Food Facts (открытая база, фото под CC BY-SA).

Берёт товары, которые ещё не проверяли (сначала те, что продаются в большем числе сетей),
спрашивает у Open Food Facts фото упаковки и записывает ссылку в g_items.image_url.
Проверенные без фото тоже отмечаются, чтобы не спрашивать о них каждый день.

Правила Open Food Facts: не больше 100 запросов в минуту на чтение товаров и свой User-Agent.

Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python scraper/grocery_images.py [сколько товаров]
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from save_to_db import Supabase  # noqa: E402

UA = "test-project-basket/0.1 (https://github.com/ddm2534-2026/test-project)"
PAUSE = 0.7          # ~85 запросов в минуту — с запасом до лимита 100
FIELDS = "code,image_front_small_url,image_small_url,image_front_url,image_url"


def off_image(barcode: str):
    url = f"https://world.openfoodfacts.org/api/v2/product/{barcode}?fields={FIELDS}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            p = data.get("product") or {}
            return (p.get("image_front_small_url") or p.get("image_small_url")
                    or p.get("image_front_url") or p.get("image_url"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:            # попросили притормозить
                time.sleep(30)
                continue
            time.sleep(3)
        except Exception:
            time.sleep(3)
    raise RuntimeError("Open Food Facts не отвечает")


def main(argv):
    limit = int(argv[0]) if argv else 1500
    db = Supabase(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    todo = db.request("POST", "/rpc/g_images_todo", {"p_limit": limit})
    print(f"Проверяю {len(todo)} товаров")
    batch, found, done = [], 0, 0
    for row in todo:
        try:
            img = off_image(row["barcode"])
        except RuntimeError as e:
            print(f"Остановился: {e}")
            break
        batch.append({"barcode": row["barcode"], "image_url": img})
        found += bool(img)
        done += 1
        if len(batch) >= 100:
            db.request("POST", "/rpc/g_set_images", {"p_rows": batch})
            print(f"  {done}: с фото {found} ({100 * found // done}%)")
            batch = []
        time.sleep(PAUSE)
    if batch:
        db.request("POST", "/rpc/g_set_images", {"p_rows": batch})
    print(f"Готово: проверено {done}, с фото {found}")


if __name__ == "__main__":
    main(sys.argv[1:])
