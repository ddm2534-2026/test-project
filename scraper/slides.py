"""Карусель «Скидки дня» для Telegram: набор картинок 1080×1350 в стиле сайта.

Слайды: обложка (дата + 4 превью) → по одному товару крупно → финальный «все скидки на сайте».
Рисуются как HTML и сохраняются в PNG через headless Chromium (Playwright).

    from slides import render_slides
    paths = render_slides(deals, "/tmp/slides", "13 בנובמבר", lang="he", total=3999)
"""

import html
import os
from pathlib import Path

W, H = 1080, 1350
SITE = "ddm2534-2026.github.io/test-project"

TEXT = {
    "he": {"dir": "rtl", "title": "מבצעי <span>היום</span>", "sub": "צעצועים ומוצרי תינוקות",
           "swipe": "החליקו לכל המבצעים", "arrow": "←", "age": "גיל", "up_to_year": "עד שנה",
           "club": "מחיר מועדון", "cheaper": "✓ זול יותר מאשר ב־{}", "was": "במקום",
           "all_n": "<b>{}</b> מבצעים<br>מחכים באתר", "all": "כל המבצעים<br>באתר",
           "filters": "סינון לפי גיל, חנות ומחיר", "link": "הקישור בפוסט",
           "foot": "מחירי החנויות בבוקר · בדקו לפני הרכישה"},
    "ru": {"dir": "ltr", "title": "Скидки <span>дня</span>", "sub": "игрушки и товары для малышей",
           "swipe": "листайте — все скидки дня", "arrow": "→", "age": "возраст", "up_to_year": "до 1 года",
           "club": "Клубная цена", "cheaper": "✓ дешевле, чем в {}", "was": "вместо",
           "all_n": "<b>{}</b> скидок<br>ждут на сайте", "all": "Все скидки<br>на сайте",
           "filters": "фильтр по возрасту, магазину и цене", "link": "ссылка в посте",
           "foot": "Цены магазинов на утро · проверяйте перед покупкой"},
}

CSS = """
* { box-sizing: border-box; margin: 0; }
body { width: %(W)spx; height: %(H)spx; overflow: hidden; background: #fbf7f2; color: #24201c;
       font-family: Rubik, 'DejaVu Sans', sans-serif; }
.slide { width: 100%%; height: 100%%; padding: 56px; display: flex; flex-direction: column; gap: 28px; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.top { display: flex; justify-content: space-between; align-items: center; font-size: 28px; color: #7a7068; font-weight: 500; }
.dots { display: flex; gap: 8px; }
.dots i { width: 12px; height: 12px; border-radius: 50%%; background: #e6ddd2; }
.dots i.on { background: #24201c; }
h1 { font-size: 112px; font-weight: 800; letter-spacing: -3px; line-height: .95; }
h1 span { color: #e0503a; }
.card { background: #fff; border-radius: 36px; box-shadow: 0 2px 0 #ece4da, 0 16px 40px rgba(60,40,20,.08); overflow: hidden; }
.pic { position: relative; display: grid; place-items: center; background: #fff; }
.pic img { position: absolute; inset: 7%%; width: 86%%; height: 86%%; object-fit: contain; }
.ph { width: 30%%; opacity: .25; }
.off { position: absolute; top: 24px; background: #e0503a; color: #fff; font-weight: 800; border-radius: 20px; direction: ltr; }
.foot { font-size: 22px; color: #7a7068; display: flex; justify-content: space-between; gap: 20px; white-space: nowrap; }
"""

GIFT = ('<svg class="ph" viewBox="0 0 24 24" fill="none" stroke="#24201c" stroke-width="1.2"><rect x="3" y="8" width="18" height="13" rx="2"/>'
        '<path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1s6 1 6 1zm0 0c2-4 6-4 6-1s-6 1-6 1z"/></svg>')


def money(x, lang="he") -> str:
    x = float(x)
    num = f"{x:,.0f}" if x == int(x) else f"{x:,.2f}"
    return f"{num} ₪" if lang == "he" else "₪" + num.replace(",", " ")


def age_text(lo, hi, tx) -> str:
    if lo is None:
        return ""
    n = lambda v: f"{float(v):g}".replace(".5", "½")
    if hi is None:
        return f"{n(lo)}+"
    if float(hi) <= 1:
        return tx["up_to_year"]
    return f"{n(lo)}–{n(hi)}"


