---
Документ: QuickResto Integration Recon
Версия: 1.0
Дата: 2026-05-28
Статус: Заполнен (на основе исследования OpenAPI и существующей спецификации)
Владелец: Tech Lead + Data Lead
Связанные документы: [QuickResto Integration Spec](09-quickresto-integration-spec.md), [Kiepper Integration Recon](01-kiepper-integration-recon.md), [Data Model & Pipeline](02-data-model-and-pipeline.md), [MVP Architecture](00-mvp-architecture.md)
---

# QuickResto Integration Recon

> ⚠️ Этот документ — результат первичной разведки QuickResto API на основе публичной документации (ReDoc/OpenAPI v2.92) и анализа существующей спецификации [09-quickresto-integration-spec.md](09-quickresto-integration-spec.md).
>
> **Важно:** Существует несоответствие между endpoint'ами, задокументированными в спецификации 09, и реальными endpoint'ами Back Office API. Это зафиксировано в §3.2 и требует уточнения.

---

## 0. Цель

Определить **точный контракт интеграции с QuickResto** — метод доступа, доступные сущности, ограничения и риски — до начала написания ETL-кода.

---

## 1. Резюме разведки

| Параметр | Значение |
|----------|----------|
| **Метод доступа** | REST API (Pattern A ✅) |
| **Базовый URL** | `https://{layer}.quickresto.ru/platform/online/api/` |
| **Аутентификация** | Basic Auth через заголовок `X-Authorization` (не стандартный `Authorization`) |
| **Формат** | JSON |
| **Версия API** | v2.92 (Back Office API) |
| **Rate limit** | ≤ 60 запросов/мин (уточнять с клиентом) |
| **Инкрементальный pull** | ✅ Возможен через `filters` по `serverRegisterTime` / `lastUpdateDate` |
| **Webhook** | ❌ Не документирован |
| **Облако / On-premise** | Только облачная версия (Windows-терминал без облака — API недоступен) |

---

## 2. Доступные сущности (из OpenAPI)

### 2.1 Справочники номенклатуры

| Сущность | moduleName | Нужное для Orakul | Примечание |
|----------|-----------|-------------------|------------|
| `Dish` | `warehouse.nomenclature.dish` | Да (меню/блюда) | `currentPrimeCost` — средняя себестоимость за кг |
| `SingleProduct` | `warehouse.nomenclature.singleproduct` | Да (ингредиенты) | `measureUnit` — ед. изм. |
| `SemiProduct` | `warehouse.nomenclature.semiproduct` | Да (полуфабрикаты) | Рекурсивное разворачивание |
| `Modifier` | `warehouse.nomenclature.modifier` | Да (опции блюд) | Влияют на рецептуру |
| `ModifierLink` | `warehouse.nomenclature.modifierlink` | Да | Связь модификаторов с блюдами |
| `Store` | `warehouse.nomenclature.store` | Да (склады/точки) | `storeQuantityKg` — остаток |
| `StoreProduct` | `warehouse.documents.storeproduct` | Да | `storeQuantityKg` — остаток по SKU |

### 2.2 Документы (транзакции)

| Сущность | moduleName | Нужное для Orakul | Примечание |
|----------|-----------|-------------------|------------|
| `OrderInfo` | `front.orders` | Да (чеки/продажи) | `productOutgoing` — расход продуктов |
| `IncomingInvoice` | `warehouse.documents.incoming` | Да (закупки) | Приходные накладные |
| `DiscardInvoice` | `warehouse.documents.discard` | Да (списания) | Акты списания |
| `InventoryDocument2` | `warehouse.documents.inventory` | Да (инвентаризация) | Фактические остатки |
| `CookingInvoice` | `warehouse.documents.cooking` | **Критично** | **Рецептуры хранятся здесь** в `invoiceComponents` |
| `ProductInvoice` | `warehouse.documents.product` | Да | Движение продуктов |
| `ConcreteProvider` | `warehouse.providers.concrete` | Да (поставщики) | Контрагенты |

### 2.3 ⚠️ Несоответствие со спецификацией 09

Спецификация [09-quickresto-integration-spec.md](09-quickresto-integration-spec.md) задокументирует другой набор endpoint'ов:

| В документе 09 | В реальном API (ReDoc) | Статус |
|----------------|------------------------|--------|
| `/order/list` | `/api/list?moduleName=front.orders` | Возможно, alias или устаревший endpoint |
| `/menu/list` | `/api/list?moduleName=warehouse.nomenclature.dish` | Разные сущности |
| `/supply/list` | `/api/list?moduleName=warehouse.documents.incoming` | Разные сущности |
| `/nomenclature/list` | `/api/list?moduleName=warehouse.nomenclature.singleproduct` | Разные сущности |
| `/modificationGroup/list` | `/api/list?moduleName=warehouse.nomenclature.modifier` | Разные сущности |

**Решение:** При первом подключении проверить оба набора endpoint'ов. Если `/order/list` работает — использовать его (более удобный). Если нет — переходить на `/api/list?moduleName=...`.

---

