---
Документ: Data Model & Pipeline Spec
Версия: 1.0
Дата: 2026-05-09
Статус: Утверждён
Владелец: Data Lead + Tech Lead
Связанные документы: [MVP Architecture](00-mvp-architecture.md), [Kiepper Integration Recon](01-kiepper-integration-recon.md), [ML & Forecasting Spec](03-ml-and-forecasting-spec.md), [Data Audit Checklist](../04-implementation/04-data-audit-checklist-kiepper.md), [Data Governance](../05-governance/03-data-governance.md)
---


<!-- KIEPPER-DEPRECATED-NOTE -->
> **Примечание о Kiepper (обновлено 2026-05-29):** Интеграция с системой Kiepper **не используется** и перенесена в архив. Orakul работает исключительно с **QuickResto** API. Документы Kiepper сохранены для истории; актуальная интеграция — [QuickResto Integration Spec](../08-technical/09-quickresto-integration-spec.md).


# Data Model & Pipeline Spec

## 0. Принципы

1. **Raw неприкосновенен.** В `raw.*` никогда не удаляем и не правим — только добавляем. Это откат «до» любой трансформации.
2. **Идемпотентные трансформации.** Перегнать staging / core из raw можно сколько угодно раз без побочных эффектов.
3. **Один ключ — один смысл.** Surrogate `id` в core никогда не переиспользуется. Источниковый ключ Kiepper хранится отдельно (`source_id`).
4. **Всё логируется.** Каждый ETL-run — запись в `ops.etl_runs`. Молчаливых успехов не бывает.
5. **Null — явный враг.** Критичные поля (ingredient_id, quantity, date) NOT NULL на уровне схемы. Запись с NULL в критичном поле не попадает в staging.

---

## 1. Слои данных

```
                 ┌─────────────────────────────────────┐
                 │  raw.*  (AS-IS из Kiepper)           │
                 │  JSONB + import_ts + source_entity   │
                 │  Ничего не меняем, только добавляем  │
                 └──────────────┬──────────────────────┘
                                │ transform_staging.py
                 ┌──────────────▼──────────────────────┐
                 │  staging.*  (нормализация)           │
                 │  Приведение типов, UoM, дедупликация │
                 │  Фильтрация мусора                   │
                 └──────────────┬──────────────────────┘
                                │ load_core.py
                 ┌──────────────▼──────────────────────┐
                 │  core.*  (бизнес-сущности)           │
                 │  FK-связи, история версий            │
                 │  SCD Type 2 для рецептур             │
                 └──────────────┬──────────────────────┘
                                │ aggregate_marts.py
                 ┌──────────────▼──────────────────────┐
                 │  marts.*  (агрегаты и прогнозы)      │
                 │  daily_consumption, forecasts,       │
                 │  anomalies, alerts_queue             │
                 └──────────────────────────────────────┘

                 ┌─────────────────────────────────────┐
                 │  ops.*  (служебные таблицы)          │
                 │  etl_runs, model_runs, alert_log     │
                 └─────────────────────────────────────┘
```

---

## 2. Схема `raw.*`

Единая структура для всех сущностей — JSONB-обёртка.

```sql
CREATE TABLE raw.imports (
    id              BIGSERIAL PRIMARY KEY,
    source_entity   VARCHAR(64)  NOT NULL,   -- 'sku', 'recipes', 'sales', etc.
    source_id       VARCHAR(128),            -- ID в Kiepper (строка или число)
    payload         JSONB        NOT NULL,   -- полный объект из Kiepper AS-IS
    import_ts       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    etl_run_id      BIGINT       REFERENCES ops.etl_runs(id),
    location_id     VARCHAR(64),             -- если multitenancy на уровне raw
    is_processed    BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX ON raw.imports (source_entity, import_ts);
CREATE INDEX ON raw.imports (source_entity, source_id, import_ts DESC);
```

> `payload` — неизменный слепок ответа Kiepper. При изменении схемы Kiepper видим это здесь и правим только transform_staging.py, не трогая raw.

---

## 3. Схема `staging.*`

Нормализованные, типизированные версии — один к одному с сущностями Kiepper, но без JSONB.

### `staging.sku`
```sql
CREATE TABLE staging.sku (
    source_id       VARCHAR(128)  NOT NULL,
    name            VARCHAR(512)  NOT NULL,
    base_unit       VARCHAR(16)   NOT NULL,   -- 'kg' | 'l' | 'pcs' (нормализованная UoM)
    category        VARCHAR(256),
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    source_updated  TIMESTAMPTZ,
    staged_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    raw_import_id   BIGINT        REFERENCES raw.imports(id)
);
```

