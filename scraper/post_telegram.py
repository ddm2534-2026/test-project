"""Пост «Скидки дня» в Telegram-канал.

Берёт из Supabase лучшие сегодняшние скидки, отбирает 8 разных товаров
(не больше 2 из одного магазина, без мелочи и без того, что уже публиковали
за последние 14 дней) и отправляет один пост через Telegram Bot API.

Переменные окружения (секреты GitHub):
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — база;
  TELEGRAM_BOT_TOKEN — токен бота от @BotFather;
  TELEGRAM_CHANNEL   — канал, например @sababa_kids_deals (бот должен быть админом).
  DRY_RUN=1          — только показать пост, ничего не отправлять и не записывать.
"""

import html
import json
import re
import uuid
import os
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from save_to_db import Supabase  # noqa: E402

SITE_URL = "https://ddm2534-2026.github.io/test-project/"
HOW_MANY = 8
PER_STORE = 2
MIN_PRICE = 30          # дешевле — обычно канцелярия и мелочь
MIN_DISCOUNT = 25       # %
REPEAT_DAYS = 14
LANG = os.environ.get("TG_LANG", "he")  # he или ru
TEXTS = {
    "he": {
        "months": ["בינואר", "בפברואר", "במרץ", "באפריל", "במאי", "ביוני", "ביולי",
                   "באוגוסט", "בספטמבר", "באוקטובר", "בנובמבר", "בדצמבר"],
        "title": "מבצעי היום", "age": "גיל", "up_to_year": "עד שנה",
        "cheaper": "✓ זול יותר מאשר ב־{}", "club": "מחיר מועדון",
        "all": "כל המבצעים עם סינון לפי גיל",
    },
    "ru": {
        "months": ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
                   "августа", "сентября", "октября", "ноября", "декабря"],
        "title": "Скидки дня", "age": "возраст", "up_to_year": "до 1 года",
        "cheaper": "✓ дешевле, чем в {}", "club": "Клубная цена",
        "all": "Все скидки с фильтром по возрасту",
    },
}
TX = TEXTS[LANG]
MONTHS = TX["months"]


def money(x) -> str:
    x = float(x)
    num = f"{x:,.0f}" if x == int(x) else f"{x:,.2f}"
    # в иврите запятая: число с пробелом внутри разваливается в тексте справа налево
    return f"{num} ₪" if LANG == "he" else "₪" + num.replace(",", " ")


def promo_text(p: str) -> str:
    return f"{TX['club']}: LEGO VIP" if "VIP" in (p or "") else (p or "")


def age_text(lo, hi) -> str:
    if lo is None:
        return ""
    n = lambda v: f"{float(v):g}".replace(".5", "½")
    if hi is None:
        return f"{n(lo)}+"
    if float(hi) <= 1:
        return TX["up_to_year"]
    return f"{n(lo)}–{n(hi)}"


def pick(candidates: list, recently_posted: set) -> list:
    chosen, per_store = [], Counter()
    for d in candidates:
        if d["id"] in recently_posted or per_store[d["store_id"]] >= PER_STORE:
            continue
        chosen.append(d)
        per_store[d["store_id"]] += 1
        if len(chosen) == HOW_MANY:
            break
    return chosen


def visible_len(text: str) -> int:
    """Длина подписи так, как её считает Telegram: без HTML-тегов."""
    return len(html.unescape(re.sub(r"<[^>]+>", "", text)))


def compose(deals: list, today, name_len: int = 90) -> str:
    lines = [f"🧸 <b>{TX['title']} · {today.day} {MONTHS[today.month - 1]}</b>", ""]
    for i, d in enumerate(deals, 1):
        raw = d["name"].strip()
        name = html.escape(raw if len(raw) <= name_len else raw[:name_len - 1].rstrip() + "…")
        url = html.escape(d.get("url") or SITE_URL, quote=True)
        parts = [f"<b>{money(d['price'])}</b> <s>{money(d['old_price'])}</s> (\u200e−{d['discount_percent']}%)",
                 html.escape(d["store_name"])]
        age = age_text(d.get("age_min"), d.get("age_max"))
        if age:
            parts.append(f"{TX['age']} {age}")
        line = f"{i}. <a href=\"{url}\">{name}</a>\n" + " · ".join(parts)
        if d.get("promo"):
            line += f" · ⭐ {html.escape(promo_text(d['promo']))}"
        if d.get("cheaper_than"):
            line += " · " + TX["cheaper"].format(html.escape(d["cheaper_than"]))
        lines.append(line)
    lines += ["", f"👉 <a href=\"{SITE_URL}?lang={LANG}\">{TX['all']}</a>"]
    return "\n".join(lines)


def caption_for_photo(deals: list, today) -> str:
    """Подпись к фото ограничена 1024 символами — укорачиваем названия, пока не влезет."""
    for n in (60, 48, 40, 32, 26, 20):
        text = compose(deals, today, n)
        if visible_len(text) <= 1024:
            return text
    return compose(deals[:6], today, 20)


def telegram(token: str, method: str, payload: dict):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    if not res.get("ok"):
        raise RuntimeError(f"Telegram: {res}")
    return res["result"]