## 3. Детали API

### 3.1 Аутентификация

```
GET https://{layer}.quickresto.ru/platform/online/api/
Headers:
  X-Authorization: Basic {base64(username:password)}
  Content-Type: application/json
```

**Важно:** Не стандартный `Authorization: Basic`, а кастомный `X-Authorization: Basic`.

### 3.2 Формат запросов

```
GET /api/list?moduleName=front.orders&offset=0&limit=1000&filters=[...]
```

**Параметры:**
- `moduleName` — обязательный, определяет сущность
- `offset` + `limit` — пагинация
- `filters` — массив фильтров (формат не полностью документирован)
- `sort` — сортировка
- `withDeleted` — включать удалённые записи

### 3.3 Формат ответов

```json
{
  "items": [
    { ...entity fields... }
  ],
  "total": 1234
}
```

### 3.4 Инкрементальный pull

| Сущность | Поле для инкремента | Фильтр |
|----------|---------------------|--------|
| Справочники (Dish, SingleProduct) | `serverRegisterTime` | `filters` по диапазону |
| OrderInfo | `createDate`, `serverRegisterTime` | `filters` по дате |
| IncomingInvoice | `invoiceDate`, `lastUpdateDate` | `filters` по дате |
| DiscardInvoice | `invoiceDate`, `lastUpdateDate` | `filters` по дате |
| CookingInvoice | `invoiceDate`, `lastUpdateDate` | `filters` по дате |

---

## 4. Рецептуры — критичный вопрос

### 4.1 Где хранятся рецептуры

В QuickResto рецептура блюда **не хранится в сущности Dish**. Она хранится в **`CookingInvoice`** в поле `invoiceComponents` — список ингредиентов с количеством для приготовления.

### 4.2 Последствия для ETL

1. Для расчёта theoretical consumption нужно выгрузить **все CookingInvoice** и построить маппинг «блюдо → ингредиенты».
2. Если клиент не использует акты приготовления (частая практика в фастфуде), **рецептур нет**.
3. Нужен fallback: если CookingInvoice пустые, Orakul должен сообщить пользователю и предложить ручной ввод рецептур.

### 4.3 Маппинг рецептур

```
Dish.id  ←── CookingInvoice.productId  ←── invoiceComponents[]
                                          ├── SingleProduct.id (ingredient_id)
                                          └── quantity (norm per portion)
```

---

## 5. Единицы измерения

| Поле | Где | Тип |
|------|-----|-----|
| `measureUnit` | SingleProduct | string (кг, г, л, мл, шт) |
| `measureUnitId` | SingleProduct | FK на справочник единиц |

**Проблема:** Смешанные единицы в одной таблице без явного типа (вес/объём/шт).

**Митигация:** На уровне staging нормализовать к базовой единице (г для весовых, мл для жидких, шт для штучных). Конвертационная таблица — в конфиге коннектора.

---

## 6. Маппинг сущностей QR → Orakul

| Сущность Orakul | Сущность QR | Endpoint | Поле связи |
|-----------------|-------------|----------|------------|
| `venue` | `Store` (или `Business`) | `/api/list?moduleName=warehouse.nomenclature.store` | `Store.id` |
| `product` (ингредиент) | `SingleProduct` | `/api/list?moduleName=warehouse.nomenclature.singleproduct` | `SingleProduct.id` |
| `dish` | `Dish` | `/api/list?moduleName=warehouse.nomenclature.dish` | `Dish.id` |
| `dish_sale` | `OrderInfo` → `ProductOutgoing` | `/api/list?moduleName=front.orders` | `OrderInfo.id` |
| `stock_entry` | `StoreProduct.storeQuantityKg` | `/api/list?moduleName=warehouse.documents.storeproduct` | `StoreProduct.id` |
| `supplier` | `ConcreteProvider` | `/api/list?moduleName=warehouse.providers.concrete` | `ConcreteProvider.id` |
| `order` (закупка) | `IncomingInvoice` | `/api/list?moduleName=warehouse.documents.incoming` | `IncomingInvoice.id` |
| `writeoff` | `DiscardInvoice` | `/api/list?moduleName=warehouse.documents.discard` | `DiscardInvoice.id` |
| `recipe` | `CookingInvoice.invoiceComponents` | `/api/list?moduleName=warehouse.documents.cooking` | `CookingInvoice.productId` → `Dish.id` |
| `revenue_entry` | `OrderInfo` | `/api/list?moduleName=front.orders` | `OrderInfo.id` |

---

## 7. Частота синхронизации (рекомендуемая)

| Сущность | Частота | Режим | Обоснование |
|----------|---------|-------|-------------|
| Справочники (Dish, SingleProduct, Store) | Каждые 30 мин | Full-ish (limit=1000) | Редко меняются |
| Остатки (StoreProduct.storeQuantityKg) | Каждые 15 мин | List всех позиций | Нет отдельного endpoint |
| Чеки (OrderInfo) | Каждые 5 мин | Filter по `createDate >= last_sync` | Продажи в реальном времени |
| Приходные накладные | Каждые 15 мин | Filter по `invoiceDate >= last_sync` | Закупки |
| Акты списания | Каждые 15 мин | Filter по `invoiceDate >= last_sync` | Потери |
| Акты инвентаризации | Каждые 30 мин | Filter по `invoiceDate >= last_sync` | Инвентаризация |
| Рецептуры (CookingInvoice) | Каждые 30 мин | Full (мало записей, но критичны) | Приготовления |

