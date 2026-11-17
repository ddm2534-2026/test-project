"""Справочник филиалов сетей и городов — для режима «В магазине» (цены ближайшего филиала)
и для выбора города в настройках семьи.

1. g_cities — список населённых пунктов Израиля (ЦСБ, data.gov.il): код и название.
2. g_branches — филиалы каждой сети из файла Stores, который сети обязаны публиковать по закону:
   номер, название, адрес, город (у одних сетей — код ЦСБ, у других — название), тип.

Запуск: python scraper/grocery_branches.py [сети через пробел]   (без аргументов — все, кроме Victory)
Victory доступна только из Израиля — её филиалы грузит задача Cloud Run (см. victory.yml) с аргументом victory.
"""
import json
import os
import re
import sys
import traceback
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_supermarkets import opener, get, parse_xml, low, txt  # noqa: E402
from save_to_db import Supabase  # noqa: E402
from grocery_ingest import CHAINS, CERBERUS, LAIB, cerberus_files  # noqa: E402

CBS_RESOURCE = "5c78e9fa-c2e2-4771-93ff-7f400a12f7ba"   # «רשימת יישובים» ЦСБ на data.gov.il


def norm(s):
    """Название города для сравнения: без кавычек, дефисов, лишних пробелов."""
    s = re.sub(r"[\"'׳״`\-–—()]", " ", str(s or ""))
    return re.sub(r"\s+", " ", s).strip()


def load_cities(db):
    op = opener()
    url = f"https://data.gov.il/api/3/action/datastore_search?resource_id={CBS_RESOURCE}&limit=5000"
    recs = json.loads(get(op, url, timeout=120))["result"]["records"]
    rows = []
    for r in recs:
        code = next((r[k] for k in r if "סמל" in k and "ישוב" in k), None)
        he = next((r[k] for k in r if k.startswith("שם_ישוב") and "לועזי" not in k), None)
        en = next((r[k] for k in r if "לועזי" in k), None)
        try:
            code = int(str(code).strip())
        except (TypeError, ValueError):
            continue
        if code and he and str(he).strip():
            rows.append({"code": code, "name_he": norm(he), "name_en": (str(en).strip().title() if en else None)})
    if db and rows:
        db.upsert("g_cities", rows, "code")
    print(f"городов: {len(rows)}")
    return rows


def stores_from(root):
    out = []
    for s in low(root).iter("store"):
        out.append({"id": txt(s, "storeid"), "name": txt(s, "storename"), "address": txt(s, "address"),
                    "city": txt(s, "city"), "zip": txt(s, "zipcode"), "type": txt(s, "storetype"),
                    "subchain": txt(s, "subchainname")})
    return [x for x in out if x["id"]]


def fetch_stores(chain_id, cfg):
    if cfg["source"] == "shufersal":
        op = opener()
        page = get(op, "https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=5&storeId=0").decode("utf-8", "replace")
        link = re.findall(r'href="(https://[^"]+?\.gz[^"]*)"', page)[0].replace("&amp;", "&")
        return stores_from(parse_xml(get(op, link, timeout=120)))
    if cfg["source"] == "laib":
        op = opener()
        for edi in cfg["edi"]:
            listing = json.loads(get(op, f"{LAIB}/webapi/api/getfiles?edi={edi}", timeout=120))
            names = sorted(f.get("fileName", "") for f in listing if f.get("fileName", "").lower().startswith("stores"))
            if names:
                return stores_from(parse_xml(get(op, f"{LAIB}/webapi/{edi}/{names[-1]}", timeout=120)))
        raise RuntimeError("laibcatalog: нет файла Stores")
    op, rows = cerberus_files(cfg["user"])
    names = sorted(r["fname"] for r in rows if r["fname"].lower().startswith("stores"))
    if not names:
        raise RuntimeError("нет файла Stores")
    return stores_from(parse_xml(get(op, f"{CERBERUS}/file/d/{names[-1]}", timeout=120)))


