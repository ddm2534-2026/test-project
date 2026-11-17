# Загрузка цен Victory: запускается как задача Cloud Run в регионе me-west1 (Тель-Авив),
# потому что laibcatalog.co.il не отвечает на запросы из-за рубежа.
FROM python:3.12-slim
WORKDIR /app
COPY scraper/ /app/scraper/
ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/scraper/grocery_ingest.py", "victory", "victory_store"]
