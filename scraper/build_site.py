"""Собирает страницу «Скидки сегодня»: подставляет в шаблон адрес базы и публичный ключ.

Данные страница берёт из Supabase сама, в браузере. Публичный (publishable) ключ
даёт только чтение каталога — права настроены в базе (RLS), поэтому его можно
хранить в коде.

Запуск:
    python scraper/build_site.py
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "site" / "template.html"
OUT = ROOT / "_site" / "index.html"

SUPABASE_URL = "https://iavsoiirixtvkcszzfzd.supabase.co"
SUPABASE_PUBLISHABLE_KEY = "sb_publishable_iyk2egos5cGAWztXikEigA_gfIlzAWr"


def main() -> None:
    html = (TEMPLATE.read_text("utf-8")
            .replace("/*__SUPABASE_URL__*/", SUPABASE_URL)
            .replace("/*__SUPABASE_KEY__*/", SUPABASE_PUBLISHABLE_KEY))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, "utf-8")
    print(f"Страница собрана: {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
