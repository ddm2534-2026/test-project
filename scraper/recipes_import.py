"""Загрузка переработанных живых рецептов в библиотеку menu_recipes.
Берёт data/recipes_import.json; рецепт с тем же source_url или названием не дублирует.
  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python scraper/recipes_import.py
"""
import json, os, urllib.request, urllib.parse

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def req(method, path, body=None, extra=None):
    r = urllib.request.Request(URL + path, method=method, headers={**H, **(extra or {})},
                               data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
    with urllib.request.urlopen(r, timeout=60) as resp:
        t = resp.read().decode()
        return json.loads(t) if t else None


def main():
    rows = json.load(open(os.path.join(os.path.dirname(__file__), "..", "data", "recipes_import.json"), encoding="utf-8"))
    have = req("GET", "/rest/v1/menu_recipes?select=name,source_url")
    names = {h["name"] for h in have}
    urls_names = {(h["source_url"], h["name"]) for h in have}
    todo = [r for r in rows if r["name"] not in names and (r["source_url"], r["name"]) not in urls_names]
    print(f"всего {len(rows)}, уже есть {len(rows) - len(todo)}, добавляем {len(todo)}")
    for i in range(0, len(todo), 20):
        req("POST", "/rest/v1/menu_recipes", todo[i:i + 20], {"Prefer": "return=minimal"})
    print("готово")


if __name__ == "__main__":
    main()