### `staging.recipes`
```sql
CREATE TABLE staging.recipes (
    source_id           VARCHAR(128) NOT NULL,
    menu_item_source_id VARCHAR(128) NOT NULL,
    ingredient_source_id VARCHAR(128) NOT NULL,
    quantity_base       NUMERIC(12,6) NOT NULL,   -- всегда в base_unit ингредиента
    valid_from          DATE,
    valid_to            DATE,
    staged_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_import_id       BIGINT REFERENCES raw.imports(id)
);
```

### `staging.menu_items`
```sql
CREATE TABLE staging.menu_items (
    source_id       VARCHAR(128)  NOT NULL,
    name            VARCHAR(512)  NOT NULL,
    category        VARCHAR(256),
    price           NUMERIC(12,2),
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    staged_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    raw_import_id   BIGINT        REFERENCES raw.imports(id)
);
```

### `staging.sales`
```sql
CREATE TABLE staging.sales (
    source_id           VARCHAR(128)  NOT NULL,
    location_source_id  VARCHAR(128)  NOT NULL,
    menu_item_source_id VARCHAR(128)  NOT NULL,
    quantity            NUMERIC(12,4) NOT NULL,   -- порций
    closed_at           TIMESTAMPTZ   NOT NULL,
    price_at_sale       NUMERIC(12,2),
    is_cancelled        BOOLEAN       NOT NULL DEFAULT FALSE,
    staged_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    raw_import_id       BIGINT        REFERENCES raw.imports(id)
);
```

### `staging.deliveries`
```sql
CREATE TABLE staging.deliveries (
    source_id               VARCHAR(128)  NOT NULL,
    location_source_id      VARCHAR(128)  NOT NULL,
    supplier_source_id      VARCHAR(128),
    ingredient_source_id    VARCHAR(128)  NOT NULL,
    quantity_base           NUMERIC(12,6) NOT NULL,   -- в base_unit
    price_per_base_unit     NUMERIC(12,4),
    delivered_at            TIMESTAMPTZ   NOT NULL,
    status                  VARCHAR(32)   NOT NULL,   -- 'posted' | 'draft' | 'cancelled'
    staged_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    raw_import_id           BIGINT        REFERENCES raw.imports(id)
);
```

### `staging.stock_snapshots`
```sql
CREATE TABLE staging.stock_snapshots (
    source_id               VARCHAR(128)  NOT NULL,
    location_source_id      VARCHAR(128)  NOT NULL,
    ingredient_source_id    VARCHAR(128)  NOT NULL,
    quantity_base           NUMERIC(12,6) NOT NULL,   -- в base_unit
    taken_at                TIMESTAMPTZ   NOT NULL,
    snapshot_type           VARCHAR(32),              -- 'inventory' | 'shift_open' | 'shift_close'
    staged_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    raw_import_id           BIGINT        REFERENCES raw.imports(id)
);
```

### `staging.writeoffs`
```sql
CREATE TABLE staging.writeoffs (
    source_id               VARCHAR(128)  NOT NULL,
    location_source_id      VARCHAR(128)  NOT NULL,
    ingredient_source_id    VARCHAR(128)  NOT NULL,
    quantity_base           NUMERIC(12,6) NOT NULL,
    reason                  VARCHAR(512),
    written_at              TIMESTAMPTZ   NOT NULL,
    staged_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    raw_import_id           BIGINT        REFERENCES raw.imports(id)
);
```

---

## 4. Схема `core.*`

Бизнес-сущности с суррогатными ключами и ссылочной целостностью.

### `core.locations`
```sql
CREATE TABLE core.locations (
    id              SERIAL PRIMARY KEY,
    source_id       VARCHAR(128) NOT NULL UNIQUE,
    name            VARCHAR(512) NOT NULL,
    timezone        VARCHAR(64)  NOT NULL DEFAULT 'Europe/Moscow',
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);
```

### `core.ingredients`
```sql
CREATE TABLE core.ingredients (
    id              SERIAL PRIMARY KEY,
    source_id       VARCHAR(128) NOT NULL UNIQUE,
    name            VARCHAR(512) NOT NULL,
    base_unit       VARCHAR(16)  NOT NULL,   -- 'kg' | 'l' | 'pcs'
    category        VARCHAR(256),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### `core.menu_items`
```sql
CREATE TABLE core.menu_items (
    id              SERIAL PRIMARY KEY,
    source_id       VARCHAR(128) NOT NULL UNIQUE,
    name            VARCHAR(512) NOT NULL,
    category        VARCHAR(256),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);
