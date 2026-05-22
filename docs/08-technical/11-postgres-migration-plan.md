---
Документ: Postgres Migration Plan
Версия: 1.0
Дата: 2026-06-12
Статус: Draft (план, не код — реализация по триггеру роста)
Владелец: Tech Lead
Связанные документы: [Pilot App Deployment](05-pilot-app-deployment.md), [MVP Architecture](00-mvp-architecture.md), [Data Model](02-data-model-and-pipeline.md), [Sprint 3 Roadmap](../04-implementation/11-sprints-roadmap-2026-05-29.md)
---

# Postgres Migration Plan

## 0. Цель документа

Pilot работает на encrypted JSON file storage (`data/store.enc`, AES-256-GCM).
Это сознательное R2-решение: zero-ops, шифрование «бесплатно», экспорт/импорт
одним файлом. **Прецедент масштабирования** обнаружится задолго до проблем
производительности — этот документ описывает, **когда** и **как** перейти на
Postgres, чтобы не делать это в авральном режиме.

> **TL;DR:** держим JSON-store пока < 10 000 записей / клиент или < 5 клиентов
> на одном инстансе. При пересечении любого триггера — план переходит в
> execution-фазу (≈ 2-3 недели работы).

---

## 1. Триггеры перехода

Запускаем миграцию при выполнении **любого** из условий:

| Триггер | Сигнал | Источник |
|---------|--------|----------|
| **T1: Размер store.enc** | > 50 MB | `du -sh data/store.enc` в healthcheck |
| **T2: P95 latency `/api/records` (GET list)** | > 500 ms | nginx access log + p95 алёрт |
| **T3: Количество записей одного клиента** | > 10 000 | `/api/stats` |
| **T4: Количество клиентов на одном инстансе** | ≥ 5 | конфиг (каждый — отдельный venue + APP_PASSWORD) |
| **T5: Запрос на конкарентную запись 2+ пользователями** | реальный customer ask | sales/CS |
| **T6: Compliance-требование с аудит-trail-запросом** | договорное обязательство | юристы |

**Текущее состояние (2026-06-12):** ни один не сработал. Pilot < 1000 записей,
1 клиент в проде, P95 ~ 80 ms. План — в "Draft", не "Active".

---

## 2. Что мигрируем (inventory)

### 2.1. Persistence уровень

| Артефакт | Сейчас | После миграции |
|----------|--------|----------------|
| Records (CRUD) | `data/store.enc` (single AES-GCM blob) | Postgres tables (одна на тип записи) |
| Audit log | `data/audit.jsonl` (NDJSON append-only) | Postgres table `audit_log` + retention policy |
| Plugin settings | те же records | те же таблицы (без отдельной выделенной схемы) |
| Шифрование at-rest | AES-GCM на blob | `pgcrypto.pgp_sym_encrypt` per-column для PII (где есть) или TDE на уровне Postgres |
| Backup | `ops/backup-store.sh` (cp + retention) | `pg_dump` + retention или managed-сервис |

### 2.2. Типы записей (на 2026-06-12)

Типы — это discriminator-поле в текущем "wide-record" формате. После миграции
каждому типу соответствует отдельная таблица, плюс общая таблица `record`
для cross-type запросов.

| Тип | Venue-scoped? | Примерное число записей/клиент | Замечания |
|-----|:-------------:|:------------------------------:|-----------|
| `venue` | — | 1-5 | Корневая сущность |
| `product` | ✅ | 50-300 | |
| `dish` | ✅ | 30-150 | `ingredients[]` → отдельная таблица `dish_ingredient` |
| `stop` | ✅ | 100-1000 (история за 6 мес.) | |
| `stock_entry` | ✅ | 500-5000/мес | Самый горячий тип → partition by month |
| `dish_sale` | ✅ | 300-3000/мес | Партиционирование по date |
| `order` | ✅ | 50-200/мес | |
| `revenue_entry` | ✅ | 30/мес (daily) | |
| `fixed_expense` | ✅ | 5-15 | |
| `supplier` | — | 5-30 | Не venue-scoped — общий каталог |
| `supplier_item` | — | 100-500 | |
| `supplier_price_history` | — | 500-3000/год | Партиционирование по год |
| `recommendation_action` | ✅ | 30/день | Партиционирование по неделям |
| `telegram_chat` | ✅ | 1-3 | |
| `telegram_settings` | — | 1 | секреты — `pgcrypto.pgp_sym_encrypt` |
| `quickresto_settings`, `iiko_settings` | — | 1 на интеграцию | то же |

