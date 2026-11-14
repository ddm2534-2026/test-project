"""Фото товаров из полной выгрузки Open Food Facts (одним файлом, без тысяч запросов к их серверу).

Open Food Facts каждый день публикует всю базу в CSV (≈1 ГБ в gzip). Скачиваем потоком,
по дороге оставляем только наши штрихкоды и записываем ссылку на фото в g_items.image_url.
Фото — CC BY-SA, источник указан на странице корзины.

Запуск: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python scraper/grocery_images_bulk.py
"""

import csv
import gzip
import io
import os
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from save_to_db import Supabase  # noqa: E402

DUMP = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz"
UA = "test-project-basket/0.1 (https://github.com/ddm2534-2026/test-project)"


def key(code: str) -> str:
    return (code or "").strip().lstrip("0")


def our_barcodes(db) -> dict:
    out, offset = {}, 0
    while True:
        rows = db.request("GET", f"/g_items?select=barcode&barcode=not.like.*:*&order=barcode&limit=1000&offset={offset}")
        if not rows:
            break
        for r in rows:
            out[key(r["barcode"])] = r["barcode"]
        offset += len(rows)
    return out


def main():
    db = Supabase(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    ours = our_barcodes(db)
    print(f"Наших штрихкодов: {len(ours)}", flush=True)

    t0 = time.time()
    req = urllib.request.Request(DUMP, headers={"User-Agent": UA})
    found = {}
    csv.field_size_limit(10 ** 8)
    with urllib.request.urlopen(req, timeout=600) as resp:
        text = io.TextIOWrapper(gzip.GzipFile(fileobj=resp), encoding="utf-8", errors="replace", newline="")
        reader = csv.reader(text, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(reader)
        ix = {name: i for i, name in enumerate(header)}
        c_code, c_small, c_img = ix["code"], ix.get("image_small_url"), ix.get("image_url")
        for n, row in enumerate(reader, 1):
            if len(row) <= c_code:
                continue
            ours_code = ours.get(key(row[c_code]))
            if ours_code:
                img = (row[c_small] if c_small is not None and c_small < len(row) else "") or \
                      (row[c_img] if c_img is not None and c_img < len(row) else "")
                if img.startswith("http"):
                    found[ours_code] = img
            if n % 500000 == 0:
                print(f"  прочитано {n:,} товаров OFF, совпало с фото {len(found)} ({time.time() - t0:.0f} c)", flush=True)
    print(f"Совпало с фото: {len(found)} из {len(ours)}", flush=True)

    rows = [{"barcode": b, "image_url": found.get(b)} for b in ours.values()]
    for i in range(0, len(rows), 1000):
        db.request("POST", "/rpc/g_set_images", {"p_rows": rows[i:i + 1000]})
    print(f"Записано в базу за {time.time() - t0:.0f} c", flush=True)


if __name__ == "__main__":
    main()