```

### `core.recipes` (SCD Type 2 — история изменений норм)
```sql
CREATE TABLE core.recipes (
    id              SERIAL PRIMARY KEY,
    menu_item_id    INT          NOT NULL REFERENCES core.menu_items(id),
    ingredient_id   INT          NOT NULL REFERENCES core.ingredients(id),
    quantity_base   NUMERIC(12,6) NOT NULL,   -- в base_unit ингредиента
    valid_from      DATE         NOT NULL DEFAULT '1970-01-01',
    valid_to        DATE         NOT NULL DEFAULT '9999-12-31',
    is_current      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Только одна «текущая» запись на пару (menu_item, ingredient):
CREATE UNIQUE INDEX ON core.recipes (menu_item_id, ingredient_id)
    WHERE is_current = TRUE;
```

> SCD Type 2 позволяет пересчитывать исторический теоретический расход корректно: норма на дату продажи, а не текущая норма.

### `core.sales`
```sql
CREATE TABLE core.sales (
    id              BIGSERIAL PRIMARY KEY,
    location_id     INT          NOT NULL REFERENCES core.locations(id),
    menu_item_id    INT          NOT NULL REFERENCES core.menu_items(id),
    quantity        NUMERIC(12,4) NOT NULL,
    closed_at       TIMESTAMPTZ  NOT NULL,
    price_at_sale   NUMERIC(12,2),
    source_id       VARCHAR(128)
);

CREATE INDEX ON core.sales (location_id, closed_at DESC);
CREATE INDEX ON core.sales (menu_item_id, closed_at DESC);
```

### `core.deliveries`
```sql
CREATE TABLE core.deliveries (
    id                  BIGSERIAL PRIMARY KEY,
    location_id         INT          NOT NULL REFERENCES core.locations(id),
    ingredient_id       INT          NOT NULL REFERENCES core.ingredients(id),
    quantity_base       NUMERIC(12,6) NOT NULL,
    price_per_base_unit NUMERIC(12,4),
    delivered_at        TIMESTAMPTZ  NOT NULL,
    source_id           VARCHAR(128)
);

CREATE INDEX ON core.deliveries (location_id, delivered_at DESC);
```

### `core.stock_snapshots`
```sql
CREATE TABLE core.stock_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    location_id     INT          NOT NULL REFERENCES core.locations(id),
    ingredient_id   INT          NOT NULL REFERENCES core.ingredients(id),
    quantity_base   NUMERIC(12,6) NOT NULL,
    taken_at        TIMESTAMPTZ  NOT NULL,
    snapshot_type   VARCHAR(32),
    source_id       VARCHAR(128)
);

CREATE INDEX ON core.stock_snapshots (location_id, ingredient_id, taken_at DESC);
```

### `core.writeoffs`
```sql
CREATE TABLE core.writeoffs (
    id              BIGSERIAL PRIMARY KEY,
    location_id     INT          NOT NULL REFERENCES core.locations(id),
    ingredient_id   INT          NOT NULL REFERENCES core.ingredients(id),
    quantity_base   NUMERIC(12,6) NOT NULL,
    reason          VARCHAR(512),
    written_at      TIMESTAMPTZ  NOT NULL,
    source_id       VARCHAR(128)
);
```

---

## 5. Схема `marts.*`

Агрегаты, готовые к потреблению Forecast Engine и Alert Engine.

### `marts.daily_consumption`
```sql
CREATE TABLE marts.daily_consumption (
    id                  BIGSERIAL PRIMARY KEY,
    location_id         INT     NOT NULL REFERENCES core.locations(id),
    ingredient_id       INT     NOT NULL REFERENCES core.ingredients(id),
    date                DATE    NOT NULL,
    -- Теоретический расход
    theoretical_qty     NUMERIC(12,6),   -- Σ (продажи × норма)
    -- Фактический расход (из стоков)
    stock_open          NUMERIC(12,6),
    deliveries_qty      NUMERIC(12,6),
    writeoffs_qty       NUMERIC(12,6),
    stock_close         NUMERIC(12,6),
    actual_qty          NUMERIC(12,6),   -- open + deliveries - writeoffs - close
    -- Отклонение
    deviation_qty       NUMERIC(12,6),   -- actual - theoretical
    deviation_pct       NUMERIC(8,2),    -- deviation / theoretical * 100
    has_full_data       BOOLEAN,         -- все 4 слагаемых присутствуют?
    calculated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (location_id, ingredient_id, date)
);

