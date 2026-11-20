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
         ROOT / "site" / "menu.html": ROOT / "_site" / "menu.html",
         ROOT / "site" / "recipes.html": ROOT / "_site" / "recipes.html",
         ROOT / "site" / "start.html": ROOT / "_site" / "start.html",
         ROOT / "site" / "start2.html": ROOT / "_site" / "start2.html",
         ROOT / "site" / "deals.html": ROOT / "_site" / "deals.html",
         ROOT / "site" / "privacy.html": ROOT / "_site" / "privacy.html"}

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
    # приложение Sali: все файлы папки, в текстовых — подставляем адрес базы и ключ
    app = ROOT / "site" / "app"
    build_id = __import__("time").strftime("%Y%m%d%H%M%S")  # метка версии: браузер не возьмёт старые скрипты из кэша
    if app.is_dir():
        for f in app.rglob("*"):
            if not f.is_file():
                continue
            out = ROOT / "_site" / "app" / f.relative_to(app)
            out.parent.mkdir(parents=True, exist_ok=True)
            if f.suffix in (".html", ".js", ".css"):
                out.write_text(f.read_text("utf-8").replace("/*__SUPABASE_URL__*/", SUPABASE_URL)
                               .replace("/*__SUPABASE_KEY__*/", SUPABASE_PUBLISHABLE_KEY)
                               .replace("?v=dev", f"?v={build_id}"), "utf-8")
            else:
                out.write_bytes(f.read_bytes())
        print("Приложение собрано: _site/app")
    # лендинги Sali по темам: в текстовых файлах — адрес базы, ключ и метка версии
    lp = ROOT / "site" / "lp"
    if lp.is_dir():
        for f in lp.rglob("*"):
            if not f.is_file():
                continue
            out = ROOT / "_site" / "lp" / f.relative_to(lp)
            out.parent.mkdir(parents=True, exist_ok=True)
            if f.suffix in (".html", ".js", ".css"):
                out.write_text(f.read_text("utf-8").replace("/*__SUPABASE_URL__*/", SUPABASE_URL)
                               .replace("/*__SUPABASE_KEY__*/", SUPABASE_PUBLISHABLE_KEY)
                               .replace("?v=dev", f"?v={build_id}"), "utf-8")
            else:
                out.write_bytes(f.read_bytes())
        print("Лендинги собраны: _site/lp")
    # статичные макеты дизайна (Sali) — копируем как есть
    import shutil
    mock = ROOT / "site" / "sali"
    if mock.is_dir():
        shutil.copytree(mock, ROOT / "_site" / "sali", dirs_exist_ok=True)
        print("Макет собран: _site/sali")


if __name__ == "__main__":
    main()
