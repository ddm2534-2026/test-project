"""Разведка №2: где лежат файлы Victory, Yochananof, Osher Ad и какие магазины (в т.ч. онлайн) есть у 6 сетей.

Для каждой сети пробуем портал Cerberus с несколькими именами входа, печатаем число файлов
и список магазинов из StoresFull (ищем онлайн/интернет-магазины). Для Victory дополнительно
смотрим, что знает библиотека israeli-prices (если установлена).
"""

import json
import re
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_supermarkets import opener, get, parse_xml, low, txt  # noqa: E402

CERBERUS = {
    "ramilevy": ["RamiLevi"],
    "tivtaam": ["TivTaam"],
    "yochananof": ["yohananof", "Yohananof", "yochananof"],
    "osherad": ["osherad", "OsherAd"],
    "victory": ["Victory", "victory", "VictoryOnline"],
}
ONLINE = re.compile(r"אינטרנט|און ?ליין|online|משלוח|ONLINE|דיגיטל|אתר", re.I)


def cerberus_session(user):
    for host in ("https://url.publishedprices.co.il", "https://url.retail.publishedprices.co.il"):
        try:
            op = opener()
            page = get(op, f"{host}/login").decode("utf-8", "replace")
            m = re.search(r'name="csrftoken"\s+(?:content|value)="([^"]+)"', page)
            form = {"username": user, "password": "", "Submit": "Sign in"}
            if m:
                form["csrftoken"] = m.group(1)
            get(op, f"{host}/login/user", form)
            page = get(op, f"{host}/file").decode("utf-8", "replace")
            m = re.search(r'name="csrftoken"\s+content="([^"]+)"', page)
            if m:
                return op, host, m.group(1)
        except Exception:
            continue
    return None


def cerberus_list(op, host, token, search=""):
    raw = get(op, f"{host}/file/json/dir", {
        "sEcho": 1, "iColumns": 5, "iDisplayStart": 0, "iDisplayLength": 100000,
        "mDataProp_0": "fname", "sSearch": search, "cd": "/", "csrftoken": token})
    return [r for r in json.loads(raw).get("aaData", []) if r.get("fname")]


def stores_from(root):
    out = []
    for s in low(root).iter("store"):
        out.append({"id": txt(s, "storeid"), "name": txt(s, "storename"), "city": txt(s, "city"),
                    "type": txt(s, "storetype"), "subchain": txt(s, "subchainname")})
    return out


def main():
    report = {}
    for chain, users in CERBERUS.items():
        res = {"ok": False}
        for user in users:
            s = cerberus_session(user)
            if not s:
                continue
            op, host, token = s
            try:
                files = cerberus_list(op, host, token)
            except Exception as e:
                res = {"ok": False, "user": user, "error": f"список файлов: {e}"[:200]}
                continue
            kinds = {}
            for f in files:
                k = re.match(r"[A-Za-z]+", f["fname"]).group(0).lower()
                kinds[k] = kinds.get(k, 0) + 1
            res = {"ok": True, "user": user, "host": host, "files": len(files), "kinds": kinds}
            st = [f["fname"] for f in files if f["fname"].lower().startswith("stores")]
            if st:
                try:
                    stores = stores_from(parse_xml(get(op, f"{host}/file/d/{sorted(st)[-1]}", timeout=120)))
                    res["stores"] = len(stores)
                    res["online_stores"] = [x for x in stores if ONLINE.search(" ".join(x.values()))][:10]
                    res["sample_stores"] = stores[:5]
                except Exception as e:
                    res["stores_error"] = str(e)[:200]
            # самые большие файлы цен (= самые большие магазины)
            pf = sorted([f for f in files if f["fname"].lower().startswith("pricefull")],
                        key=lambda f: -int(f.get("size") or 0))
            res["biggest_pricefull"] = [(f["fname"], f.get("size")) for f in pf[:5]]
            break
        report[chain] = res
        print(chain, json.dumps(res, ensure_ascii=False)[:2500])

    # Shufersal: список магазинов
    try:
        op = opener()
        page = get(op, "https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=5&storeId=0").decode("utf-8", "replace")
        link = re.findall(r'href="(https://[^"]+?\.gz[^"]*)"', page)[0].replace("&amp;", "&")
        stores = stores_from(parse_xml(get(op, link, timeout=120)))
        res = {"ok": True, "stores": len(stores),
               "online_stores": [x for x in stores if ONLINE.search(" ".join(x.values()))][:10]}
    except Exception as e:
        res = {"ok": False, "error": str(e)[:300]}
    report["shufersal"] = res
    print("shufersal", json.dumps(res, ensure_ascii=False)[:2500])

    # Что умеет библиотека israeli-prices (для сетей не на Cerberus)
    try:
        import israeli_prices as ilp
        info = {"version": getattr(ilp, "__version__", "?"), "api": [n for n in dir(ilp) if not n.startswith("_")]}
        for name in ("list_chains", "chains", "CHAINS", "SUPPORTED_CHAINS"):
            v = getattr(ilp, name, None)
            if v is not None:
                v = v() if callable(v) else v
                info["chains"] = [str(x) for x in (v.keys() if isinstance(v, dict) else v)][:60]
                break
        try:
            import inspect
            src = inspect.getsource(ilp)
            info["victory_mentions"] = sorted(set(re.findall(r".{0,80}[Vv]ictory.{0,120}", src)))[:8]
        except Exception:
            pass
        for fn in ("get_stores", "list_stores", "stores"):
            if hasattr(ilp, fn):
                try:
                    st = getattr(ilp, fn)("victory")
                    st = list(st)
                    info["victory_stores"] = len(st)
                    info["victory_online"] = [str(x)[:200] for x in st if ONLINE.search(str(x))][:8]
                    info["victory_sample"] = [str(x)[:200] for x in st[:3]]
                except Exception as e:
                    info["victory_stores_error"] = f"{fn}: {e}"[:300]
                break
        report["israeli_prices"] = info
        print("israeli_prices", json.dumps(info, ensure_ascii=False)[:4000])
    except Exception:
        print("israeli_prices: " + traceback.format_exc()[-600:])

    out = Path(__file__).resolve().parent.parent / "research" / "grocery_probe.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
