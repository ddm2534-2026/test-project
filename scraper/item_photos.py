"""Копии фото товаров для внутреннего использования (в приложении не показываются).
Берёт g_item_info.image_url без image_path, скачивает по одному с паузой, кладёт в закрытое хранилище
item-photos/<сеть>/<штрихкод>.<расширение> и записывает путь. Честный User-Agent, без маскировки.
"""
import os, sys, time, json, urllib.request, urllib.error

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
UA = "ProductInfoBot/1.0"
PAUSE = float(os.environ.get("PAUSE", "1.5"))
LIMIT = int(os.environ.get("LIMIT", "3000"))
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def api(method, path, body=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    hdr = {**H, **({"Content-Type": "application/json"} if body is not None else {}), **(headers or {})}
    req = urllib.request.Request(URL + path, data=data, method=method, headers=hdr)
    with urllib.request.urlopen(req, timeout=60) as r:
        t = r.read()
        return json.loads(t) if t and r.headers.get("content-type", "").startswith("application/json") else t


def main():
    todo = api("GET", f"/rest/v1/g_item_info?select=barcode,src,image_url&image_url=not.is.null&image_path=is.null&limit={LIMIT}")
    print(f"к скачиванию: {len(todo)}", flush=True)
    ok = bad = 0
    for x in todo:
        try:
            req = urllib.request.Request(x["image_url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                img, ct = r.read(), r.headers.get("content-type", "image/png").split(";")[0]
            ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif"}.get(ct, "img")
            path = f"{x['src'] or 'other'}/{x['barcode']}.{ext}"
            api("POST", f"/storage/v1/object/item-photos/{path}", raw=img, headers={"Content-Type": ct, "x-upsert": "true"})
            api("PATCH", f"/rest/v1/g_item_info?barcode=eq.{x['barcode']}", {"image_path": path}, headers={"Prefer": "return=minimal"})
            ok += 1
        except urllib.error.HTTPError as e:
            bad += 1
            print(f"{x['barcode']}: HTTP {e.code}", flush=True)
            if e.code in (403, 429):
                print("источник просит остановиться — стоп", flush=True)
                break
        except Exception as e:  # noqa: BLE001
            bad += 1
            print(f"{x['barcode']}: {e}", flush=True)
        if (ok + bad) % 100 == 0:
            print(f"… {ok} сохранено, {bad} ошибок", flush=True)
        time.sleep(PAUSE)
    print(f"готово: {ok} сохранено, {bad} ошибок", flush=True)


if __name__ == "__main__":
    sys.exit(main())