---

## 3. Целевая схема (предварительная)

```sql
-- Общая обёртка для cross-type запросов и аудита.
CREATE TABLE record (
  id          UUID PRIMARY KEY,
  type        TEXT NOT NULL,
  venue_id    UUID REFERENCES venue(id),         -- nullable
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  data        JSONB NOT NULL,                     -- type-specific payload
  CHECK (data ? 'id')
);
CREATE INDEX idx_record_type_venue  ON record (type, venue_id);
CREATE INDEX idx_record_venue_ts    ON record (venue_id, created_at DESC);
CREATE INDEX idx_record_data_gin    ON record USING GIN (data);

-- Heavy-write типы выделяем в отдельные таблицы для партиционирования.
CREATE TABLE stock_entry (
  id          UUID PRIMARY KEY,
  venue_id    UUID NOT NULL,
  product_id  UUID NOT NULL,
  kind        TEXT NOT NULL,                      -- receipt/writeoff/inventory
  delta       NUMERIC,                            -- NULL для inventory без сравнения
  resulting   NUMERIC NOT NULL,
  note        TEXT,
  source      TEXT,                               -- manual/quickresto/iiko
  external_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);
-- + partitions per month, pg_partman или вручную в начале

CREATE TABLE dish_sale (
  id          UUID PRIMARY KEY,
  venue_id    UUID NOT NULL,
  dish_id     UUID NOT NULL,
  date        DATE NOT NULL,
  count       NUMERIC NOT NULL,
  UNIQUE (venue_id, dish_id, date)                -- replaces upsertDishSale logic
);

-- Audit log из data/audit.jsonl
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  op          TEXT NOT NULL,                      -- create/update/delete
  record_id   UUID NOT NULL,
  record_type TEXT NOT NULL,
  venue_id    UUID,
  by_session  TEXT,
  name        TEXT,
  changed     TEXT[],                             -- update only
  meta        JSONB
);
CREATE INDEX idx_audit_record ON audit_log (record_id, ts DESC);
CREATE INDEX idx_audit_ts     ON audit_log (ts DESC);
```

**Решение «Wide JSONB vs strict schema»:**
- `record.data JSONB` — для редко-меняющихся / маленьких типов (venue, supplier,
  product, dish, settings). Гибко при эволюции схемы.
- Strict tables — для «горячих» типов с известными запросами и партиционированием
  (stock_entry, dish_sale, recommendation_action).

---

## 4. Этапы миграции

### Этап 1. Подготовка (1 неделя)

- Поднимаем Postgres 16 — managed (Neon / Render / Yandex Cloud Postgres) или
  на той же VM (если < 3 клиентов). Решение по managed vs self-host — по факту
  bюджета.
- Применяем схему из §3.
- Пишем `app/server/db.js` (ESM — сервер с 2026-05-22 на `"type":"module"`, `pg`-клиент) с connection pool. Экспортируется как именованные функции (`query`, `withTx`), регистрируется из `server.js`.
- Wrapper `loadStore() / saveStore()` начинает работать в dual-write режиме:
  пишет и в `store.enc`, и в Postgres. Чтение — пока только из `store.enc`.

### Этап 2. Backfill (день)

- One-shot скрипт `ops/migrate-store-to-pg.js`:
  - `loadStore()` → массив `records`
  - Для каждой записи: `INSERT INTO record (id, type, venue_id, created_at, updated_at, data) ...`
  - Для героев (stock_entry, dish_sale, audit) — отдельный INSERT в их strict-таблицы.
  - Идемпотентен (`ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`).
- Проверка: `SELECT type, COUNT(*) FROM record GROUP BY type;` сравниваем с
  `/api/stats` исходного store.

