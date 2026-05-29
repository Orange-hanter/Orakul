# Orakul QuickResto ETL — Foundation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.
> **Priority:** Склад первичен, выручка вторична. Мы в разработке — время есть.

**Goal:** Перестроить ETL на production-ready фундамент: raw_imports + staging + core 3-layer, dual-backend DB (SQLite/PG), инкрементальная синхронизация, cron, тесты на реальных дампах.

**Architecture:** raw_imports сохраняет каждый JSON с entity+run_id. ops.etl_runs хранит watermark (last version). staging таблицы принимают transform-результаты. core таблицы — нормализованные бизнес-данные. Dual-backend через DbConnection protocol.

**Tech Stack:** Python 3.13, aiohttp, sqlite3, psycopg2-binary (PG), tenacity, pytest, asyncio.

**Root:** `~/Git/_my/Mozarella/Orakul/etl/quickresto/`
**Src:** `$ROOT/src/`
**Data:** `$ROOT/data/`
**Tests:** `$ROOT/tests/`

---

## Текущее состояние → Целевое

| Аспект | Текущее | Целевое |
|---|---|---|
| Схема | 1 generic таблица `orakul_records` | `raw_imports`, `staging_*`, `core_*`, `ops.etl_runs` |
| raw | Нет | Есть: вся сущность в JSON с run_id |
| DB Backend | Только SQLite | Dual: SQLite ↔ PostgreSQL switch через env |
| Инкремент | Нет (полный перезалив) | Водяной знак по полю `version` |
| Cron | Нет | Hermes cronjob `*/15 * * * *` |
| Ошибки | Простой logging | Retry + `error_log` таблица |
| Тесты | Нет | Тесты transform на recon-дампах |

---

## Фаза 0: Подготовка — Dual-backend DB Interface

**Цель:** Abstract DbConnection, вынести SQL из sync_*. Рефактор db.py → protocol с реализациями SqliteBackend и PostgresBackend.

### Task F0-1: Interface DbConnection

**Files:**
- Create: `src/db_base.py`

**Step 1:** Создать ABС или Protocol `DbConnection` с методами:
- `insert_raw(entity_type, records, run_id, venue_id) -> int`
- `upsert_staging(table_name, records) -> int`
- `begin() / commit() / rollback()` для транзакций
- `get_watermark(entity: str) -> int` (последний `version` из raw_imports)
- `set_watermark(entity: str, version: int)`
- `log_run(entity, action, count, duration_ms, error)`
- `get_last_run(entity) -> dict`
- `close()`

**Step 2:** Проверка — `python -c "from db_base import DbConnection; print('OK')"`

### Task F0-2: SqliteBackend

**Files:**
- Modify: `src/db.py`
- Create: `src/db_sqlite.py`

**Step 1:** Извлечь из `db.py` SQLite-реализацию в `db_sqlite.py`. Класс `SqliteBackend(DbConnection)`.

**Step 2:** Схема `raw_imports`:
```sql
CREATE TABLE raw_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    entity TEXT NOT NULL,  -- 'incoming_invoice', 'dish', ...
    venue_id TEXT,
    source_id TEXT,        -- QR id
    version INTEGER,       -- QR version для watermark
    data TEXT NOT NULL,      -- full JSON
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_raw_entity_run ON raw_imports(entity, run_id);
CREATE INDEX ix_raw_version ON raw_imports(entity, version);
```

**Step 3:** Схема `ops.etl_runs`:
```sql
CREATE TABLE ops_etl_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL UNIQUE,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    status TEXT DEFAULT 'running',  -- running, success, partial, failed
    error TEXT,
    records_processed INTEGER DEFAULT 0
);
```

**Step 4:** Существующие таблицы `orakul_records` и `etl_sync_log` — депрекировать (оставить, но новый код их не юзать). Комментарий в коде: `DEPRECATED: use raw_imports + staging tables`.

**Step 5:** Связать `db.py` фасадом: `create_db(backend='sqlite') -> SqliteBackend`.

**Step 6:** Проверка: `python -c "from db import create_db; db=create_db(); print(type(db))"` → `<class 'db_sqlite.SqliteBackend'>`

### Task F0-3: PostgresBackend (stub)

**Files:**
- Create: `src/db_postgres.py`

**Step 1:** Заглушка `PostgresBackend` с теми же методами, но `raise NotImplementedError` в каждом. Это placeholder для будущего.

**Step 2:** `create_db()` в `db.py` должен поддерживать backend='postgres' → `PostgresBackend`.

**Step 3:** Проверка: `python -c "from db import create_db; db=create_db('postgres'); print(type(db))"` → `<class 'db_postgres.PostgresBackend'>` без ошибок.

---

## Фаза 1: Raw Imports — сохранение каждого JSON

