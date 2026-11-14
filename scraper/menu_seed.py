"""Наполнение библиотеки рецептов (menu_recipes) через функцию menu.

  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python scraper/menu_seed.py [на_категорию]

По каждой категории модель придумывает блюда (без повторов с библиотекой), затем рецепты пишутся
пачками по 5 (3 пачки параллельно); ингредиенты привязываются к справочнику, в конце — разметка товаров.
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

URL = os.environ["SUPABASE_URL"].rstrip("/") + "/functions/v1/menu"
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PER_MEAL = int(sys.argv[1]) if len(sys.argv) > 1 else 40
MEALS = ["завтрак", "обед", "ужин", "перекус", "в школу"]


def call(body, tries=3):
    data = json.dumps(body).encode()
    for t in range(tries):
        req = urllib.request.Request(URL, data=data, method="POST", headers={
            "Authorization": f"Bearer {KEY}", "apikey": KEY, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=400) as r:
                out = json.loads(r.read())
        except Exception as e:  # сеть, 5xx, таймаут — повторим
            out = {"error": str(e)}
        if "result" in out:
            return out["result"]
        print("  ошибка:", str(out.get("error"))[:200], flush=True)
        time.sleep(5 * (t + 1))
    return None


def main():
    total = 0
    for meal in MEALS:
        ideas, seen = [], set()
        # идеи — порциями до 40, чтобы ответ модели не обрезался
        while len(ideas) < PER_MEAL:
            res = call({"action": "seed_ideas", "meal": meal, "count": min(40, PER_MEAL - len(ideas) + 5)})
            if not res:
                break
            new = [d for d in res["dishes"] if d.get("name") and d["name"].strip().lower() not in seen]
            if not new:
                break
            for d in new:
                seen.add(d["name"].strip().lower())
            ideas += new
        ideas = ideas[:PER_MEAL]
        print(f"{meal}: {len(ideas)} идей", flush=True)
        batches = [ideas[i:i + 5] for i in range(0, len(ideas), 5)]
        with ThreadPoolExecutor(3) as ex:
            for b, res in zip(batches, ex.map(lambda b: call({"action": "seed_recipes", "dishes": b}), batches)):
                saved = (res or {}).get("saved", 0)
                total += saved
                print(f"  +{saved} ({', '.join(d['name'] for d in b)[:120]})", flush=True)
    print(f"Всего сохранено рецептов: {total}", flush=True)
    # разметка товаров под новые ингредиенты
    for i in range(80):
        res = call({"action": "backfill"})
        print("  разметка:", json.dumps(res, ensure_ascii=False)[:160] if res else "ошибка", flush=True)
        if not res or not res.get("more"):
            break


if __name__ == "__main__":
    main()
