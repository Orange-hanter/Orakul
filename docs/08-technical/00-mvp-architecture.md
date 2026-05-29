---
Документ: MVP Architecture
Версия: 1.0
Дата: 2026-05-09
Статус: Утверждён
Владелец: Tech Lead + Data Lead
Связанные документы: [PRD](../03-product/01-product-requirements-document.md), [Kiepper Integration Recon](01-kiepper-integration-recon.md), [Data Model & Pipeline](02-data-model-and-pipeline.md), [ML & Forecasting Spec](03-ml-and-forecasting-spec.md), [Telegram Notification Spec](04-telegram-notification-spec.md)
---


<!-- KIEPPER-DEPRECATED-NOTE -->
> **Примечание о Kiepper (обновлено 2026-05-29):** Интеграция с системой Kiepper **не используется** и перенесена в архив. Orakul работает исключительно с **QuickResto** API. Документы Kiepper сохранены для истории; актуальная интеграция — [QuickResto Integration Spec](../08-technical/09-quickresto-integration-spec.md).


# MVP Architecture

## 0. Принципы архитектуры MVP

1. **Simple and boring tech.** На MVP нет Kafka, Kubernetes, Spark. Есть Postgres, Python, cron. Усложняем только когда обоснованно.
2. **Data over features.** Лучше идеально собирать данные с одной точки, чем криво — с пяти.
3. **Observable first.** Каждый компонент должен говорить «я жив / я упал». Logging, health-checks с первого дня.
4. **Fail loud, not silent.** Если импорт не пришёл — алёрт, а не пропуск. «Нет данных» хуже «плохих данных», потому что мы о нём не знаем.
5. **Explain before automate.** Прогноз + Telegram-алёрт — но пользователь **принимает решение** сам. Авто-заказов нет до явного решения (см. [PRD §3](../03-product/01-product-requirements-document.md)).

---

## 1. Общая схема (Data Flow)

```
                  ┌─────────────────────┐
                  │      KIEPPER        │
                  │  (источник данных)  │
                  │                     │
                  │ • Номенклатура SKU  │
                  │ • Рецептуры         │
                  │ • Меню              │
                  │ • Продажи (чеки)    │
                  │ • Поставки          │
                  │ • Остатки/инвент.  │
                  │ • Списания          │
                  └──────────┬──────────┘
                             │ API / Export
                             │ (каждые 15 мин / раз в сутки*)
                             ▼
                  ┌─────────────────────┐
                  │    ETL CONNECTOR    │  ← Python, cron
                  │                     │
                  │ • Аутентификация    │
                  │ • Инкрементальный   │
                  │   pull              │
                  │ • Базовая           │
                  │   валидация (L1)    │
                  │ • Retry / backoff   │
                  └──────────┬──────────┘
                             │
                             ▼
          ┌──────────────────────────────────┐
          │          PostgreSQL               │
          │                                  │
          │  raw.*        ← as-is из Kiepper │
          │  staging.*    ← нормализация      │
          │  core.*       ← бизнес-сущности  │
          │  marts.*      ← агрегаты/прогноз │
          └──────────────┬───────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
┌──────────────────┐         ┌──────────────────────┐
│ CONSUMPTION      │         │  FORECAST ENGINE      │
│ CALCULATOR       │         │                       │
│                  │         │  • Baseline model     │
│ • Теоретич.      │         │    (7-day MA + DoW)   │
│   расход =       │         │  • Prophet / ETS      │
│   продажи ×      │─────────▶  • Days-to-depletion │
│   грамовки       │         │  • Confidence check   │
│ • Фактический    │         │  • "Model abstained"  │
│   расход =       │         │    logic              │
│   Δ остатков     │         └──────────┬───────────┘
│ • Отклонение     │                    │
│   (человеч.      │                    │
│   фактор)        │                    │
└──────────────────┘                    │
                                        ▼
                             ┌──────────────────────┐
                             │  ALERT ENGINE         │
                             │                       │
                             │  • Правила алёртов   │
                             │    (<2d / <4d / <7d) │
                             │  • Тихие часы         │
                             │  • Дедупликация       │
                             │  • Утренний дайджест  │
                             └──────────┬───────────┘
                                        │
                                        ▼
                             ┌──────────────────────┐
                             │  TELEGRAM BOT         │
                             │  (python-telegram-bot)│
                             │                       │
                             │  • Подписка по ролям  │
                             │  • Критич. алёрты    │
                             │  • Утренний дайджест  │
                             │  • Команды (/status,  │
                             │    /stock, /forecast) │
                             └──────────────────────┘

* частота зависит от возможностей API Kiepper — см. Integration Recon
```

