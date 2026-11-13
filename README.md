# test-project

Сборщик скидок на детские товары через [ScrapeGraph API](https://docs.scrapegraphai.com).
Раз в день GitHub Actions обходит магазины из `stores.json`, ИИ находит на страницах
товары со скидкой, а результат сохраняется в `data/deals.json` и `data/deals.md`.

## Структура

| Файл | Что это |
|---|---|
| `stores.json` | Список магазинов: название, ссылка на страницу акций, `enabled` |
| `scraper/scrape_deals.py` | Скрипт сбора (только стандартный Python, без зависимостей) |
| `.github/workflows/scrape.yml` | Запуск каждый день и по кнопке |
| `data/deals.md` | Таблица найденных скидок (появится после первого запуска) |
| `data/deals.json` | То же в JSON, для сайта или бота |

## Настройка (один раз)

1. **Ключ API.** Settings → Secrets and variables → Actions → New repository secret,
   имя `SGAI_API_KEY`, значение — ключ из личного кабинета ScrapeGraph.
2. **Магазины.** В `stores.json` укажи реальные ссылки на страницы со скидками
   и поставь `"enabled": true`.
3. **Запуск.** Вкладка Actions → «Сбор скидок» → Run workflow.
   Дальше запускается сам каждый день.

## Локальный запуск

```bash
SGAI_API_KEY=... python scraper/scrape_deals.py
```