def send_photo(token: str, chat_id: str, photo_path: str, caption: str):
    boundary = uuid.uuid4().hex
    fields = {"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"}
    body = b""
    for k, v in fields.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"deals.png\"\r\n"
             f"Content-Type: image/png\r\n\r\n").encode() + Path(photo_path).read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendPhoto", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.load(r)
    if not res.get("ok"):
        raise RuntimeError(f"Telegram: {res}")
    return res["result"]


def send_media_group(token: str, chat_id: str, paths: list, caption: str):
    """Альбом (карусель): до 10 картинок, подпись показывается под альбомом (ставим её на первую)."""
    boundary = uuid.uuid4().hex
    media = [{"type": "photo", "media": f"attach://p{k}"} for k in range(len(paths))]
    media[0].update({"caption": caption, "parse_mode": "HTML"})
    body = b""
    for k, v in {"chat_id": chat_id, "media": json.dumps(media, ensure_ascii=False)}.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for k, path in enumerate(paths):
        body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"p{k}\"; filename=\"{Path(path).name}\"\r\n"
                 f"Content-Type: image/jpeg\r\n\r\n").encode() + Path(path).read_bytes() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMediaGroup", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=180) as r:
        res = json.load(r)
    if not res.get("ok"):
        raise RuntimeError(f"Telegram: {res}")
    return res["result"][0]


def main() -> int:
    dry = os.environ.get("DRY_RUN") == "1"
    db = Supabase(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    channel = os.environ.get("TELEGRAM_CHANNEL", "")

    q = urllib.parse.urlencode({
        "select": "id,store_id,store_name,name,url,image,age_min,age_max,price,old_price,promo,discount_percent,model_number",
        "price": f"gte.{MIN_PRICE}", "discount_percent": f"gte.{MIN_DISCOUNT}",
        "order": "discount_percent.desc,price.desc", "limit": "400",
    })
    candidates = db.request("GET", f"/current_deals?{q}")

    since = (datetime.now(timezone.utc) - timedelta(days=REPEAT_DAYS)).isoformat()
    posted = db.request("GET", "/telegram_posts?" + urllib.parse.urlencode(
        {"select": "product_id", "posted_at": f"gte.{since}"}))
    deals = pick(candidates, {p["product_id"] for p in posted})
    if not deals:
        print("Нечего публиковать: подходящих новых скидок нет")
        return 0

    # Подсказка «дешевле, чем в …» для товаров с номером модели
    models = [d["model_number"] for d in deals if d.get("model_number")]
    if models:
        others = db.request("GET", "/products?" + urllib.parse.urlencode({
            "select": "model_number,store_id,price,stores(name)",
            "model_number": "in.(" + ",".join(f'"{m}"' for m in models) + ")",
            "in_stock": "eq.true"}))
        for d in deals:
            rivals = [o for o in others if o["model_number"] == d.get("model_number")
                      and o["store_id"] != d["store_id"] and o.get("price")]
            dearer = [o for o in rivals if float(o["price"]) > float(d["price"])]
            if rivals and len(dearer) == len(rivals):
                d["cheaper_than"] = min(dearer, key=lambda o: float(o["price"]))["stores"]["name"]

    today = datetime.now(timezone.utc) + timedelta(hours=2)
    caption = caption_for_photo(deals, today)
    print(caption)
    print(f"\n— видимых символов: {visible_len(caption)} из 1024, товаров: {len(deals)}")

    date_text = f"{today.day} {MONTHS[today.month - 1]}"
    fmt = os.environ.get("TG_FORMAT", "carousel")  # carousel — альбом из слайдов, collage — одна картинка
    slides, photo = None, None
    if fmt == "carousel":
        try:
            from slides import render_slides
            try:
                total = int(db.request("POST", "/rpc/deal_facets", {}).get("total") or 0) or None
            except Exception:
                total = None
            slides = render_slides(deals, os.environ.get("SLIDES_DIR", "/tmp/deals-slides"), date_text, LANG, total)
            print(f"Слайды карусели: {len(slides)} шт. в {Path(slides[0]).parent}")
        except Exception as e:
            print(f"Карусель не получилась ({e}) — попробую коллаж")
    if not slides:
        try:
            from collage import render_collage
            photo = render_collage(deals, "/tmp/deals-collage.png", date_text, LANG)
            print(f"Коллаж: {photo}")
        except Exception as e:  # без картинок всё равно публикуем текстом
            print(f"Коллаж не получился ({e}) — отправлю текстом")

    if dry:
        print("DRY_RUN: ничего не отправлено")
        return 0

    token = os.environ["TELEGRAM_BOT_TOKEN"]
    msg = None
    if slides:
        try:
            msg = send_media_group(token, channel, slides, caption)
        except Exception as e:
            print(f"Альбом не отправился ({e}) — попробую одной картинкой/текстом")
    if msg is None and photo:
        msg = send_photo(token, channel, photo, caption)
    if msg is None:
        msg = telegram(token, "sendMessage", {
            "chat_id": channel, "text": compose(deals, today), "parse_mode": "HTML",
            "link_preview_options": {"is_disabled": True},
        })
    db.request("POST", "/telegram_posts", [
        {"product_id": d["id"], "channel": channel, "price": d["price"]} for d in deals], "return=minimal")
    print(f"Опубликовано: сообщение {msg['message_id']} в {channel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