---

## 2. Компоненты

### 2.1 ETL Connector
- **Язык:** Python 3.11+
- **Запуск:** cron (Linux) или APScheduler внутри процесса
- **Режимы:**
  - `full_refresh` — первый запуск или ребилд справочников (рецептуры, меню, SKU)
  - `incremental` — инкремент по `updated_at` / offset / cursor (продажи, поставки, остатки)
- **Ключевые библиотеки:** `httpx` (async HTTP), `sqlalchemy` + `psycopg2`, `pydantic` (валидация схемы)
- **Retry strategy:** exponential backoff, максимум 3 попытки, после — dead-letter queue в `raw.import_errors`
- **Мониторинг:** таблица `ops.etl_runs` — timestamp, сущность, статус, кол-во записей, ошибка

### 2.2 PostgreSQL (хранилище)
- **Версия:** 15+
- **Слои:**

| Схема | Назначение | Кто пишет | Кто читает |
|-------|-----------|-----------|------------|
| `raw` | AS-IS из Kiepper, JSONB + timestamp | ETL | ETL→Staging transform |
| `staging` | Нормализованные, приведённые типы, дедупликация | Transform | Core load |
| `core` | Бизнес-сущности, FK-связи, история версий | Core load | Calculator, Forecast |
| `marts` | Агрегаты по дням, прогнозы, алёрты | Calculator, Forecast | Alert Engine, API |
| `ops` | ETL runs, model runs, alert log | Все компоненты | Monitoring |

- **Backup:** pg_dump ежедневно в object storage (Yandex Object Storage / S3-compatible)
- **Индексы:** по `(location_id, ingredient_id, date)` на основных fact-таблицах

### 2.3 Consumption Calculator
- **Запуск:** после каждого успешного ETL-run по продажам или после инвентаризации
- **Две формулы:**
```
theoretical = Σ (sale_qty × recipe_norm_kg)
actual      = stock_open + deliveries − stock_close − writeoffs
deviation   = actual − theoretical
deviation_pct = deviation / theoretical × 100
```
- **Output:** `marts.daily_consumption` — одна строка на (дата, точка, ингредиент)
- **Аномалия:** если `abs(deviation_pct) > threshold` → запись в `marts.anomalies`

### 2.4 Forecast Engine
- **Запуск:** 1 раз в сутки, 03:00 (до утреннего дайджеста 07:00)
- **Логика:**
  1. Берём историю `marts.daily_consumption` за 90 дней для каждого (location, ingredient)
  2. Baseline-модель: 7-day rolling mean с коэффициентом дня недели
  3. Upgrade-модель: Prophet (если история ≥30 дней и MAPE baseline >15%)
  4. Вычисляем `predicted_daily_kg` на следующие 7 дней
  5. `days_to_depletion = current_stock / predicted_daily_kg`
  6. Если данных <14 дней или MAPE >30% → модель воздерживается (`forecast_quality = 'low'`), алёрт не генерируется
- **Output:** `marts.forecasts` — (date, location, ingredient, predicted_kg, days_to_depletion, forecast_quality, model_type, mape)

