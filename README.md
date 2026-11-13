# test-project

Сборщик скидок на детские товары. Раз в день GitHub Actions обходит магазины
из `stores.json` и сохраняет товары со скидкой в `data/deals.json` и `data/deals.md`.

Два режима, поле `type` в `stores.json`:

- `shopify` — магазин на Shopify (например, toysrus.co.il). Товары берутся из открытого
  JSON-каталога коллекции: точные цены, без ИИ, бесплатно. Только товары в наличии.
- `ai` — любой другой сайт. Страницу разбирает ИИ через
  [ScrapeGraph API](https://docs.scrapegraphai.com), нужен ключ `SGAI_API_KEY`.

## Структура

| Файл | Что это |
|---|---|
| `stores.json` | Список магазинов: название, ссылка на страницу акций, `enabled` |
| `scraper/scrape_deals.py` | Скрипт сбора (только стандартный Python, без зависимостей) |
| `.github/workflows/scrape.yml` | Запуск каждый день и по кнопке |
| `data/deals.md` | Таблица найденных скидок (появится после первого запуска) |
| `data/deals.json` | То же в JSON, для сайта или бота |

## Настройка (один раз)

1. **Ключ API** (нужен только для магазинов с `type: ai`). Settings → Secrets and variables → Actions → New repository secret,
   имя `SGAI_API_KEY`, значение — ключ из личного кабинета ScrapeGraph.
2. **Магазины.** В `stores.json`: название, ссылка, `type` и `"enabled": true`.
   Для Shopify ссылка — на коллекцию, например `/collections/november-sale`.
3. **Запуск.** Вкладка Actions → «Сбор скидок» → Run workflow.
   Дальше запускается сам каждый день.

## Локальный запуск

```bash
SGAI_API_KEY=... python scraper/scrape_deals.py
```
