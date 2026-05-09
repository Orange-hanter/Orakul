# Технические возможности получения исторических данных кухни через API

**Дата:** май 2026  
**Контекст:** Внешняя интеграция — получение данных через API из ресторанных POS-систем, распространённых на рынке Беларуси/Бреста.  
**Типы данных:** заказы, затраты/себестоимость, остатки, отказы/удаления, KDS-тайминги.

---

## 1. iiko (айко) — наиболее полный API

### Архитектура API

iiko имеет **два независимых API-слоя**:

| Слой | Назначение | Тип |
|---|---|---|
| **iikoServer REST API** | Исторические данные, отчёты, склад, номенклатура | REST/JSON, базовый URL: `/resto/api/` |
| **iikoTransport (Cloud API)** | Облачный вариант, доставка, стоп-листы, меню | REST/JSON, базовый URL: `api-ru.iiko.services/api/1/` |
| **iikoFront Plugin API** | Плагины прямо в POS-терминале (.NET SDK) | .NET SDK (C#) |

---

### 1.1. Заказы — исторические данные

**Эндпоинт:** `GET /resto/api/v2/orders`  
**Облачный вариант:** `POST /api/1/deliveries/by_id`, `POST /api/1/order/by_table`

Доступные поля заказа:
- `id`, `number` — идентификатор и номер заказа
- `openDateTime`, `closeDateTime` — время открытия и закрытия
- `waiter` — официант
- `table`, `tableSection` — стол и зал
- `items[]` — позиции заказа (блюдо, количество, цена, модификаторы)
- `discounts[]` — скидки
- `payments[]` — типы оплат
- `status` — статус (открыт, закрыт, удалён)

**Глубина истории:** определяется настройками хранения на сервере iiko (как правило, без ограничений при наличии базы данных).

---

### 1.2. OLAP-отчёты — главный инструмент исторического анализа

**Эндпоинт:** `POST /resto/api/v2/reports/olap`

Параметры запроса:
```json
{
  "reportType": "SALES",         // или "TRANSACTIONS", "STORECONTROL"
  "buildSummary": true,
  "groupByRowFields": ["DishName", "DishCategory", "OpenDate"],
  "aggregateFields":  ["DishAmountInt", "DishDiscountSumInt", "ProductCostSumInt"],
  "filters": {
    "OpenDate": { "from": "2025-01-01", "to": "2025-12-31" }
  }
}
```

**Типы OLAP-отчётов:**

| reportType | Что содержит |
|---|---|
| `SALES` | Продажи по блюдам: количество, сумма, себестоимость, скидки, прибыль |
| `TRANSACTIONS` | Проводки: все движения по внутренним счетам — списания, продажи, возвраты |
| `STORECONTROL` | Складской контроль: остатки, движение ингредиентов |

---

### 1.3. Отказы и удалённые блюда

В iiko фиксируются несколько типов удаления/отказа, доступных через OLAP `TRANSACTIONS`:

| Тип транзакции | Описание |
|---|---|
| `SALE` | Продажа — прошла в чек |
| `WRITEOFF` | Списание — удалено с записью причины списания |
| `DELETED_WITHOUT_WRITEOFF` | Удалено без списания (официант удалил позицию до закрытия заказа) |

**Фильтрация в API:**
```json
"filters": {
  "DeletedWithWriteoff": {
    "filterType": "INCLUDE",
    "values": ["DELETED_WITHOUT_WRITEOFF"]
  }
}
```

Таким образом, через OLAP API можно получить:
- все позиции, удалённые официантом до отправки на кухню
- позиции, удалённые после отправки (с причиной или без)
- статистику отказов по блюдам, официантам, датам

---

### 1.4. Затраты и себестоимость

Через `SALES` OLAP доступны поля:
- `ProductCostSumInt` — себестоимость блюда (по техкарте × количество)
- `GrossProfitInt` — валовая прибыль
- `MarginInt` — маржа

Через `TRANSACTIONS` OLAP:
- все движения по счёту "Себестоимость" за период
- возможность выгрузки по ингредиентам (не только по блюдам)

---

### 1.5. Остатки склада

**Эндпоинт:** `GET /resto/api/v2/store/products/balance`  
Возвращает текущие остатки по ингредиентам на складе.

Для **исторических остатков** используется OLAP `STORECONTROL`:
- приходы, расходы, списания, инвентаризации по периодам
- разбивка по складам, категориям, ингредиентам

---

### 1.6. Стоп-лист (облачный API)

**Эндпоинт (iikoTransport):** `POST /api/1/stop_lists`  
Возвращает текущий стоп-лист — позиции, недоступные к заказу.  
**Историческую динамику стоп-листа** через API получить сложнее — нужна собственная периодическая запись снимков.

---

### 1.7. Аутентификация и доступ

```
POST /resto/api/auth                  # получить токен сессии
Header: Authorization: Basic <base64>
```
Для iikoTransport (облако): токен через `/api/1/access_token`.

**SDK и библиотеки:**
- Python: `pyiikocloudapi` (PyPI), `iiko-api` (GitHub fisher85)
- Go: `iiko-go` (GitHub wollzy, themgmd, kebrick)
- .NET: официальный `iikoFront API SDK` (GitHub iiko/front.api.sdk)

---

## 2. R_Keeper 7 — XML-интерфейс + StoreHouse API

### Архитектура API

| Слой | Назначение | Тип |
|---|---|---|
| **XML Interface (RK7)** | Заказы, смены, кассовые данные | XML over HTTP, `/rk7api/v0/xmlinterface.xml` |
| **StoreHouse Pro Web API** | Складской учёт, остатки, движения | REST/JSON, `/api/sh5exec` |
| **FarCards / CRM API** | Лояльность, гости | XML/JSON |

---

### 2.1. Заказы — XML-интерфейс

**Запрос списка заказов:**
```xml
<RK7Query>
  <RK7Command CMD="GetOrderList"/>
</RK7Query>
```

Возвращает активные заказы текущей смены. Для **исторических** данных используются:
- `GetVisitList` — список визитов (закрытых заказов) за период
- `GetCashierSessionsByDate` — данные смен
- Экспорт кассовых документов в XML-формате

**XML-описание кассового документа** — полная структура заказа для передачи внешним системам, включает:
- номер чека, время, стол, официант
- позиции (блюда, количество, цены до/после скидок)
- типы оплат

**Ограничение:** XML-интерфейс предоставляет данные **текущей смены** по умолчанию. Исторические данные требуют или интеграции через StoreHouse, или прямого доступа к БД через отдельные настройки.

---

### 2.2. Удалённые блюда / Отказы

В R_Keeper 7 события удаления блюд (void) фиксируются в транзакционном журнале. Получить их через XML-интерфейс можно через специальный XML-экспорт чековых документов с флагом включения удалённых позиций.

Официальный документ: **"XML описание кассового документа для предоставления внешним системам"** — описывает структуру данных, включая удалённые позиции заказа.

---

### 2.3. StoreHouse Pro Web API — склад и остатки

**Базовый URL:** `https://<host>/api/`

**Два метода:**
```
POST /api/sh5struct   # получить структуру датасетов процедуры
POST /api/sh5exec     # выполнить процедуру
```

**Формат запроса:**
```json
{
  "login": "user",
  "password": "pass",
  "procName": "GetProductBalance",
  "Input": [
    {
      "name": "Params",
      "rows": [
        { "DateFrom": "2025-01-01", "DateTo": "2025-12-31" }
      ]
    }
  ]
}
```

Доступные процедуры (типовые):
- Текущие остатки по складам
- Движение товаров за период (приход, расход, списание)
- Инвентаризационные остатки

**Интеграция с 1С:** из коробки, двунаправленная синхронизация.

---

### 2.4. Лицензирование и ограничения

- XML-интерфейс доступен из коробки (лицензия R_Keeper 7)
- Для `Delivery API` нужна **отдельная лицензия** `Delivery_Api`
- StoreHouse Pro — **отдельный продукт**, требует отдельной установки и лицензии
- Документация: [docs.rkeeper.ru](https://docs.rkeeper.ru), [docs.rkeeper.com](https://docs.rkeeper.com)

---

## 3. Poster POS — открытый REST API

### Доступ

Официальный портал разработчиков: [dev.joinposter.com](https://dev.joinposter.com/en)  
Тип API: REST/JSON, OAuth 2.0  
Версия: v3 (актуальная)

### 3.1. Исторические данные заказов

```
GET /api/transactions.getTransactions
```
Параметры: `dateFrom`, `dateTo`, `type`  
Возвращает: история транзакций с позициями заказов

```
GET /api/transactions.getOrder
```
Отдельный заказ по ID.

### 3.2. Остатки и движение ингредиентов

```
GET /api/storage.getIngredients      # список ингредиентов с остатками
GET /api/storage.getStorageBalances  # остатки на дату
GET /api/storage.getIngredientHistory # история движения ингредиента
```

### 3.3. Себестоимость и затраты

```
GET /api/finance.getFinanceStats     # финансовая статистика за период
GET /api/dash.getIngredientProfit    # прибыльность блюд
```

### 3.4. Стоп-лист

```
GET /api/menu.getStopList            # текущий стоп-лист
```

**Примечание:** Poster — **облачная система**, данные всегда доступны через API без VPN/локального сервера. Webhook-уведомления поддерживаются.

---

## 4. Quick Resto — ограниченный API

Quick Resto имеет **открытый API**, но менее документированный по сравнению с iiko и Poster.

- Интеграция через HTTP-запросы к API Quick Resto
- Поддержка Webhook для передачи данных
- Готовые коннекторы в сервисах Albato, ApiMonster (low-code интеграция)
- **Доcsинbox** интеграция — автоматическая загрузка накладных

Для серьёзной интеграции по историческим кухонным данным Quick Resto **не рекомендуется** — документация неполная, поддержка нескольких терминалов офлайн ограничена.

---

## 5. Сводная таблица по историческим данным

| Тип данных | iiko | R_Keeper + StoreHouse | Poster POS | Quick Resto |
|---|---|---|---|---|
| **История заказов** | REST `/v2/orders` или OLAP | XML `GetVisitList` | REST `transactions.getTransactions` | Ограниченно |
| **Позиции заказа (блюда)** | OLAP `SALES` | XML кассовый документ | REST transactions | Да |
| **Удалённые позиции (отказы)** | OLAP `TRANSACTIONS` + фильтр `DELETED_WITHOUT_WRITEOFF` | XML с флагом удалённых | Нет данных | Нет |
| **Причины удаления** | OLAP поле `DeletedWithWriteoff` | Транзакционный журнал | Нет данных | Нет |
| **Себестоимость блюд** | OLAP поле `ProductCostSumInt` | StoreHouse API | `finance.getFinanceStats` | Ограниченно |
| **Остатки склада (текущие)** | REST `/store/products/balance` | StoreHouse `/api/sh5exec` | `storage.getStorageBalances` | Базово |
| **Остатки склада (история)** | OLAP `STORECONTROL` | StoreHouse движение | `storage.getIngredientHistory` | Нет |
| **Стоп-лист** | `POST /api/1/stop_lists` | Нет прямого API | `menu.getStopList` | Нет |
| **KDS-тайминги** | iikoFront SDK (события) | Нет прямого API | Нет | Нет |
| **Тип доступа** | REST JSON | XML + REST JSON | REST JSON | REST/Webhook |
| **Документация** | Подробная, GitHub + help | Официальная, docs.rkeeper.ru | Открытая, dev.joinposter.com | Слабая |
| **Аутентификация** | Token/Basic | Username/Password | OAuth 2.0 | API Key |
| **Требует лицензии** | Нет (входит в подписку) | Частично (Delivery API отдельно) | Нет | Нет |

---

## 6. Рекомендации по интеграции

### Если цель — максимальная полнота данных (заказы + отказы + склад + затраты):
→ **iiko** — самый полный и структурированный API. OLAP `TRANSACTIONS` с фильтром по типу транзакции покрывает все нужные срезы. Хорошая документация, есть готовые SDK.

### Если заведение уже на R_Keeper:
→ Нужен **StoreHouse Pro** (отдельная лицензия) для складских данных + XML-интерфейс для заказов. Сложнее в интеграции, но данные полные.

### Если нужна быстрая интеграция с минимальными затратами:
→ **Poster POS** — открытый REST API с OAuth, хорошая документация, облако без VPN. Но слабее по глубине аналитики кухонных событий (отказы, KDS).

### KDS-тайминги (время приготовления блюд):
→ Доступны только через **iikoFront Plugin API** (SDK, события в реальном времени). Исторический архив таймингов не предоставляется ни одной системой через стандартный API — нужна собственная запись событий на стороне приёмника.

---

## Источники

- [iikoFront API документация — GitHub](https://iiko.github.io/front.api.doc/)
- [iikoFront API SDK — GitHub](https://github.com/iiko/front.api.sdk)
- [iikoWeb Public API — Postman](https://documenter.getpostman.com/view/2896430/TVemBpmn)
- [iiko SOI API — Postman](https://documenter.getpostman.com/view/3103652/TVCcZW1D)
- [iiko OLAP отчёты — multi-bit.com](https://multi-bit.com/avt_iiko/olap_otchjoty_iiko)
- [iiko OLAP поля по продажам — soft-expansia.ru](https://soft-expansia.ru/knowledge-base/iiko/polya-olap-otcheta-po-prodazham/)
- [iiko OLAP по проводкам — open-s.info](https://open-s.info/blog/olap_instruktsiya/)
- [pyiikocloudapi — PyPI](https://pypi.org/project/pyiikocloudapi/)
- [R_Keeper XML Interface — docs.rkeeper.com](https://docs.rkeeper.com/display/translate/r_keeper+7+XML+Interface)
- [R_Keeper XML Interface — docs.rkeeper.ru](https://docs.rkeeper.ru/rk7/latest/ru/xml-interfejs-r_keeper-7-19605640.html)
- [XML кассовый документ для внешних систем — docs.rkeeper.ru](https://docs.rkeeper.ru/crm/xml-opisanie-kassovogo-dokumenta-dlya-predostavleniya-vneshnim-sistemam-19611639.html)
- [StoreHouse Pro API — docs.rkeeper.ru](https://docs.rkeeper.ru/sh5/api-19612347.html)
- [StoreHouse Web API напрямую](https://docs.rkeeper.ru/sh5/rabota-s-web-api-napryamuyu-12093299.html)
- [Poster POS для разработчиков](https://dev.joinposter.com/en)
- [Poster API документация v3](https://dev.joinposter.com/en/docs/v3/start/index)
- [Quick Resto интеграции](https://quickresto.ru/integrations/)
- [RK7Die библиотека — GitHub](https://github.com/antonko/RK7Die)