### 2.5 Alert Engine
- **Запуск:** сразу после Forecast Engine + при каждом ETL-run (для критических порогов в реальном времени)
- **Правила:**

| Триггер | Порог | Тип алёрта |
|---------|-------|-----------|
| `days_to_depletion < 1` | Критический | Немедленный push |
| `days_to_depletion < 2` | Срочный | Немедленный push |
| `days_to_depletion < 4` | Предупреждение | Утренний дайджест |
| `days_to_depletion < 7` | Информационный | Утренний дайджест |
| `abs(deviation_pct) > X%` | Аномалия расхода | Утренний дайджест |
| `etl_run failed` | Инфра | Немедленный push (оператору) |
| `forecast_quality = 'low'` | Качество модели | Еженедельный отчёт |

- **Дедупликация:** тот же алёрт по (location, ingredient, тип) не повторяется чаще 1 раза в 4 часа
- **Тихие часы:** 22:00–07:00 → копится в утренний дайджест (кроме `days_to_depletion < 1`)

### 2.6 Telegram Bot
- **Библиотека:** `python-telegram-bot` v21+
- **Команды:**
  - `/status` — текущие алёрты по точке
  - `/stock [ингредиент]` — текущий остаток + прогноз
  - `/forecast` — утренний дайджест по требованию
  - `/anomalies` — аномалии расхода за последние 7 дней
  - `/mute [N hours]` — тишина на N часов (защита от шума)
- **Подписка:** каждый чат привязан к (location_id, role) через `/start token`
- **Формат алёрта:** см. [Telegram Notification Spec](04-telegram-notification-spec.md)

---

## 3. Технологический стек

| Компонент | Технология | Обоснование |
|-----------|-----------|-------------|
| Язык | Python 3.11 | Зрелая ML-экосистема, скорость разработки |
| HTTP-клиент | `httpx` (async) | Async + retry из коробки |
| ORM / SQL | `sqlalchemy` + raw SQL для аналитики | ORM для ETL, raw SQL для marts (читаемость) |
| Валидация | `pydantic` v2 | Строгие схемы на входе и выходе каждого компонента |
| ML baseline | `statsmodels` (ETS) | Легкий, объяснимый, без зависимостей GPU |
| ML upgrade | `prophet` | Хорошо работает при сезонности, объяснимый |
| Scheduler | `cron` + systemd | Минимальные зависимости; Airflow — после MVP |
| БД | PostgreSQL 15 | Надежный, бесплатный, JSONB для raw-слоя |
| Telegram | `python-telegram-bot` v21 | Актуальная, async |
| Мониторинг | Структурированные логи (`structlog`) + таблица `ops.*` | Достаточно для MVP; Grafana — после |
| Деплой | Single VPS, Docker Compose | Простой, нет k8s-оверхеда |
| CI | GitHub Actions | Линтер + тесты при push |

---

## 4. Инфраструктура (минимум для MVP)

```
VPS (2 vCPU, 4 GB RAM, 50 GB SSD)
├── Docker Compose
│   ├── postgres:15          ← данные, 20 GB volume
│   ├── orakul-etl           ← ETL Connector (cron внутри)
│   ├── orakul-engine        ← Calculator + Forecast + Alert
│   └── orakul-bot           ← Telegram Bot
├── nginx (reverse proxy)    ← для webhook Telegram (если нужен)
└── Backup: pg_dump → object storage (ежедневно)
```

**Хостинг:** Yandex Cloud / Selectel / Timeweb Cloud (РФ-юрисдикция).  
**Мин. конфигурация:** 2 vCPU, 4 GB RAM — достаточно для 1–5 точек, одной БД и всех Python-процессов.  
**Scaling:** при >10 точках — добавить RAM (до 8 GB), выделить БД на отдельный инстанс; к Airflow и Kubernetes не переходить до 50+ точек.

---

## 5. Точки отказа и митигация

