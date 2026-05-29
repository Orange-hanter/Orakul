# Phase C — Core Merge + Tests

## Цель
Из staging перенести в core таблицы с дедупликацией и first_seen/last_seen.

## DDL для core таблиц

```sql
-- Core recipes (deduped по dish_source_id + product_source_id)
CREATE TABLE IF NOT EXISTS core_recipes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    dish_source_id    TEXT NOT NULL,
    product_source_id TEXT NOT NULL,
    quantity          REAL,
    measure_unit      TEXT,
    venue_id          TEXT,
    first_seen        TEXT,
    last_seen         TEXT,
    UNIQUE(dish_source_id, product_source_id, venue_id)
);

-- Core dish categories
CREATE TABLE IF NOT EXISTS core_dish_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   TEXT NOT NULL,
    name        TEXT,
    color       TEXT,
    parent_id   TEXT,
    venue_id    TEXT,
    first_seen  TEXT,
    last_seen   TEXT,
    UNIQUE(source_id, venue_id)
);

-- Core measure units
CREATE TABLE IF NOT EXISTS core_measure_units (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id    TEXT NOT NULL,
    code         TEXT,
    name         TEXT,
    full_name    TEXT,
    parent_ratio REAL,
    system_unit  TEXT,
    first_seen   TEXT,
    last_seen    TEXT,
    UNIQUE(source_id)
);

-- Core semiproducts
CREATE TABLE IF NOT EXISTS core_semiproducts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id        TEXT NOT NULL,
    name             TEXT,
    unit             TEXT,
    ingredients_json TEXT,
    venue_id         TEXT,
    first_seen       TEXT,
    last_seen        TEXT,
    UNIQUE(source_id, venue_id)
);

-- Core shifts (revenue)
CREATE TABLE IF NOT EXISTS core_revenue_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id    TEXT NOT NULL,
    start_date   TEXT,
    end_date     TEXT,
    total        REAL,
    cash         REAL,
    card         REAL,
    currency     TEXT,
    venue_id     TEXT,
    first_seen   TEXT,
    last_seen    TEXT,
    UNIQUE(source_id, venue_id)
);

-- Core cancellations
CREATE TABLE IF NOT EXISTS core_cancellations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   TEXT NOT NULL,
    date        TEXT,
    order_id    TEXT,
    reason      TEXT,
    amount      REAL,
    dish_name   TEXT,
    venue_id    TEXT,
    first_seen  TEXT,
    last_seen   TEXT,
    UNIQUE(source_id, venue_id)
);
```

## Файлы

### `src/db_sqlite.py` — ДОБАВИТЬ

```python
def merge_core(self, entity: str, records: list[dict]) -> int:
    """
    Upsert into core_* tables with first_seen/last_seen.
    Supported: 'products', 'dishes', 'suppliers', 'recipes', 
               'dish_categories', 'measure_units', 'semiproducts',
               'shifts', 'cancellations', 'stock_entries'.
    """
```

## Тесты

### Новые test файлы

| Файл | Что тестирует |
|------|---------------|
| `tests/test_transform.py` | transform_* для всех новых сущностей |
| `tests/test_sync_cooking.py` | CookingInvoice → staging_recipes |
| `tests/test_sync_semiproduct.py` | Semiproduct → staging |
| `tests/test_db_sqlite.py` | DDL + upsert + merge core |

### Test data
Использовать `data/recon/*.json` как fixtures.

### Команды

```bash
cd etl/quickresto
PYTHONPATH=src python -m pytest tests/ -v
```

## DoD
- [ ] Все core таблицы созданы
- [ ] merge_core работает для всех entity
- [ ] first_seen не перезаписывается при обновлении
- [ ] last_seen обновляется при каждом sync
- [ ] Тесты green, coverage ≥70% нового кода