### Task F1-1: Refactor sync_* на insert_raw

**Files:**
- Modify: `src/sync_products.py`, `src/sync_stores.py`, `src/sync_dishes.py`
- Обновить другие sync_* если появятся

**Step 1:** В каждом sync-модуле заменить прямой `insert_raw` (который сейчас в `db.py`) на вызов через `insert_raw(entity, records, run_id, venue_id)`.

**Step 2:** `sync_products.py`: `db.insert_raw('product', items, run_id, venue_id)`

**Step 3:** `sync_stores.py`: `db.insert_raw('store', items, run_id, venue_id)`

**Step 4:** `sync_dishes.py`: после выгрузки Dish — `db.insert_raw('dish', dishes, run_id, venue_id)`; после CookingInvoice — `db.insert_raw('cooking_invoice', cookings, run_id, venue_id)`

**Step 5:** Проверка: запустить `PYTHONPATH=src python -m src.sync_products` — убедиться что `raw_imports` заполнилась (через DB Browser или sqlite3 CLI).

### Task F1-2: run_sync.py интеграция raw

**Files:**
- Modify: `src/run_sync.py`

**Step 1:** Создать `start_run()` → insert into `ops_etl_runs` → вернуть `run_id` (UUID4 или `datetime.utcnow().strftime('%Y%m%d%H%M%S')`)

**Step 2:** В конце `run_sync()` обновить `ops_etl_runs.status='success', finished_at=now, records_processed=total`.

**Step 3:** Если ошибка — статус 'failed', записать error.

**Step 4:** Проверка: `PYTHONPATH=src python -c "from run_sync import start_run, end_run; rid=start_run(); print(rid); end_run(rid, 'success', 42)"` → row в `ops_etl_runs`.

---

## Фаза 2: Staging + Core схемы

### Task F2-1: staging_products

**Files:**
- Modify: `src/db_sqlite.py` (SCHEMA)

**Step 1:** Таблица `staging_products`:
```sql
CREATE TABLE staging_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    venue_id TEXT,
    source_id TEXT NOT NULL,      -- QR product.id
    name TEXT,
    unit TEXT,
    category TEXT,
    measure_unit_id TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES ops_etl_runs(run_id)
);
CREATE INDEX ix_staging_prod_run ON staging_products(run_id);
```

**Step 2:** Добавить `upsert_staging_products(records)` в `SqliteBackend`.

**Step 3:** Проверка: `INSERT` 2 записи → `SELECT * FROM staging_products` → 2 rows.

### Task F2-2: staging_dishes + staging_recipes

**Step 1:** `staging_dishes`:
```sql
CREATE TABLE staging_dishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    venue_id TEXT,
    source_id TEXT,
    name TEXT,
    category TEXT,
    sell_price REAL,
    active INTEGER,  -- bool
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Step 2:** `staging_recipes` (из CookingInvoice modifierLinks):
```sql
CREATE TABLE staging_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    venue_id TEXT,
    dish_source_id TEXT,      -- QR Dish.id
    product_source_id TEXT,   -- QR SingleProduct.id
    quantity REAL,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Step 3:** Проверка `upsert_staging_dishes`, `insert_staging_recipes`.

### Task F2-3: staging_suppliers + staging_incoming_invoices

**Step 1:** `staging_suppliers`:
```sql
CREATE TABLE staging_suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    venue_id TEXT,
    source_id TEXT,
    name TEXT,
    contact TEXT,
    status TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Step 2:** `staging_incoming_invoices`:
```sql
CREATE TABLE staging_incoming_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    venue_id TEXT,
    source_id TEXT,
    document_number TEXT,
    supplier_source_id TEXT,
    invoice_date TEXT,
    total_sum REAL,
    total_sum_wo_nds REAL,
    processed INTEGER,  -- bool
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Step 3:** Проверка — insert + select.

### Task F2-4: core таблицы (минимум)

**Step 1:** `core_products`:
```sql
CREATE TABLE core_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id TEXT,
    source_id TEXT NOT NULL UNIQUE,  -- QR id
    name TEXT,
    unit TEXT,
    category TEXT,
    first_seen_at TEXT,
    updated_at TEXT
);
```

**Step 2:** `core_suppliers` (аналогично).

**Step 3:** `core_stock_entries` (для incoming, discard, inventory):
```sql
CREATE TABLE core_stock_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id TEXT,
    kind TEXT,  -- 'receipt', 'writeoff', 'inventory', 'cooking'
    source_id TEXT,
    product_source_id TEXT,
    delta REAL,
    resulting REAL,
    document_date TEXT,
    note TEXT,
    first_seen_at TEXT,
    updated_at TEXT
);
```

**Step 4:** Проверка — схема создаётся без ошибок (`PRAGMA table_list` показывает все таблицы).

---