### Этап 3. Чтение из Postgres (1 неделя)

- Переключаем `/api/records` (GET list) на Postgres-запрос с фильтром по venue.
- Dual-write остаётся ещё неделю — на случай отката.
- Healthcheck `/api/health` добавляет `pg.query('SELECT 1')` проверку.

### Этап 4. Отказ от store.enc (неделя)

- После 7 дней без расхождений отключаем write в `store.enc`.
- `data/store.enc` остаётся read-only-snapshot последнего состояния — на случай
  emergency-rollback. Удалить через 30 дней.
- Бэкап-стратегия переключается на `pg_dump` (см. §5).
- Export/Import endpoints в UI: сменяются на pg_dump (по запросу из UI) /
  `pg_restore` соответственно. Encrypted bundle делается через
  `pg_dump | openssl enc -aes-256-cbc -pass pass:APP_PASSWORD` для сохранения
  «one encrypted file» UX.

### Этап 5. Оптимизация (опционально)

- Прометей-метрики из `pg_stat_statements`.
- Партиционирование stock_entry / dish_sale если за месяц > 100k записей.
- Read-replica если нужно отделить аналитические дашборды (FinanceTab).

---

## 5. Бэкап после миграции

Заменяет `ops/backup-store.sh` (O04). Целевая стратегия:

| Тип бэкапа | Частота | Retention | Инструмент |
|------------|---------|-----------|------------|
| Logical dump (pg_dump custom) | nightly 03:30 UTC | 7 дней | `pg_dump -Fc` + копия на S3-совместимое хранилище |
| WAL archiving + base backup | непрерывно + раз в неделю | 14 дней | `pg_basebackup` + `archive_command` (если self-host) |
| Snapshot | ежедневно | 7 дней | managed-сервис auto-snapshot |
| Audit-log archival | monthly | 12 месяцев | `pg_dump audit_log` отдельным файлом |

Восстановление: managed → restore-from-snapshot UI; self-host → `pg_restore` +
WAL replay до точки.

---

## 6. Риски и митигация

| Риск | Вероятность | Импакт | Митигация |
|------|:-----------:|:------:|-----------|
| Простой при switchover Этап 3→4 | Низкая | Высокий | Dual-write окно ≥ 7 дней; скрипт сравнения row-by-row |
| Расходимость JSONB ↔ strict таблиц | Средняя | Средний | Один источник истины: писать сначала в strict, потом в `record` (или CTE) |
| Стоимость managed Postgres | Высокая | Низкий | Старт с smallest tier (~$15/мес у Neon); миграция между провайдерами легка |
| Шифрование при transit к managed | Средняя | Высокий | Только TLS-подключения, `sslmode=require`; не хранить пароль в env, использовать SSM/Vault если > 1 окружения |
| Потеря шифрования at-rest | Низкая (managed) / средняя (self) | Высокий | TDE managed-сервиса; для self-host — luks-encrypted volume |
| Audit log быстро растёт | Высокая | Низкий | Партиционирование по месяцам + archival |

---

## 7. Чего НЕ делаем в этом плане

- **ORM (Prisma / TypeORM / Drizzle).** В пилоте слой записей плоский, `pg`-клиент
  достаточен. ORM поднимаем только при появлении сложных join-ов.
- **Микросервисы / отдельные read-replica приложения.** Нет нужды.
- **Графовая БД / TimescaleDB.** Текущие запросы плоские; partition + индексы решают.
- **Realtime (LISTEN/NOTIFY) для UI.** Polling даёт нужный UX; LISTEN-канал
  можно добавить при многопользовательском режиме (см. RBAC L3).

---

## 8. Гейтинг до старта работ

- ✅ Triггер из §1 сработал (один или более) и зафиксирован в DL.
- ✅ Sprint 3 SLA-чек пройден (audit, backup, healthcheck в проде).
- ✅ Утверждённый бюджет на managed Postgres (если выбран этот путь).

---

## Changelog

| Версия | Дата | Автор | Изменения |
|--------|------|-------|-----------|
| 1.0 | 2026-06-12 | Tech Lead | Создан как O06 Sprint 3 |
