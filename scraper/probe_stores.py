"""Разведка: можно ли собирать скидки с сайта магазина.

Для каждого домена из research/candidates.json делает 2–4 вежливых запроса
(главная, robots.txt и одна проверка по платформе) и определяет:
  - на какой платформе сайт (Shopify, WooCommerce, Magento, Konimbo, Wix, ...);
  - есть ли открытый каталог в JSON (как у Shopify);
  - не показывает ли сайт серверам страницу-проверку против ботов;
  - что сказано в robots.txt.

Результат: research/probe.json и таблица research/probe.md.
Запуск: python scraper/probe_stores.py
"""

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CANDIDATES = ROOT / "research" / "candidates.json"
OUT_JSON = ROOT / "research" / "probe.json"
OUT_MD = ROOT / "research" / "probe.md"
UA = "test-project-deals-bot/0.1 (+https://github.com/ddm2534-2026/test-project)"
PAUSE = 2.0

CHALLENGE = re.compile(
    r"just a moment|attention required|verify you are human|cf-chl|captcha|"
    r"עבור לדף המבוקש|access denied|request unsuccessful|incapsula|perimeterx|datadome",
    re.I,
)


def get(url, accept="text/html"):
    time.sleep(PAUSE)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.geturl(), dict(r.headers), r.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        body = e.read(200_000).decode("utf-8", "replace") if e.fp else ""
        return e.code, url, dict(e.headers or {}), body
    except Exception as e:
        return None, url, {}, f"{type(e).__name__}: {e}"


def platform_of(html, headers):
    h = {k.lower(): v for k, v in headers.items()}
    if "x-shopid" in h or "cdn.shopify.com" in html or "Shopify.theme" in html:
        return "Shopify"
    if "konimbo" in html.lower():
        return "Konimbo"
    if "wp-content" in html or "woocommerce" in html.lower():
        return "WooCommerce" if "woocommerce" in html.lower() else "WordPress"
    if "Magento" in html or "x-magento" in str(h) or "mage/" in html:
        return "Magento"
    if "wixstatic.com" in html or "Wix.com" in html:
        return "Wix"
    if "__NEXT_DATA__" in html:
        return "Next.js (своя разработка)"
    if "/_nuxt/" in html:
        return "Nuxt (своя разработка)"
    if "bigcommerce" in html.lower():
        return "BigCommerce"
    if "salesforce" in html.lower() or "demandware" in html.lower():
        return "Salesforce Commerce"
    return "не определена"


def probe(domain):
    res = {"domain": domain}
    status, final, headers, html = None, None, {}, ""
    for base in (f"https://www.{domain}", f"https://{domain}"):
        status, final, headers, html = get(base + "/")
        if status:
            break
    res["status"] = status
    res["final_url"] = final
    if not status:
        res["verdict"] = "сайт не отвечает"
        res["error"] = html[:150]
        return res
    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    res["title"] = re.sub(r"\s+", " ", title.group(1)).strip()[:90] if title else ""
    res["html_size"] = len(html)
    blocked = status in (401, 403, 429, 503) or (len(html) < 4000 and CHALLENGE.search(html)) \
        or bool(CHALLENGE.search(res["title"]))
    res["challenge"] = bool(blocked)
    res["platform"] = platform_of(html, headers)
    origin = re.match(r"https?://[^/]+", final).group(0)

    rs, _, _, robots = get(origin + "/robots.txt", "text/plain")
    disallow_all = bool(re.search(r"(?ims)^user-agent:\s*\*\s*$.*?^disallow:\s*/\s*$", robots or "")) if rs == 200 else False
    res["robots_disallow_all"] = disallow_all

    if res["platform"] == "Shopify" and not blocked:
        ps, _, _, body = get(origin + "/products.json?limit=250", "application/json")
        try:
            prods = json.loads(body).get("products", [])
            res["open_catalog"] = True
            res["sample_products"] = len(prods)
            res["sample_discounted"] = sum(
                1 for p in prods
                if any(float(v.get("compare_at_price") or 0) > float(v.get("price") or 0) for v in p.get("variants", []))
            )
        except Exception:
            res["open_catalog"] = False
            res["catalog_status"] = ps
    elif res["platform"] == "WooCommerce" and not blocked:
        ps, _, _, body = get(origin + "/wp-json/wc/store/v1/products?per_page=50", "application/json")
        try:
            prods = json.loads(body)
            res["open_catalog"] = isinstance(prods, list)
            res["sample_products"] = len(prods) if isinstance(prods, list) else 0
            res["sample_discounted"] = sum(1 for p in prods if p.get("on_sale")) if isinstance(prods, list) else 0
        except Exception:
            res["open_catalog"] = False
            res["catalog_status"] = ps

    if blocked:
        res["verdict"] = "защита от ботов: нужен договор / партнёрский фид"
    elif res.get("open_catalog"):
        res["verdict"] = "легко: открытый каталог в JSON"
    elif res["platform"] in ("Konimbo", "Magento", "WooCommerce", "WordPress"):
        res["verdict"] = "средне: разбор HTML (есть готовый парсер)" if res["platform"] == "Konimbo" else "средне: разбор HTML"
    elif res["platform"] == "Wix":
        res["verdict"] = "сложно: Wix рисует товары скриптами"
    else:
        res["verdict"] = "нужно смотреть вручную (или ИИ через ScrapeGraph)"
    if disallow_all:
        res["verdict"] += "; robots.txt запрещает обход"
    return res


def main():
    cands = json.loads(CANDIDATES.read_text("utf-8"))
    results = []
    for c in cands:
        print(f"→ {c['name']} ({c['domain']})", flush=True)
        r = probe(c["domain"])
        r.update({"name": c["name"], "kind": c.get("kind", "")})
        print(f"  {r.get('status')} | {r.get('platform', '-')} | {r['verdict']} | "
              f"скидок в выборке: {r.get('sample_discounted', '-')}/{r.get('sample_products', '-')} | {r.get('title', '')}",
              flush=True)
        results.append(r)

    OUT_JSON.write_text(json.dumps(results, ensure_ascii=False, indent=2), "utf-8")
    lines = ["# Разведка магазинов\n", "| Магазин | Сайт | Платформа | Вывод | Скидок в выборке |", "|---|---|---|---|---|"]
    for r in results:
        sample = f"{r['sample_discounted']} из {r['sample_products']}" if "sample_products" in r else ""
        lines.append(f"| {r['name']} | {r.get('final_url') or r['domain']} | {r.get('platform', '-')} | {r['verdict']} | {sample} |")
    OUT_MD.write_text("\n".join(lines) + "\n", "utf-8")


if __name__ == "__main__":
    main()