## Фаза 3: Dual-backend refactor

### Task F3-1: DbConnection protocol через ABC

**Files:**
- Modify: `src/db_base.py`

**Step 1:** Перевести `DbConnection` с Protocol на abc.ABC — `from abc import ABC, abstractmethod`.

**Step 2:** Убедиться что оба backend `SqliteBackend` и `PostgresBackend` наследуют `DbConnection`.

**Step 3:** `create_db()` в `db.py`:
```python
def create_db(backend=None):
    backend = backend or config.DB_BACKEND
    if backend == 'sqlite':
        return SqliteBackend(config.SQLITE_PATH)
    elif backend == 'postgres':
        return PostgresBackend(config.POSTGRES_DSN)
    raise ValueError(f"Unknown backend: {backend}")
```

### Task F3-2: PostgresBackend — реальная реализация (минимум)

**Files:**
- Modify: `src/db_postgres.py`

**Step 1:** Подключение через `psycopg2.connect(dsn)`. Методы:
- `insert_raw` → `executemany` `INSERT INTO raw_imports ... ON CONFLICT DO NOTHING`
- `upsert_staging` → аналогично с `ON CONFLICT (source_id) DO UPDATE`
- `get_watermark` → `SELECT MAX(version) FROM raw_imports WHERE entity=%s`

**Step 2:** Тест: если `ETL_DB_BACKEND=postgres` и `POSTGRES_DSN` задан → connect. Если не задан → `RuntimeError("PostgreSQL DSN not configured")`.

**Step 3:** Проверка: `ETL_DB_BACKEND=postgres python -c "from db import create_db; db=create_db(); db.close()"` → работает или понятная ошибка.

---

## Фаза 4: Инкрементальная синхронизация

### Task F4-1: Watermark strategy

**Философия:** QuickResto API возвращает поле `version` (инкрементальный номер изменения). Мы храним `MAX(version)` в `raw_imports` и при следующем запросе делаем `WHERE version > watermark`. Но `/api/list` QuickResto **не поддерживает фильтр по version** по документации. Поэтому — fallback: сравниваем `version` после получения списка и пропускаем уже имеющиеся записи (source_id + version совпадают).

Если API вдруг поддерживает фильтр (надо проверить в recon) — используем его. Иначе:
1. Забираем все записи
2. Сравниваем `version` с `MAX(raw_imports.version)` для entity
3. Записываем только `version > watermark`
4. Обновляем watermark

### Task F4-2: client.py — фильтр по version (если поддерживается)

**Step 1:** В `list_entities` добавить `version_since: int | None = None`.

**Step 2:** Если задан — добавлять в params `filters`: `[{"field":"version","operator":">","value":version_since}]`.

**Step 3:** Проверка: `await client.list_entities(..., version_since=12345)` — если QR вернёт меньше записей → работает. Если вернёт всё → фильтр не работает, fallback.

### Task F4-3: Sync-модули — инкремент

**Files:**
- Modify: все `src/sync_*.py`

**Step 1:** Каждый sync-модуль получает `watermark`:
```python
watermark = db.get_watermark(entity_name)
items = await client.list_entities(...)  # или с version_since
new_items = [i for i in items if int(i.get('version', 0)) > watermark]
```

**Step 2:** `db.insert_raw(entity, new_items, run_id, venue_id)`

**Step 3:** `db.set_watermark(entity, max(int(i['version']) for i in new_items) if new_items else watermark)`

**Step 4:** Лог: `logger.info("[%s] total=%d new=%d watermark=%d", entity, len(items), len(new_items), watermark)`

### Task F4-4: run_sync.py — полный vs инкремент

**Step 1:** Добавить env `ETL_FULL_SYNC=true/false` (default false).

**Step 2:** Если `full_sync=true` — watermark=0, сброс и полная загрузка.

**Step 3:** `run_sync()` обходит все entity в порядке зависимостей:
1. `measure_units` (reference)
2. `stores` (reference)
3. `suppliers` (reference)
4. `products` (reference)
5. `dishes` (зависит от products)
6. `recipes` (из cooking_invoice, зависит от dishes)
7. `incoming_invoices` (зависит от suppliers)
8. `discard_invoices` (зависит от products)
9. `inventory` (зависит от products)
10. `shifts` (нет зависимостей)

**Step 4:** Каждый sync-вызов оборачиваем в try/except → при ошибке `db.log_run(entity, 'failed', error=...)`, статус run='partial'.

---

## Фаза 5: Cron — автоматический запуск

### Task F5-1: Hermes Cron job

**Step 1:** Создать cronjob:
```bash
hermes cronjob create \
  --schedule="*/15 * * * *" \
  --name="quickresto-etl" \
  --command="cd ~/Git/_my/Mozarella/Orakul/etl/quickresto && PYTHONPATH=src python -m src.run_sync" \
  --log="$ROOT/data/cron.log"
```

