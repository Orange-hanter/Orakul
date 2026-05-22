---
Документ: Спецификация интеграции QuickResto
Версия: 1.0
Дата: 2026-05-21
Статус: Черновик
Владелец: Tech Lead / Data Lead
Связанные документы: [QuickResto Overview](../07-references/06-quick-resto-system-overview.md), [Data Model & Pipeline](02-data-model-and-pipeline.md), [MVP Architecture](00-mvp-architecture.md), [Financial Analytics](10-financial-analytics-spec.md)
---

# Спецификация интеграции QuickResto

## 1. Назначение

QuickResto — кассовая система, используемая клиентами Orakul параллельно с Kiepper. Интеграция обеспечивает:
1. **Считывание заказов** (продаж) из QuickResto в реальном времени.
2. **Автоматическое формирование списаний** ингредиентов на основе рецептур.
3. Синхронизацию данных с модулями аналитики и прогнозирования Orakul.

---

## 2. Архитектура интеграции

```
┌─────────────────────────────────────────────────────────────────────┐
│                        QuickResto Cloud                             │
│                     (Back-Office API v2)                            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS / REST
                                │ (pull каждые 5 мин + webhook при событии)
                  ┌─────────────▼──────────────┐
                  │     Orakul ETL Connector    │
                  │  (QuickResto Adapter)       │
                  └─────────────┬──────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
         orders_raw       menu_raw           ingredients_raw
         (сырые продажи)  (меню/рецептуры)   (справочник)
              │
              ▼
     Write-Off Engine
     (расчёт списаний по рецептурам)
              │
              ▼
         writeoffs_log  ←  recipes (из Kiepper или QuickResto)
              │
              ▼
     Analytics / ML Pipeline
```

---

## 3. QuickResto API — методы доступа

### 3.1 Базовая конфигурация

| Параметр | Значение |
|----------|---------|
| Base URL | `https://api.quickresto.ru/platform/online/api/` |
| Аутентификация | Basic Auth (`username:password`) через `X-Authorization` заголовок |
| Формат | JSON |
| Rate Limit | ≤ 60 запросов/минуту (уточнять с клиентом) |
| API версия | v2 (Back-Office REST) |

**Хранение учётных данных:** только в переменных окружения / секрет-хранилище (Vault / AWS Secrets Manager). Никогда не в коде или БД в открытом виде.

### 3.2 Ключевые эндпоинты

| Эндпоинт | Метод | Описание | Используется для |
|----------|-------|----------|-----------------|
| `/order/list` | GET | Список заказов за период | Считывание продаж |
| `/order/get` | GET | Детальный заказ по ID | Детали позиций заказа |
| `/menu/list` | GET | Список позиций меню | Синхронизация справочника |
| `/modificationGroup/list` | GET | Модификаторы / опции | Учёт вариантов блюд |
| `/supply/list` | GET | Приходные накладные | Синхронизация закупок |
| `/supplyItem/list` | GET | Строки накладных | Детали закупок |
| `/nomenclature/list` | GET | Справочник номенклатуры | Ингредиенты |

---

## 4. Считывание заказов

### 4.1 Модель заказа (QuickResto → Orakul)

```json
{
  "order_id": "qr-uuid-12345",
  "venue_id": "orakul-venue-uuid",
  "source": "quickresto",
  "opened_at": "2026-05-21T12:30:00Z",
  "closed_at": "2026-05-21T12:45:00Z",
  "status": "closed",       // opened|closed|deleted|refund
  "table_number": "5",
  "waiter_id": "qr-employee-uuid",
  "items": [
    {
      "menu_item_id": "qr-menu-uuid",
      "name": "Капучино 300мл",
      "quantity": 2,
      "unit_price": 5.50,
      "total_price": 11.00,
      "modifications": [
        { "name": "Без сахара", "price_delta": 0 }
      ]
    }
  ],
  "payment_type": "card",
  "total": 11.00,
  "discount": 0,
  "final_total": 11.00
}
```

### 4.2 Стратегия синхронизации

| Режим | Периодичность | Условие |
|-------|--------------|---------|
| **Polling (pull)** | Каждые 5 минут | Основной режим; запрашивает заказы с `?from=last_sync_timestamp` |
| **Webhook (push)** | Мгновенно | Если QuickResto настроен на отправку webhook при закрытии заказа |
| **Bulk import** | Разово | При первичном подключении; импорт исторических данных за 90–365 дней |

