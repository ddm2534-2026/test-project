"""Собирает страницу «Скидки сегодня» из data/deals.json.

Берёт site/template.html, вставляет в него данные и пишет _site/index.html.
Страница получается одним файлом, без внешних запросов (кроме картинок товаров).

Запуск:
    python scraper/build_site.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "site" / "template.html"
DATA = ROOT / "data" / "deals.json"
OUT = ROOT / "_site" / "index.html"


def main() -> None:
    data = json.loads(DATA.read_text("utf-8"))
    # Ошибки сбора на публичной странице не нужны
    public = {"updated_at": data.get("updated_at"), "deals": data.get("deals", [])}
    payload = json.dumps(public, ensure_ascii=False).replace("</", "<\\/")
    html = TEMPLATE.read_text("utf-8").replace("/*__DEALS__*/null", payload, 1)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, "utf-8")
    print(f"Страница собрана: {OUT.relative_to(ROOT)} ({len(public['deals'])} товаров)")


if __name__ == "__main__":
    main()
