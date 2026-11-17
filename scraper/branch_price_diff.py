"""Насколько отличаются цены между филиалами Шуферсаля (разные форматы: Дил, Шели, Экспресс, Йеш, онлайн)."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_supermarkets import opener, get, parse_xml, low, txt  # noqa: E402

op = opener()


def prices(sid):
    page = get(op, f"https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId={sid}").decode("utf-8", "replace")
    ls = re.findall(r'href="(https://[^"]+?\.gz[^"]*)"', page)
    if not ls:
        return None
    root = low(parse_xml(get(op, ls[0].replace("&amp;", "&"), timeout=300)))
    return {txt(i, "itemcode"): float(txt(i, "itemprice") or 0) for i in root.iter("item") if re.fullmatch(r"\d{8,14}", txt(i, "itemcode"))}


def cmp(a, b, label):
    A, B = prices(a), prices(b)
    if not A or not B:
        print(label, a, b, "нет файла")
        return
    n = d = 0
    s = 0.0
    for c, p in A.items():
        if c in B and p > 0:
            n += 1
            d += abs(B[c] - p) >= 0.01
            s += (B[c] - p) / p
    print(f"{label} {a}→{b}: общих {n}, отличается {d} ({100 * d / n:.1f}%), средняя {100 * s / n:.2f}%")


for a, b, label in [(14, 18, "Дил↔Дил"), (14, 45, "Дил↔Дил"), (14, 290, "Дил↔Дил"), (1, 2, "Шели↔Шели"), (14, 1, "Дил↔Шели"),
                    (14, 29, "Дил↔Экспресс"), (14, 12, "Дил↔Йеш"), (14, 413, "Дил↔онлайн"), (1, 413, "Шели↔онлайн")]:
    try:
        cmp(a, b, label)
    except Exception as e:
        print(label, "ошибка", e)