**Приоритет:** webhook > polling. Если webhook недоступен (не настроен у клиента) — только polling.

### 4.3 Обработка статусов заказов

| Статус QuickResto | Действие Orakul |
|-------------------|----------------|
| `opened` | Игнорировать (заказ ещё не завершён) |
| `closed` | Записать в `orders_raw`, запустить Write-Off Engine |
| `deleted` | Если уже было списание — создать `writeoff_reversal` |
| `refund` | Создать `writeoff_reversal` на сумму возврата |

---

## 5. Формирование списаний

### 5.1 Write-Off Engine — принцип работы

```
Закрытый заказ
    │
    ▼
Для каждой позиции заказа:
    1. Найти menu_item_id в таблице recipes (Orakul)
    2. Для каждого ингредиента в рецептуре:
       - factor = quantity_ordered × recipe_norm_per_portion
       - если есть модификаторы — скорректировать factor
    3. Записать в writeoffs_log:
       - ingredient_id, venue_id, quantity, unit, order_id, shift_id
    4. Обновить остаток в stock_current
```

### 5.2 Маппинг меню QuickResto → рецептуры Orakul

```
qr_menu_item_id  ─── (маппинг) ───→  orakul_dish_id  ───→  recipe
```

**Маппинг создаётся:**
- Автоматически при совпадении названий (нечёткий поиск, Levenshtein ≤ 2).
- Вручную через интерфейс «Настройки → Интеграции → QuickResto → Маппинг меню».

**Если маппинг не найден:** позиция записывается в `unmapped_items` с алёртом для менеджера. Заказ при этом не теряется — он хранится в `orders_raw` и будет обработан после настройки маппинга (ретроактивно).

### 5.3 Модель данных

```sql
-- Лог списаний
CREATE TABLE writeoffs_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id        UUID NOT NULL REFERENCES venues(id),
    order_id        TEXT,                          -- qr order id
    shift_id        UUID,
    ingredient_id   UUID REFERENCES ingredients(id),
    quantity        NUMERIC(12,4) NOT NULL,
    unit            TEXT NOT NULL,
    source          TEXT DEFAULT 'quickresto',     -- 'quickresto','kiepper','manual'
    is_reversal     BOOLEAN DEFAULT FALSE,
    recipe_snapshot JSONB,                         -- снимок рецептуры на момент события
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Немаппированные позиции
CREATE TABLE unmapped_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id        UUID NOT NULL,
    source          TEXT NOT NULL,        -- 'quickresto'
    external_id     TEXT NOT NULL,        -- qr menu_item_id
    external_name   TEXT NOT NULL,
    first_seen_at   TIMESTAMPTZ,
    order_count     INT DEFAULT 1,
    resolved_at     TIMESTAMPTZ,          -- null = не разрешено
    mapped_to       UUID REFERENCES dishes(id)
);
```

---

## 6. Интерфейс настройки интеграции

### 6.1 Экран подключения

```
Настройки → Интеграции → QuickResto

┌──────────────────────────────────────────────────────────────────┐
│  QuickResto                                         [Подключён ✅]│
│  ──────────────────────────────────────────────────────────────  │
│  Логин (email):    [buyer@mycafe.by          ]                   │
│  Пароль:           [••••••••••••             ]                   │
│  Точка (venue ID): [qr-venue-uuid-xxxx       ]                   │
│                                              [Проверить связь]   │
│                                                                  │
│  Режим синхронизации: ● Polling (5 мин)  ○ Webhook              │
│  URL для webhook:  https://orakul.app/webhook/qr/{token}         │
│                                              [Скопировать]       │
│                                                                  │
│  Последняя синхронизация: 21 мая 2026, 15:35 (2 мин назад)      │
│  Заказов за сегодня: 47                                          │
│  Немаппированных позиций: ⚠ 3  [Настроить маппинг →]            │
│                                                                  │
│  История синхронизаций:   [Показать лог]                        │
│                    [Отключить]          [Сохранить настройки]    │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Экран маппинга меню

```
┌──────────────────────────────────────────────────────────────────┐
│  Маппинг меню QuickResto                 [Автомаппинг]  [Импорт] │
│  ──────────────────────────────────────────────────────────────  │
│  Показать: [Все ▾]  [Немаппированные ▾]                          │
│                                                                  │
│  Позиция QuickResto          │  Блюдо Orakul        │  Статус   │
│  ─────────────────────────────────────────────────────────────  │
│  Капучино 300мл              │  Капучино 300         │  ✅ Готово │
│  Латте 400мл                 │  Латте 400            │  ✅ Готово │
│  Авокадо тост                │  [Выбрать блюдо... ▾] │  ⚠ Ждёт  │
│  Сырники классические        │  [Выбрать блюдо... ▾] │  ⚠ Ждёт  │
│  Смузи клубника              │  [Выбрать блюдо... ▾] │  ⚠ Ждёт  │
│                                                                  │
│  ⚠ 3 позиции немаппированы. Заказы с ними не списываются.       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. Первичная загрузка исторических данных