**Step 2:** Проверка: `hermes cronjob list` → job появился.

**Step 3:** Тестовый запуск: `hermes cronjob run <id>` → проверить `ops_etl_runs`.

---

## Фаза 6: Transform рефакторинг + тесты на дампах

### Task F6-1: transform.py — мапперы под staging

**Files:**
- Modify: `src/transform.py`

**Step 1:** Каждый маппер возвращает dict совместимый с staging таблицей (не generic JSON):

```python
def map_product(raw: dict, venue_id: str) -> dict:
    return {
        'source_id': str(raw['id']),
        'name': raw.get('name', raw.get('itemTitle', '')) or 'Без названия',
        'unit': _map_unit(raw.get('measureUnit', {}).get('id')),
        'category': raw.get('itemTitle', ''),
        'measure_unit_id': str(raw.get('measureUnit', {}).get('id') or ''),
    }
```

**Step 2:** `map_dish` → `staging_dishes` compatible dict.

**Step 3:** `map_recipe` → `staging_recipes` compatible dict (одна строка на один ingredient).

**Step 4:** `map_supplier` → `staging_suppliers`.

**Step 5:** `map_incoming_invoice` → `staging_incoming_invoices`.

### Task F6-2: Тесты на реальных дампах

**Files:**
- Create: `tests/test_transform.py`
- Create: `tests/conftest.py`

**Step 1:** `conftest.py`: pytest fixture `recon_data()` читает первые N записей из `data/recon/recon_*.json`.

**Step 2:** Тест `test_transform_product` — берёт первую запись из `recon_ingredient_*.json`, вызывает `map_product()`, проверяет что `name` не None, `unit` in ('шт','кг','л','порц').

**Step 3:** Тест `test_transform_dish` — из `recon_dish_*.json`, проверяет `sell_price >= 0`, `ingredients` — list.

**Step 4:** Тест `test_transform_incoming_invoice` — из `recon_incoming_invoice_*.json`, проверяет `document_number` not empty.

**Step 5:** Запуск: `pytest tests/test_transform.py -v`

### Task F6-3: Core populate — raw → staging → core

**Files:**
- Create: `src/core_sync.py`

**Step 1:** `populate_core_products(db)` — `INSERT OR REPLACE INTO core_products SELECT DISTINCT ... FROM staging_products`.

**Step 2:** `populate_core_suppliers` — аналогично.

**Step 3:** `populate_core_stock` — incoming + discard + inventory → `core_stock_entries`.

**Step 4:** `run_sync.py` вызывает `populate_core_*` после всех sync-модулей.

---

## Фаза 7: Error handling + мониторинг

### Task F7-1: Error log таблица

**Step 1:** `ops_sync_errors`:
```sql
CREATE TABLE ops_sync_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    entity TEXT,
    source_id TEXT,
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Step 2:** В каждом sync-модуле: `except Exception as e: db.log_error(run_id, entity, source_id, str(e))`.

### Task F7-2: Health check endpoint

**Files:**
- Create: `src/health.py`

**Step 1:** `health_check(db)` → возвращает dict:
```python
{
    "last_run": db.get_last_run(),
    "recent_errors": db.get_errors(limit=5),
    "entity_counts": {entity: db.count_raw(entity) for entity in ENTITY_LIST},
}
```

**Step 2:** CLI: `python -m src.health` → печатает JSON.

---

## Acceptance Criteria

1. `PYTHONPATH=src python -m src.run_sync` — проходит до конца, `ops_etl_runs.status='success'`.
2. `raw_imports` содержит все entity заданные в `run_sync.py`.
3. `staging_*` таблицы заполнены transform'ированными данными.
4. `core_*` таблицы содержат нормализованные записи.
5. `pytest tests/ -q` — все тесты проходят.
6. Инкремент: второй запуск `run_sync` обрабатывает 0 новых записей (если данные не менялись).
7. Cron job запускается без ошибок.
8. `ETL_DB_BACKEND=postgres` — создаёт `PostgresBackend` (может fail на подключении, но не на import).

---

## Risk: Known Issues

1. **`/api/read` мёртв** (415/405) — без него нельзя прочитать строки IncomingInvoice.items. Решение: агрегировать totalSum на уровне документа, строки — приоритет Phase 2.
2. **OrderInfo = []** — нет детализации заказов. Решение: revenue через Shift.
3. **QuickResto фильтр по version** — может не работать. Fallback: client-side dedup.

---

## Execution Order

```
F0 → F1 → F2 → F3 → F4 → F5 → F6 → F7
```

F0-F3 — фундаментальные, без них ничего не работает.
F4-F7 — надстройки, можно параллелизовать после F2.

**Ready to execute via subagent-driven-development.**
