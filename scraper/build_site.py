"""Собирает страницу «Скидки сегодня»: подставляет в шаблон адрес базы и публичный ключ.

Данные страница берёт из Supabase сама, в браузере. Публичный (publishable) ключ
даёт только чтение каталога — права настроены в базе (RLS), поэтому его можно
хранить в коде.

Запуск:
    python scraper/build_site.py
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# шаблон → страница сайта
PAGES = {ROOT / "site" / "template.html": ROOT / "_site" / "index.html",
         ROOT / "site" / "basket.html": ROOT / "_site" / "basket.html",
         ROOT / "site" / "menu.html": ROOT / "_site" / "menu.html"}

SUPABASE_URL = "https://iavsoiirixtvkcszzfzd.supabase.co"
SUPABASE_PUBLISHABLE_KEY = "sb_publishable_iyk2egos5cGAWztXikEigA_gfIlzAWr"


def main() -> None:
    for template, out in PAGES.items():
        if not template.exists():
            continue
        html = (template.read_text("utf-8")
                .replace("/*__SUPABASE_URL__*/", SUPABASE_URL)
                .replace("/*__SUPABASE_KEY__*/", SUPABASE_PUBLISHABLE_KEY))
        out.parent.mkdir(exist_ok=True)
        out.write_text(html, "utf-8")
        print(f"Страница собрана: {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