CREATE INDEX ON marts.daily_consumption (location_id, date DESC);
CREATE INDEX ON marts.daily_consumption (ingredient_id, date DESC);
```

### `marts.forecasts`
```sql
CREATE TABLE marts.forecasts (
    id                  BIGSERIAL PRIMARY KEY,
    location_id         INT     NOT NULL REFERENCES core.locations(id),
    ingredient_id       INT     NOT NULL REFERENCES core.ingredients(id),
    forecast_date       DATE    NOT NULL,  -- на какой день прогноз
    created_at          DATE    NOT NULL,  -- когда создан прогноз
    predicted_qty       NUMERIC(12,6),    -- прогнозный расход в base_unit
    lower_bound         NUMERIC(12,6),    -- CI нижняя граница
    upper_bound         NUMERIC(12,6),    -- CI верхняя граница
    model_type          VARCHAR(32),      -- 'baseline_ma7' | 'ets' | 'prophet'
    mape                NUMERIC(8,4),     -- MAPE на holdout (последние 14 дней)
    forecast_quality    VARCHAR(16),      -- 'high' | 'medium' | 'low' | 'abstained'
    current_stock       NUMERIC(12,6),    -- остаток на момент расчёта
    days_to_depletion   NUMERIC(8,2),     -- current_stock / predicted_qty
    UNIQUE (location_id, ingredient_id, forecast_date, created_at)
);