def _img(d) -> str:
    src = d.get("image") or ""
    if src.startswith("//"):
        src = "https:" + src
    return f'<img src="{html.escape(src, quote=True)}">' if src else GIFT


def _page(body: str, lang: str, extra_css: str = "") -> str:
    tx = TEXT[lang]
    return (f'<!DOCTYPE html><html lang="{lang}" dir="{tx["dir"]}"><head><meta charset="utf-8">'
            '<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700;800&display=block" rel="stylesheet">'
            f'<style>{CSS % {"W": W, "H": H}}{extra_css}</style></head><body>{body}</body></html>')


def _dots(i: int, n: int) -> str:
    return '<div class="dots">' + "".join(f'<i class="{"on" if k == i else ""}"></i>' for k in range(n)) + "</div>"


def cover_html(deals, date_text, lang, n_slides) -> str:
    tx = TEXT[lang]
    side = "right" if tx["dir"] == "rtl" else "left"
    tiles = "".join(
        f'<div class="card pic t">{_img(d)}<span class="off" style="{side}:20px">−{d["discount_percent"]}%</span></div>'
        for d in deals[:4])
    body = f"""<div class="slide">
      <div class="top"><span>{html.escape(date_text)}</span>{_dots(0, n_slides)}</div>
      <div><div style="font-size:32px;color:#7a7068;font-weight:500;margin-bottom:10px">{tx['sub']}</div>
           <h1>{tx['title']}</h1></div>
      <div class="grid">{tiles}</div>
      <div class="swipe">{tx['swipe']} <span>{tx['arrow']}</span></div>
    </div>"""
    css = """.grid { flex: 1; display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); grid-template-rows: repeat(2, minmax(0,1fr)); gap: 22px; min-height: 0; }
      .t .off { font-size: 30px; padding: 6px 14px; top: 20px; }
      .swipe { font-size: 34px; font-weight: 700; display: flex; gap: 14px; align-items: center; }
      .swipe span { color: #e0503a; font-size: 44px; }"""
    return _page(body, lang, css)


def card_html(d, i, n_slides, date_text, lang) -> str:
    tx = TEXT[lang]
    side = "right" if tx["dir"] == "rtl" else "left"
    other = "left" if side == "right" else "right"
    age = age_text(d.get("age_min"), d.get("age_max"), tx)
    tags = []
    if d.get("promo"):
        tags.append(f'<span class="tag vip">{tx["club"]}: {html.escape("LEGO VIP" if "VIP" in d["promo"] else d["promo"])}</span>')
    if d.get("cheaper_than"):
        tags.append(f'<span class="tag good">{html.escape(tx["cheaper"].format(d["cheaper_than"]))}</span>')
    body = f"""<div class="slide">
      <div class="top"><span>{html.escape(date_text)}</span>{_dots(i, n_slides)}</div>
      <div class="card main">
        <div class="pic big">{_img(d)}
          <span class="off" style="{side}:28px">−{d['discount_percent']}%</span>
          {f'<span class="age" style="{other}:28px">{tx["age"]} <bdi dir="ltr">{age}</bdi></span>' if age else ''}
        </div>
        <div class="info">
          <div class="store">{html.escape(d['store_name'])}</div>
          <div class="name" dir="auto">{html.escape(d['name'].strip())}</div>
          <div class="prices"><b class="ltr">{money(d['price'], lang)}</b>
               <span class="was">{tx['was']} <s class="ltr">{money(d['old_price'], lang)}</s></span></div>
          {'<div class="tags">' + ''.join(tags) + '</div>' if tags else ''}
        </div>
      </div>
      <div class="foot"><span>{tx['foot']}</span><span class="ltr">{SITE}</span></div>
    </div>"""
    css = """.main { flex: 1; display: flex; flex-direction: column; min-height: 0; }
      .big { flex: 1; min-height: 0; }
      .big .off { font-size: 52px; padding: 10px 24px; top: 28px; }
      .age { position: absolute; bottom: 24px; background: #fff; border-radius: 999px; padding: 8px 20px;
             font-size: 28px; font-weight: 600; box-shadow: 0 0 0 2px #ece4da; }
      .info { flex-shrink: 0; padding: 30px 40px 40px; display: flex; flex-direction: column; gap: 12px; border-top: 2px solid #f3ece4; }
      .store { font-size: 28px; font-weight: 500; color: #7a7068; }
      .name { font-size: 42px; line-height: 1.25; font-weight: 500; display: -webkit-box; -webkit-line-clamp: 2;
              -webkit-box-orient: vertical; overflow: hidden; }
      .prices { display: flex; align-items: baseline; gap: 22px; flex-wrap: wrap; margin-top: 4px; }
      .prices b { font-size: 96px; font-weight: 800; letter-spacing: -2px; line-height: 1; }
      .was { font-size: 34px; color: #7a7068; }
      .tags { display: flex; gap: 12px; flex-wrap: wrap; }
      .tag { font-size: 28px; font-weight: 600; padding: 8px 16px; border-radius: 12px; }
      .vip { color: #5b3fc8; background: #efebfc; }
      .good { color: #22704a; background: #e6f3ec; }"""
    return _page(body, lang, css)