При первом подключении QuickResto:

```
1. Пользователь выбирает период импорта (рекомендация: последние 90 дней)
2. Система запускает Bulk Import Job в фоне
3. Прогресс отображается в интерфейсе:
   "Импортировано: 1 240 / 3 500 заказов (35%)"
4. По завершении — алёрт о числе заказов, немаппированных позиций
5. После настройки маппинга — ретроактивный пересчёт списаний
```

**Ограничения bulk import:**
- QuickResto API ограничивает выборку по дате: максимум 30 дней на запрос → итеративная выгрузка.
- Дедупликация по `order_id`; повторный импорт безопасен.

---

## 8. Обработка ошибок и мониторинг

| Ситуация | Действие |
|----------|---------|
| API QuickResto недоступен | Retry с exponential backoff (1, 5, 15 мин); алёрт после 3 неудач |
| 401 Unauthorized | Алёрт «Проверьте учётные данные QuickResto» |
| Rate limit exceeded (429) | Пауза 60 сек, retry |
| Некорректный JSON от API | Логировать raw-ответ, пропустить запись, продолжить |
| Рецептура не найдена | Записать в `unmapped_items`, продолжить |
| Отрицательный остаток после списания | Записать предупреждение в `stock_alerts`, продолжить |

**Метрики мониторинга:**
- `qr_sync_lag_seconds` — задержка последней синхронизации
- `qr_unmapped_items_count` — число немаппированных позиций
- `qr_orders_per_hour` — объём входящих заказов
- `writeoff_engine_errors_total` — ошибки движка списаний

---

## 9. API-эндпоинты (Orakul)

| Метод | URL | Описание |
|-------|-----|----------|
| `GET` | `/api/v1/integrations/quickresto` | Статус интеграции |
| `POST` | `/api/v1/integrations/quickresto/connect` | Подключить / обновить учётные данные |
| `DELETE` | `/api/v1/integrations/quickresto` | Отключить интеграцию |
| `POST` | `/api/v1/integrations/quickresto/sync` | Запустить ручную синхронизацию |
| `GET` | `/api/v1/integrations/quickresto/sync-log` | Лог синхронизаций |
| `GET` | `/api/v1/integrations/quickresto/mapping` | Список маппинга меню |
| `PUT` | `/api/v1/integrations/quickresto/mapping/{qr_id}` | Установить маппинг позиции |
| `POST` | `/api/v1/integrations/quickresto/import-bulk` | Запустить bulk-импорт |
| `POST` | `/webhook/qr/{token}` | Webhook-эндпоинт для push от QuickResto |

---

## 10. Критерии приёмки

- [ ] При закрытии заказа в QuickResto списание ингредиентов появляется в Orakul за ≤ 6 минут (polling) или ≤ 30 сек (webhook).
- [ ] Bulk-импорт за 90 дней завершается без потери заказов (дедупликация проверена).
- [ ] Немаппированная позиция не блокирует обработку остальных позиций того же заказа.
- [ ] Отмена/возврат заказа в QuickResto создаёт `writeoff_reversal`; остаток восстанавливается.
- [ ] Учётные данные QuickResto никогда не возвращаются в GET-запросах (только звёздочки).
- [ ] Синхронизация восстанавливается автоматически после перебоя API QuickResto без потери заказов.
- [ ] Ретроактивный пересчёт списаний после настройки маппинга работает корректно (нет дублирования).