CREATE INDEX ON marts.forecasts (location_id, forecast_date);
CREATE INDEX ON marts.forecasts (days_to_depletion) WHERE forecast_quality != 'abstained';
```

### `marts.anomalies`
```sql
CREATE TABLE marts.anomalies (
    id                  BIGSERIAL PRIMARY KEY,
    location_id         INT     NOT NULL REFERENCES core.locations(id),
    ingredient_id       INT     NOT NULL REFERENCES core.ingredients(id),
    date                DATE    NOT NULL,
    anomaly_type        VARCHAR(64),     -- 'overconsumption' | 'underconsumption' | 'missing_data'
    deviation_pct       NUMERIC(8,2),
    expected_qty        NUMERIC(12,6),
    actual_qty          NUMERIC(12,6),
    severity            VARCHAR(16),     -- 'low' | 'medium' | 'high' | 'critical'
    is_reviewed         BOOLEAN  NOT NULL DEFAULT FALSE,
    review_comment      TEXT,
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `marts.alerts_queue`
```sql
CREATE TABLE marts.alerts_queue (
    id                  BIGSERIAL PRIMARY KEY,
    location_id         INT     REFERENCES core.locations(id),
    ingredient_id       INT     REFERENCES core.ingredients(id),
    alert_type          VARCHAR(64) NOT NULL,    -- 'depletion_critical' | 'depletion_warning' | 'anomaly' | 'infra'
    severity            VARCHAR(16) NOT NULL,    -- 'critical' | 'warning' | 'info'
    message_text        TEXT    NOT NULL,
    rationale_text      TEXT,                   -- обоснование для US-08
    days_to_depletion   NUMERIC(8,2),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_at        TIMESTAMPTZ NOT NULL,    -- когда отправить (учёт тихих часов)
    sent_at             TIMESTAMPTZ,
    is_sent             BOOLEAN NOT NULL DEFAULT FALSE,
    dedup_key           VARCHAR(256) UNIQUE      -- location_id:ingredient_id:alert_type:date
);

CREATE INDEX ON marts.alerts_queue (is_sent, scheduled_at) WHERE NOT is_sent;
```

---

## 6. Схема `ops.*`

### `ops.etl_runs`
```sql
CREATE TABLE ops.etl_runs (
    id              BIGSERIAL PRIMARY KEY,
    entity          VARCHAR(64)  NOT NULL,
    mode            VARCHAR(16)  NOT NULL,   -- 'full' | 'incremental'
    location_id     INT          REFERENCES core.locations(id),
    started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    status          VARCHAR(16),             -- 'running' | 'success' | 'failed'
    rows_fetched    INT,
    rows_staged     INT,
    rows_rejected   INT,
    error_message   TEXT,
    last_cursor     VARCHAR(256)             -- cursor / updated_since для следующего run
);
```

### `ops.model_runs`
```sql
CREATE TABLE ops.model_runs (
    id              BIGSERIAL PRIMARY KEY,
    location_id     INT     NOT NULL REFERENCES core.locations(id),
    ingredient_id   INT     NOT NULL REFERENCES core.ingredients(id),
    model_type      VARCHAR(32) NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    status          VARCHAR(16),
    mape            NUMERIC(8,4),
    forecast_horizon INT,
    training_rows   INT,
    error_message   TEXT
);
```

---

## 7. Pipeline — последовательность шагов

```
┌─────────────────────────────────────────────────────────────────┐
│ FULL REFRESH (02:00 ежедневно) — справочники                     │
│                                                                   │
│ pull_full(sku)         → raw.imports → staging.sku → core.ingr.  │
│ pull_full(menu_items)  → raw.imports → staging.menu → core.menu  │
│ pull_full(recipes)     → raw.imports → staging.recipes → core.rec│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ INCREMENTAL (каждые 15 мин) — транзакции                          │
│                                                                   │
│ pull_incremental(sales)     → raw → staging → core.sales         │
│ pull_incremental(deliveries)→ raw → staging → core.deliveries    │
│ pull_incremental(stocks)    → raw → staging → core.stocks        │
│ pull_incremental(writeoffs) → raw → staging → core.writeoffs     │
│                                                                   │
│ После каждого run: trigger → consumption_calculator.py           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ CONSUMPTION CALCULATOR (по триггеру или каждые 30 мин)           │
│                                                                   │
│ Пересчёт marts.daily_consumption за вчера и сегодня              │
│ Детектирование аномалий → marts.anomalies                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ FORECAST ENGINE (03:00 ежедневно)                                 │
│                                                                   │
│ Для каждого (location, ingredient) с достаточной историей:        │
│   1. Baseline MA7+DoW → marts.forecasts                          │
│   2. Если MAPE > 15% → Prophet → marts.forecasts                 │
│   3. Вычислить days_to_depletion                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ ALERT ENGINE (после Forecast + по incremental-триггеру)          │
│                                                                   │
│ Применить правила → marts.alerts_queue                           │
│ Дедупликация по dedup_key                                        │
│ Расстановка scheduled_at (тихие часы)                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ TELEGRAM SENDER (каждые 5 мин)                                   │
│                                                                   │
│ SELECT * FROM marts.alerts_queue                                  │
│ WHERE NOT is_sent AND scheduled_at <= NOW()                       │
│ → отправить → пометить is_sent = TRUE, sent_at = NOW()           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Правила трансформации (UoM нормализация)

```python
UNIT_TO_BASE = {
    # Весовые → кг
    'г': ('kg', 0.001),
    'грамм': ('kg', 0.001),
    'гр': ('kg', 0.001),
    'кг': ('kg', 1.0),
    'килограмм': ('kg', 1.0),
    # Жидкие → литр
    'мл': ('l', 0.001),
    'л': ('l', 1.0),
    'литр': ('l', 1.0),
    # Штучные
    'шт': ('pcs', 1.0),
    'штука': ('pcs', 1.0),
    'порция': ('pcs', 1.0),   # ← требует ручной проверки
}

def normalize_quantity(qty: float, unit: str) -> tuple[float, str]:
    """Возвращает (нормализованное_кол-во, base_unit)."""
    unit_lower = unit.strip().lower()
    if unit_lower not in UNIT_TO_BASE:
        raise ValueError(f"Unknown unit: {unit!r}")
    base_unit, factor = UNIT_TO_BASE[unit_lower]
    return qty * factor, base_unit
```

> `порция` как единица — **красный флаг**. Означает, что рецептура использует «1 порция» как ингредиент вместо реальных граммов. Фиксируется как `anomaly_type = 'unmapped_unit'` в `marts.anomalies`.

---

## 9. Контракты между слоями (что должно быть правдой)

| Контракт | Проверка |
|---------|---------|
| Каждая запись `core.sales` имеет `menu_item_id` в `core.menu_items` | FK constraint |
| Каждая запись `core.recipes` имеет `ingredient_id` в `core.ingredients` | FK constraint |
| В `marts.daily_consumption` нет дублей по (location, ingredient, date) | UNIQUE constraint |
| Прогноз создаётся только если история ≥14 дней | Проверка в forecast.py |
| Отправленный алёрт не отправляется повторно | `dedup_key` UNIQUE + `is_sent` |

---

## 10. Миграции (Alembic)

```
db/migrations/
├── env.py
├── versions/
│   ├── 0001_create_raw_imports.sql
│   ├── 0002_create_ops_etl_runs.sql
│   ├── 0003_create_staging_tables.sql
│   ├── 0004_create_core_tables.sql
│   └── 0005_create_marts_tables.sql
```

Каждая миграция: Up + Down. Деплой через `alembic upgrade head` в CI перед стартом контейнеров.

---

## 11. Changelog

| Версия | Дата | Автор | Изменения |
|--------|------|-------|-----------|
| 1.0 | 2026-05-09 | Data Lead + Tech Lead | Первая утверждённая редакция |