def end_html(n_slides, date_text, lang, total=None) -> str:
    tx = TEXT[lang]
    big = tx["all_n"].format(f"{total:,}") if total else tx["all"]
    body = f"""<div class="slide end">
      <div class="top"><span>{html.escape(date_text)}</span>{_dots(n_slides - 1, n_slides)}</div>
      <div class="mid">
        <div class="big">{big}</div>
        <div class="filters">{tx['filters']}</div>
        <div class="arrow">{tx['arrow']}</div>
        <div class="url ltr">{SITE}</div>
        <div class="link">{tx['link']}</div>
      </div>
    </div>"""
    css = """.end { background: #24201c; color: #fff; }
      .end .top { color: #bdb3a9; } .end .dots i { background: #4a423b; } .end .dots i.on { background: #fff; }
      .mid { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 26px; }
      .big { font-size: 104px; font-weight: 800; line-height: 1.02; letter-spacing: -2px; }
      .big b { color: #e0503a; font-weight: 800; direction: ltr; unicode-bidi: isolate; }
      .filters { font-size: 38px; color: #d8cfc6; }
      .arrow { font-size: 110px; color: #e0503a; line-height: 1; }
      .url { font-size: 34px; font-weight: 600; text-align: start; }
      .link { font-size: 28px; color: #bdb3a9; }"""
    return _page(body, lang, css)


def slides_html(deals, date_text, lang="he", total=None) -> list:
    n = len(deals) + 2
    return ([cover_html(deals, date_text, lang, n)]
            + [card_html(d, i, n, date_text, lang) for i, d in enumerate(deals, 1)]
            + [end_html(n, date_text, lang, total)])


def render_slides(deals, out_dir, date_text, lang="he", total=None) -> list:
    from playwright.sync_api import sync_playwright

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    with sync_playwright() as p:
        exe = os.environ.get("CHROME_PATH")  # локально можно указать готовый Chrome
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        for k, doc in enumerate(slides_html(deals, date_text, lang, total)):
            page.set_content(doc, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(300)
            path = out / f"slide-{k:02d}.jpg"
            page.screenshot(path=str(path), type="jpeg", quality=90)
            paths.append(str(path))
        browser.close()
    return paths


if __name__ == "__main__":
    import sys
    lang = sys.argv[1] if len(sys.argv) > 1 else "he"
    sample = [
        {"name": "לגו Iconic - חתול בר-מזל (40813)", "store_name": "LEGO Store Israel", "price": 99, "old_price": 159,
         "promo": "LEGO VIP", "cheaper_than": "Toys R Us"},
        {"name": "סליים חד קרן", "store_name": "Toys R Us", "price": 49.9, "old_price": 119.9, "age_min": 5, "age_max": 8},
        {"name": "כסא אוכל לתינוק 6 ב-1 רב תכליתי - כסא גבוה, נמוך ובוסטר צבע אפור", "store_name": "בייבי סטאר",
         "price": 229, "old_price": 549},
        {"name": "משחק מגנטים פארק השעשועים 100 חלקים", "store_name": "Kinder Toys", "price": 89, "old_price": 200,
         "age_min": 3, "age_max": 5},
    ]
    for d in sample:
        d["discount_percent"] = round(100 * (d["old_price"] - d["price"]) / d["old_price"])
    out = Path(__file__).resolve().parent.parent / "_site" / "slides-preview"
    print(render_slides(sample, str(out), "13 בנובמבר" if lang == "he" else "13 ноября", lang, total=3999))
