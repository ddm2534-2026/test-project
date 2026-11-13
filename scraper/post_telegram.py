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
MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
          "августа", "сентября", "октября", "ноября", "декабря"]


def money(x) -> str:
    x = float(x)
    return f"₪{x:,.0f}".replace(",", " ") if x == int(x) else f"₪{x:,.2f}".replace(",", " ")


def age_text(lo, hi) -> str:
    if lo is None:
        return ""
    n = lambda v: f"{float(v):g}".replace(".5", "½")
    if hi is None:
        return f"{n(lo)}+"
    if float(hi) <= 1:
        return "до 1 года"
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


def compose(deals: list, today) -> str:
    lines = [f"🧸 <b>Скидки дня · {today.day} {MONTHS[today.month - 1]}</b>", ""]
    for i, d in enumerate(deals, 1):
        name = html.escape(d["name"][:90])
        url = html.escape(d.get("url") or SITE_URL, quote=True)
        parts = [f"<b>{money(d['price'])}</b> <s>{money(d['old_price'])}</s> (−{d['discount_percent']}%)",
                 html.escape(d["store_name"])]
        age = age_text(d.get("age_min"), d.get("age_max"))
        if age:
            parts.append(f"возраст {age}")
        line = f"{i}. <a href=\"{url}\">{name}</a>\n    " + " · ".join(parts)
        if d.get("promo"):
            line += f"\n    ⭐ {html.escape(d['promo'])}"
        if d.get("cheaper_than"):
            line += f"\n    ✓ дешевле, чем в {html.escape(d['cheaper_than'])}"
        lines += [line, ""]
    lines.append(f"👉 <a href=\"{SITE_URL}\">Все скидки с фильтром по возрасту</a>")
    lines.append("<i>Цены — с сайтов магазинов на сегодняшнее утро, проверяйте перед покупкой.</i>")
    return "\n".join(lines)


def telegram(token: str, method: str, payload: dict):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    if not res.get("ok"):
        raise RuntimeError(f"Telegram: {res}")
    return res["result"]


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

    text = compose(deals, datetime.now(timezone.utc) + timedelta(hours=2))
    print(text)
    print(f"\n— {len(text)} символов, товаров: {len(deals)}")
    if dry:
        print("DRY_RUN: ничего не отправлено")
        return 0

    msg = telegram(os.environ["TELEGRAM_BOT_TOKEN"], "sendMessage", {
        "chat_id": channel, "text": text, "parse_mode": "HTML",
        "link_preview_options": {"is_disabled": True},
    })
    db.request("POST", "/telegram_posts", [
        {"product_id": d["id"], "channel": channel, "price": d["price"]} for d in deals], "return=minimal")
    print(f"Опубликовано: сообщение {msg['message_id']} в {channel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
