"""
Orakul QuickResto ETL Connector — Phase 1: Reference Data.

## Установка

```bash
cd ~/Git/_my/Mozarella/Orakul/etl/quickresto
python3 -m venv venv
source venv/bin/activate  # или venv\Scripts\activate на Windows
pip install -r requirements.txt
```

## Конфигурация

Создай файл `.env` рядом с ETL (или в корне Orakul):

```bash
# QuickResto API credentials
QR_USERNAME=your_login
QR_PASSWORD=your_password
QR_LAYER=web  # web, eu и т.д.

# БД (MVP: SQLite)
ETL_DB_BACKEND=sqlite
ETL_SQLITE_PATH=./etl/quickresto/data/etl.db

# Или PostgreSQL
# ETL_DB_BACKEND=postgres
# ETL_POSTGRES_DSN=postgresql://orakul:***@localhost/orakul

# ETL runtime
ETL_PAGE_SIZE=100
ETL_REQUEST_DELAY=1.0
ETL_DEBUG=false
```

## Запуск

```bash
python -m src.run_sync --venue-id <venue_id>
python -m src.run_sync --debug --venue-id DEMO001
```

## Структура

```
etl/quickresto/
├── src/
│   ├── __init__.py
│   ├── client.py          # Async HTTP клиент QR API
│   ├── config.py          # Конфигурация из .env
│   ├── db.py              # SQLite / PostgreSQL layer
│   ├── run_sync.py        # Entry point
│   ├── sync_products.py   # SingleProduct → product
│   ├── sync_stores.py     # Store → venue
│   ├── sync_dishes.py     # Dish + CookingInvoice → dish + recipe
│   └── transform.py       # Маппинг QR → Orakul
├── tests/
│   └── test_client.py
├── requirements.txt
└── README.md
```

## Фаза 1 — Справочники

| QR module | Orakul staging | Описание |
|---|---|---|
| `warehouse.nomenclature.singleproduct` | `staging_products` | Ингредиенты |
| `warehouse.stores.warehouse` | `staging_stores` | Склады/точки |
| `warehouse.nomenclature.dish` | `staging_dishes` | Блюда |
| `warehouse.documents.cooking` | `staging_recipes` | Рецептуры (через CookingInvoice) |

## Фаза 2+ (в планах)

- `front.orders` → dish_sale / revenue_entry
- `warehouse.documents.incoming` → order (закупки)
- `warehouse.documents.discard` → writeoff (списания)
- `warehouse.documents.inventory` → stock_entry

## Архитектура

```
QuickResto Cloud API
         ↓ HTTPS / REST (async via aiohttp)
    QuickRestoClient
         ↓
     raw_imports   (AS-IS JSONB)
         ↓
    transform.py (маппинг)
         ↓
   staging_* (нормализованные сущности Orakul)
         ↓
     core_* (бизнес-сущности, Phase 2)
```

## Особенности

- **Авторизация**: POST /api/authByUserPasswordLogin → токен → X-Authorization
- **Рецептуры**: хранятся в `CookingInvoice`, а не в `Dish`!
- **Rate limiting**: max 60 req/min через asyncio.Semaphore
- **Retry**: exponential backoff (tenacity) на сетевые ошибки
- **Upsert**: INSERT OR REPLACE (SQLite) / ON CONFLICT UPDATE (PostgreSQL)