# районы и сокращения в названиях филиалов (у Йохананофа и Кешета поле City пустое — город берём из названия/адреса)
ALIASES = {"ת א": "תל אביב יפו", "תא": "תל אביב יפו", "ראשלצ": "ראשון לציון", "ראשל צ": "ראשון לציון",
           "הדר": "חיפה", "קרית אליעזר": "חיפה", "קרית חיים": "חיפה", "חורב": "חיפה", "חוצות המפרץ": "חיפה",
           "גבעת רם": "ירושלים", "תלפיות": "ירושלים", "פולג": "נתניה", "הדרים": "נתניה",
           "יד אליהו": "תל אביב יפו", "נחלת יצחק": "תל אביב יפו", "בן צבי": "תל אביב יפו",
           "מישור אדומים": "מעלה אדומים", "סגולה": "פתח תקווה", "מבקיעים": "אשקלון", "ברנע": "אשקלון"}


def city_in_text(text, by_name):
    """Город, упомянутый в названии или адресе филиала: сначала районы, потом самое длинное название города."""
    t = " " + norm(text) + " "
    for a, city in ALIASES.items():
        if " " + a + " " in t and city in by_name:
            return by_name[city]
    best = None
    for name, code in by_name.items():
        if len(name) >= 3 and " " + name + " " in t and (best is None or len(name) > len(best[0])):
            best = (name, code)
    return best[1] if best else None


def resolve_city(raw, by_code, by_name):
    """Код ЦСБ города по полю City: число → код; название → поиск по названию (точно, потом по началу)."""
    r = str(raw or "").strip()
    if re.fullmatch(r"\d{1,5}", r):
        c = int(r)
        return c if c in by_code else None
    n = norm(r)
    if not n:
        return None
    if n in by_name:
        return by_name[n]
    for name, code in by_name.items():   # «תל אביב» → «תל אביב יפו», «ראשון לציון מזרח» → «ראשון לציון»
        if name.startswith(n + " ") or n.startswith(name + " "):
            return code
    return None


def main(argv):
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    db = Supabase(url, key) if url and key else None
    wanted = argv or [c for c, cfg in CHAINS.items() if not cfg.get("israel_only")]
    cities = []
    if "victory" not in argv or len(argv) > 1:   # Cloud Run (только victory) города не трогает
        try:
            cities = load_cities(db)
        except Exception as e:
            print("города: ошибка", e)
    if not cities and db:
        cities = db.request("GET", "/g_cities?select=code,name_he&limit=5000") or []
    by_code = {c["code"]: c for c in cities}
    by_name = {}
    for c in sorted(cities, key=lambda c: len(c["name_he"])):
        by_name.setdefault(norm(c["name_he"]), c["code"])
    failed = []
    run = datetime.now(timezone.utc).isoformat()
    for chain_id in wanted:
        try:
            st = fetch_stores(chain_id, CHAINS[chain_id])
            rows = [{"chain_id": chain_id, "store_id": s["id"], "name": s["name"], "address": s["address"],
                     "city_raw": s["city"], "city_code": resolve_city(s["city"], by_code, by_name)
                     or city_in_text(s["name"] + " " + s["address"], by_name),
                     "zip": s["zip"], "store_type": s["type"], "sub_chain": s["subchain"], "updated_at": run}
                    for s in st]
            ok = sum(1 for r in rows if r["city_code"])
            print(f"{chain_id}: филиалов {len(rows)}, город определён у {ok}; "
                  f"без города: {[r['city_raw'] for r in rows if not r['city_code']][:15]}")
            if db and rows:
                db.upsert("g_branches", rows, "chain_id,store_id")
                db.request("DELETE", f"/g_branches?chain_id=eq.{chain_id}&updated_at=lt.{urllib.parse.quote(run)}",
                           prefer="return=minimal")
        except Exception:
            failed.append(chain_id)
            print(f"{chain_id}: ОШИБКА\n" + traceback.format_exc()[-1200:])
    if failed:
        print("Не загрузились:", ", ".join(failed))
    return 1 if len(failed) == len(wanted) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
