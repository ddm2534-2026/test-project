"""Уменьшенные копии фото рецептов (thumb_url): ширина 640, JPEG ~70.
Берёт рецепты, у которых есть image_url, но нет thumb_url.
  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python scraper/recipe_thumbs.py
"""
import io, json, os, urllib.request
from PIL import Image

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def req(method, path, body=None, ctype="application/json", extra=None):
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    r = urllib.request.Request(URL + path, method=method, data=data, headers={**H, "Content-Type": ctype, **(extra or {})})
    with urllib.request.urlopen(r, timeout=60) as resp:
        t = resp.read()
        return json.loads(t) if t and resp.headers.get_content_type() == "application/json" else None


def main():
    rows = req("GET", "/rest/v1/menu_recipes?select=id,image_url&image_url=not.is.null&thumb_url=is.null&limit=1000")
    print("к обработке:", len(rows))
    ok = 0
    for r in rows:
        try:
            with urllib.request.urlopen(r["image_url"], timeout=60) as resp:
                im = Image.open(io.BytesIO(resp.read())).convert("RGB")
            w = 640
            if im.width > w:
                im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=72, optimize=True, progressive=True)
            name = r["image_url"].rsplit("/", 1)[-1].rsplit(".", 1)[0]
            path = f"thumbs/{r['id']}/{name}.jpg"
            req("POST", f"/storage/v1/object/recipe-images/{path}", buf.getvalue(), "image/jpeg", {"x-upsert": "true"})
            thumb = f"{URL}/storage/v1/object/public/recipe-images/{path}"
            req("PATCH", f"/rest/v1/menu_recipes?id=eq.{r['id']}", {"thumb_url": thumb}, extra={"Prefer": "return=minimal"})
            ok += 1
        except Exception as e:
            print("ошибка", r["id"], e)
    print("готово:", ok)


if __name__ == "__main__":
    main()