---

## 8. Ограничения и риски

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| **Нет рецептур** (CookingInvoice пустые) | Высокая (фастфуд) | Блокер для theoretical consumption | Fallback на ручной ввод рецептур |
| **Rate limit** (неизвестен точно) | Средняя | Задержка синхронизации | Backoff, запросить у support@quickresto.ru |
| **Формат filters не документирован** | Средняя | Невозможен инкремент | Тестировать, запросить примеры у вендора |
| **Облако only** (on-premise без API) | Низкая | Нет интеграции | Предупреждать клиента заранее |
| **Схема меняется без уведомления** | Низкая | Сломанный ETL | Мониторинг ошибок парсинга, grace period |
| **Двойные endpoint'ы** (09 vs ReDoc) | Средняя | Путаница в реализации | Проверить оба набора при пилоте |

---

## 9. Тест-план первого подключения (Day 1)

```
Шаг 1: Аутентификация
  → GET /api/list?moduleName=front.orders&limit=1
  → Результат: 200 OK, JSON с полем "items"

Шаг 2: Проверка обоих наборов endpoint'ов
  → Проверить /order/list (если возвращает 404 — использовать /api/list)
  → Зафиксировать рабочий набор

Шаг 3: Выгрузка справочника SKU
  → GET /api/list?moduleName=warehouse.nomenclature.singleproduct&limit=1000
  → Проверить: есть ли поля id, name, measureUnit
  → Посчитать: сколько всего SKU

Шаг 4: Выгрузка рецептур (CookingInvoice)
  → GET /api/list?moduleName=warehouse.documents.cooking&limit=100
  → Проверить: есть ли поле invoiceComponents
  → Посчитать: % блюд с рецептурами

Шаг 5: Выгрузка продаж за последние 7 дней
  → GET /api/list?moduleName=front.orders&filters=[...]
  → Проверить: детализация до блюд (productOutgoing)
  → Посчитать: кол-во чеков, топ-10 блюд

Шаг 6: Выгрузка остатков
  → GET /api/list?moduleName=warehouse.documents.storeproduct
  → Проверить наличие данных
  → Сравнить со знанием клиента

Шаг 7: Запустить Data Audit L1
  → По критериям из [Data Audit Checklist](../04-implementation/04-data-audit-checklist-kiepper.md)
  → Зафиксировать результаты в §10
```

---

## 10. Результаты разведки (заполняется по факту пилота)

```
ДАТА РАЗВЕДКИ: ________________
ИСПОЛНИТЕЛЬ: __________________
ТОЧКА: ________________________

РАБОЧИЕ ENDPOINT'Ы:
[ ] /order/list и др. из спеки 09
[ ] /api/list?moduleName=...

МЕТОД ДОСТУПА: [x] REST API
BASE URL: ___________________________
Auth method: X-Authorization Basic

ДОСТУПНЫЕ СУЩНОСТИ:
[x] SKU / Номенклатура     moduleName: warehouse.nomenclature.singleproduct
[x] Рецептуры              moduleName: warehouse.documents.cooking
[x] Меню / Блюда           moduleName: warehouse.nomenclature.dish
[x] Продажи / Чеки         moduleName: front.orders
[x] Поставки               moduleName: warehouse.documents.incoming
[x] Остатки                moduleName: warehouse.documents.storeproduct
[x] Списания               moduleName: warehouse.documents.discard
[x] Поставщики             moduleName: warehouse.providers.concrete

ИСТОРИЯ ПРОДАЖ: ___ месяцев доступно
ДЕТАЛИЗАЦИЯ ЧЕКОВ ДО БЛЮД: ДА / НЕТ
РЕЦЕПТУРЫ ПОКРЫВАЮТ ___% активных блюд
ЕДИНИЦЫ ИЗМЕРЕНИЯ: нормализованы / смешанные / строки

БЛОКИРУЮЩИЕ ПРОБЛЕМЫ:
1. _________________________________________________
2. _________________________________________________

ВЫВОД (GO / NO-GO для фазы T1):
[ ] GO — начинаем ETL
[ ] CONDITIONAL GO — с ограничениями: _____________
[ ] NO-GO — причина: ______________________________

СЛЕДУЮЩИЕ ШАГИ:
1. _______________________ до ______________
2. _______________________ до ______________
```

---

## 11. Changelog

| Версия | Дата | Автор | Изменения |
|--------|------|-------|-----------|
| 1.0 | 2026-05-28 | Tech Lead + Data Lead | Первая версия на основе OpenAPI (ReDoc) и существующей спецификации 09. Зафиксировано несоответствие endpoint'ов. |
