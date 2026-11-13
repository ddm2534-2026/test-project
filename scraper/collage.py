"""Коллаж «Скидки дня»: одна картинка 1080×1350 с 8 товарами.

Рисуется как HTML-страница и сохраняется в PNG через headless Chromium (Playwright):
так проще получить красивую типографику, иврит/кириллицу и картинки товаров.

    from collage import render_collage
    render_collage(deals, "collage.png", "13 ноября")
"""

import html
from pathlib import Path

W, H = 1080, 1350
SITE = "ddm2534-2026.github.io/test-project"


TEXT = {
    "he": {"dir": "rtl", "title": "מבצעי <span>היום</span>", "for": "לילדים",
           "more": "כל המבצעים<br>עם סינון<br>לפי גיל", "arrow": "←", "link": "הקישור בפוסט",
           "foot": "מחירי החנויות בבוקר · בדקו לפני הרכישה"},
    "ru": {"dir": "ltr", "title": "Скидки <span>дня</span>", "for": "для детей",
           "more": "Все скидки<br>с фильтром<br>по возрасту", "arrow": "→", "link": "ссылка в посте",
           "foot": "Цены магазинов на утро · проверяйте перед покупкой"},
}


def money(x, lang="ru") -> str:
    x = float(x)
    num = f"{x:,.0f}" if x == int(x) else f"{x:,.2f}"
    return f"{num} ₪" if lang == "he" else "₪" + num.replace(",", " ")


def collage_html(deals: list, date_text: str, lang: str = "ru") -> str:
    tx = TEXT[lang]
    start, end = ("right", "left") if tx["dir"] == "rtl" else ("left", "right")
    cards = []
    for i, d in enumerate(deals[:8], 1):
        img = html.escape((d.get("image") or "").replace("//", "https://", 1) if (d.get("image") or "").startswith("//")
                          else (d.get("image") or ""), quote=True)
        picture = f'<img src="{img}">' if img else '<div class="ph">🧸</div>'
        cards.append(f"""
        <div class="card">
          <div class="pic">{picture}<span class="num">{i}</span><span class="off">−{d['discount_percent']}%</span></div>
          <div class="info">
            <div class="prices"><b dir="ltr">{money(d['price'], lang)}</b><s dir="ltr">{money(d['old_price'], lang)}</s></div>
            <div class="store">{html.escape(d['store_name'])}</div>
          </div>
        </div>""")
    cards.append(f"""
        <div class="card more">
          <div>{tx['more']}</div>
          <div class="arrow">{tx['arrow']}</div>
          <div class="link">{tx['link']}</div>
        </div>""")
    return f"""<!DOCTYPE html><html lang="{lang}" dir="{tx['dir']}"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;600;800&display=block" rel="stylesheet">
<style>
  * {{ box-sizing: border-box; margin: 0; }}
  body {{ width: {W}px; height: {H}px; background: #fbf7f2; font-family: Rubik, 'DejaVu Sans', sans-serif; color: #24201c;
          padding: 48px 44px; display: flex; flex-direction: column; gap: 28px; }}
  header {{ display: flex; align-items: flex-end; justify-content: space-between; }}
  h1 {{ font-size: 76px; font-weight: 800; letter-spacing: -2px; line-height: .95; }}
  h1 span {{ color: #e8573f; }}
  .date {{ font-size: 30px; color: #7a7068; font-weight: 600; text-align: end; }}
  .grid {{ flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 20px; min-height: 0; }}
  .card {{ background: #fff; border: 2px solid #ece4da; border-radius: 28px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }}
  .pic {{ position: relative; flex: 1; display: grid; place-items: center; min-height: 0; overflow: hidden; }}
  .pic img {{ position: absolute; top: 64px; left: 18px; width: calc(100% - 36px); height: calc(100% - 76px); object-fit: contain; }}
  .ph {{ font-size: 90px; opacity: .3; }}
  .num {{ z-index: 1; position: absolute; top: 12px; {start}: 12px; width: 46px; height: 46px; border-radius: 50%;
          background: #24201c; color: #fff; font-weight: 800; font-size: 26px; display: grid; place-items: center; }}
  .off {{ z-index: 1; position: absolute; top: 12px; {end}: 12px; direction: ltr; background: #e8573f; color: #fff; font-weight: 800;
          font-size: 26px; padding: 6px 14px; border-radius: 999px; }}
  .info {{ flex-shrink: 0; padding: 10px 18px 14px; border-top: 2px solid #f3ece4; }}
  .prices b, .prices s {{ unicode-bidi: isolate; }}
  .prices {{ display: flex; align-items: baseline; gap: 10px; line-height: 1.15; }}
  .prices b {{ font-size: 36px; white-space: nowrap; font-weight: 800; }}
  .prices s {{ font-size: 22px; color: #7a7068; white-space: nowrap; }}
  .store {{ font-size: 22px; color: #7a7068; margin-top: 2px; text-align: start; unicode-bidi: plaintext; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
  .more {{ background: #24201c; color: #fff; border: none; justify-content: center; align-items: center; text-align: center;
           font-size: 34px; font-weight: 600; line-height: 1.25; gap: 10px; }}
  .more .arrow {{ font-size: 64px; color: #e8573f; line-height: 1; }}
  .more .link {{ font-size: 22px; color: #bdb3a9; font-weight: 400; }}
  footer {{ font-size: 20px; color: #7a7068; display: flex; justify-content: space-between; white-space: nowrap; gap: 20px; }}
</style></head><body>
  <header><h1>{tx['title']}</h1><div class="date">{html.escape(date_text)}<br>{tx['for']}</div></header>
  <div class="grid">{''.join(cards)}</div>
  <footer><span>{tx['foot']}</span><span dir="ltr">{SITE}</span></footer>
</body></html>"""


def render_collage(deals: list, out_path: str, date_text: str, lang: str = "ru") -> str:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        import os
        exe = os.environ.get("CHROME_PATH")  # локально можно указать готовый Chrome
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        page.set_content(collage_html(deals, date_text, lang), wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(500)
        page.screenshot(path=out_path, full_page=False)
        browser.close()
    return out_path


if __name__ == "__main__":
    # Пробный рендер на тестовых данных
    sample = [{"price": p, "old_price": o, "discount_percent": round(100 * (o - p) / o), "store_name": s, "image": ""}
              for p, o, s in [(34.9, 119.9, "בייבי סטאר"), (49, 149, "בייבי סטאר"), (39.9, 107.8, "עגליס"),
                              (115, 300, "Kinder Toys"), (389, 599, "LEGO Store Israel"), (49.9, 119.9, "Toys R Us"),
                              (2299, 4598, "עגליס"), (60, 120, "ספירלה")]]
    out = Path(__file__).resolve().parent.parent / "_site" / "collage-preview.png"
    out.parent.mkdir(exist_ok=True)
    print(render_collage(sample, str(out), "13 ноября"))