| Точка отказа | Что происходит | Митигация |
|-------------|----------------|-----------|
| Kiepper API недоступен | ETL не получает данные | Retry×3 + алёрт оператору + работаем на кэше |
| Изменилась схема Kiepper API | ETL падает на валидации pydantic | Алёрт, сохраняем raw JSONB, не сломать staging |
| БД недоступна | Все компоненты падают | Health-check + restart policy в Docker; backup |
| Прогноз деградировал (MAPE >30%) | Плохие алёрты → недоверие | `forecast_quality` флаг, алёрт оператору, fallback на baseline |
| Telegram API недоступен | Алёрты не доставляются | Очередь в `ops.pending_alerts`, доставка при восстановлении |
| Ошибка в consumption calculator | Неверные аномалии | Unit-тесты на формулы, алёрт при NULL-результате |

---

## 6. Стратегия тестирования MVP

| Уровень | Что покрываем | Инструмент |
|---------|--------------|-----------|
| Unit | Consumption формулы, alert rules, pydantic-схемы | pytest |
| Integration | ETL → DB round-trip на тестовой БД | pytest + testcontainers |
| Smoke | После деплоя: ETL-run запускается, бот отвечает на /status | Автоматический health-check |
| Manual | BDD-сценарии 1.1, 2.1, 3.1 на пилотной точке | [BDD Acceptance Scenarios](../03-product/04-bdd-acceptance-scenarios.md) |

---

## 7. Структура репозитория

```
orakul/
├── etl/
│   ├── connectors/
│   │   └── kiepper/        ← коннектор к Kiepper
│   ├── transforms/         ← raw → staging → core
│   └── scheduler.py
├── engine/
│   ├── consumption.py      ← формулы расхода
│   ├── forecast.py         ← baseline + prophet
│   └── alerts.py           ← правила алёртов
├── bot/
│   ├── handlers.py         ← команды Telegram
│   └── templates.py        ← шаблоны сообщений
├── db/
│   ├── migrations/         ← SQL миграции (alembic)
│   └── models.py           ← SQLAlchemy models
├── tests/
├── docker-compose.yml
├── .env.example
└── docs/                   ← эта документация
```

---

## 8. Roadmap технических релизов

| Релиз | Что включено | Критерий перехода |
|-------|-------------|-------------------|
| **T0 — Recon** | Kiepper подключён, сырые данные в `raw.*` | Выгрузка одной точки за 7 дней без ошибок |
| **T1 — Core data** | `core.*` заполнен, consumption calculator работает | Deviation_pct считается для топ-50 ингредиентов |
| **T2 — Baseline forecast** | Baseline-прогноз + days_to_depletion + Telegram алёрты | MAPE baseline ≤20% на holdout 14 дней |
| **T3 — ML upgrade** | Prophet для ингредиентов с недостаточным baseline | MAPE ≤15% на топ-50 |
| **T4 — Stable ops** | Мониторинг, автоматический backup, отчётность | 30 дней без P1 инцидентов |

---

## 9. Связь с документацией

| Тема | Документ |
|------|----------|
| Что именно читаем из Kiepper, как | [Kiepper Integration Recon](01-kiepper-integration-recon.md) |
| Схемы таблиц, слои данных | [Data Model & Pipeline](02-data-model-and-pipeline.md) |
| Модели, признаки, метрики прогноза | [ML & Forecasting Spec](03-ml-and-forecasting-spec.md) |
| Шаблоны Telegram-сообщений, правила | [Telegram Notification Spec](04-telegram-notification-spec.md) |
| Бизнес-требования к поведению | [PRD](../03-product/01-product-requirements-document.md) |
| BDD-сценарии для тестирования | [BDD Acceptance Scenarios](../03-product/04-bdd-acceptance-scenarios.md) |

---

## 10. Changelog

| Версия | Дата | Автор | Изменения |
|--------|------|-------|-----------|
| 1.0 | 2026-05-09 | Tech Lead | Первая утверждённая редакция |
