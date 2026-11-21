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


def build_i18n(out_dir: Path) -> None:
    """Словари перевода интерфейса приложения: site/app/i18n/ui.tsv (строки интерфейса)
    + названия продуктов из базы (иврит — g_ingredients.name_he, английский — g_ui_strings «ing:<ключ>»)
    + названия рецептов (g_ui_strings «rcp:<id рецепта>», en и he)
    → _site/app/i18n.en.js и i18n.he.js. Без сети — только строки интерфейса."""
    import json
    import urllib.request
    ui = {"en": {}, "he": {}}
    for line in (ROOT / "site" / "app" / "i18n" / "ui.tsv").read_text("utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        ru, en, he = (line.split("\t") + ["", ""])[:3]
        ui["en"][ru], ui["he"][ru] = en, he
    ing = {"en": {}, "he": {}}
    rcp = {"en": {}, "he": {}}
    try:
        def get(path):
            # PostgREST отдаёт не больше 1000 строк за раз — читаем страницами
            out, off = [], 0
            while True:
                req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}&limit=1000&offset={off}", headers={"apikey": SUPABASE_PUBLISHABLE_KEY})
                with urllib.request.urlopen(req, timeout=30) as r:
                    part = json.load(r)
                out += part
                if len(part) < 1000:
                    return out
                off += 1000
        en = {r["key"][4:]: r["text"] for r in get("g_ui_strings?select=key,text&lang=eq.en&key=like.ing:*&order=key")}
        for r in get("g_ingredients?select=key,name_ru,name_he&order=key"):
            ru = (r.get("name_ru") or "").strip()
            if not ru:
                continue
            if r.get("name_he"):
                ing["he"][ru] = r["name_he"].strip()
            if en.get(r["key"]):
                ing["en"][ru] = en[r["key"]]
        print(f"Названия продуктов для перевода: {len(ing['en'])} en, {len(ing['he'])} he")
        # названия рецептов: g_ui_strings «rcp:<id>» → по русскому названию из menu_recipes
        names = {r["id"]: (r.get("name") or "").strip() for r in get("menu_recipes?select=id,name&order=id")}
        for r in get("g_ui_strings?select=key,lang,text&key=like.rcp:*&order=key,lang"):
            ru = names.get(r["key"][4:])
            if ru and r.get("text") and r["lang"] in rcp:
                rcp[r["lang"]][ru] = r["text"].strip()
        print(f"Названия рецептов для перевода: {len(rcp['en'])} en, {len(rcp['he'])} he")
    except Exception as e:  # сборка не должна падать из-за сети
        print("Названия продуктов не загрузились:", e)
    for lang in ("en", "he"):
        d = {**ing[lang], **rcp[lang], **ui[lang]}  # строки интерфейса важнее
        js = ("window.I18N_DICT = " + json.dumps(d, ensure_ascii=False, separators=(",", ":"))
              + ";\nI18N.start();\n")
        (out_dir / f"i18n.{lang}.js").write_text(js, "utf-8")
    print("Словари интерфейса собраны: i18n.en.js, i18n.he.js")


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
        build_i18n(ROOT / "_site" / "app")
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
