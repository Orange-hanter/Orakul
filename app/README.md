# Orakul Pilot App

Планшетное веб-приложение для сбора данных пилота. Работает в Safari на iPad Air.

## Стек

- **Сервер:** Node.js (ESM, `"type":"module"`) + Express, AES-256-GCM шифрование (встроенный `crypto`), JWT аутентификация. Модули — в [`app/server/`](server/).
- **Клиент:** React 18 + Vite, чистый CSS (без UI-фреймворков). Структура — в [`app/client/src/`](client/src/).
- **Хранилище:** зашифрованный файл `data/store.enc` на диске.
- **Аудит:** append-only NDJSON в `data/audit.jsonl` (не шифруется — это метаданные «кто/когда/что», см. `app/server/audit.js`).

## Быстрый старт

```bash
# 1. Скопировать конфиг
cp .env.example .env
# 2. Установить пароль (≥12 символов) в .env
nano .env

# 3. Установить зависимости
npm run setup

# 4. Собрать клиент
npm run build

# 5. Запустить сервер
npm start
# → http://127.0.0.1:3001 (loopback по умолчанию)
```

### Режим разработки (два терминала)

```bash
# Терминал 1 — сервер
npm run dev:server

# Терминал 2 — клиент (с hot reload)
npm run dev:client
# → http://localhost:5173  (проксирует /api → localhost:3001)
```

### Демо-данные

```bash
npm run seed-demo
# создаёт 3 точки, 12 продуктов, 3 поставщика, выручку за 14 дней
```

## Переменные окружения (.env)

| Переменная | Описание | Обязательно |
|---|---|---|
| `APP_PASSWORD` | Мастер-пароль — используется для входа **и** для шифрования данных. Минимум 12 символов (короче — warning при старте, т.к. это ещё и AES-ключ). | ✅ Да |
| `JWT_SECRET` | Секрет для подписи JWT. **В production обязателен** — без него сервер откажется стартовать (`NODE_ENV=production`). В dev — генерируется случайный (токены не переживают рестарт). | ✅ В prod / Рекомендуется в dev |
| `PORT` | Порт HTTP-сервера (default: 3001) | Нет |
| `BIND_HOST` | Интерфейс для listen. По умолчанию `127.0.0.1` (loopback, ходят через nginx). Для Docker / прямого доступа — `0.0.0.0`. | Нет |
| `CORS_ORIGIN` | Список разрешённых origin'ов через запятую. По умолчанию: всё разрешено в dev, всё запрещено в prod (расчёт на same-origin через nginx). | Нет |
| `AUDIT_MAX_BYTES` | Порог ротации `audit.jsonl`. Default: 5 MB. | Нет |
| `TELEGRAM_BOT_TOKEN` | Токен бота для дайджестов (опционально — можно ввести через UI). | Нет |
| `NODE_ENV` | `production` включает fail-fast на JWT_SECRET и закрывает CORS. | Нет |

## API

| Метод | Путь | Auth | Описание |
|---|---|---|---|
| POST | `/api/auth/login` | — | Авторизация по паролю. 5 ошибок за 15 мин → 429 (per-IP throttle). Сравнение timing-safe. |
| GET | `/api/health` | — | Liveness probe для Uptimerobot / Healthchecks.io. Возвращает `{status, uptimeSec, version}`. Не расшифровывает store. |
| GET | `/api/records` | JWT | Все non-plugin записи. Поддерживает query: `?type=X`, `?types=A,B,C`, `?venueId=<uuid>` (AND-combined). |
| POST | `/api/records` | JWT | Создать запись. `venueId` подставляется автоматически из default-точки, если не передан. |
| PUT | `/api/records/:id` | JWT | Обновить запись. Для `supplier_item` создаёт запись `supplier_price_history` и асинхронно шлёт Telegram-алерт при росте цены ≥ 5% или ≥ 1 BYN. |
| DELETE | `/api/records/:id` | JWT | Удалить запись. Каскад: удаление `supplier` тащит за собой его items + price_history. |
| GET | `/api/audit` | JWT | Последние N записей аудит-лога. `?limit=N&type=X&op=create\|update\|delete`. |
| GET | `/api/export` | JWT | Скачать зашифрованный store.enc. |
| POST | `/api/import` | JWT | Загрузить зашифрованный файл (text/plain, до 50 MB). Тот же APP_PASSWORD. |
| GET | `/api/stats` | JWT | `{total, byType}` |
| GET / POST / DELETE | `/api/telegram/config` | JWT | Конфигурация Telegram-бота. Токен валидируется через `getMe`. |
| POST | `/api/telegram/test-digest` | JWT | Отправить тестовый дайджест во все подключённые чаты. |
| GET / POST / DELETE | `/api/integrations/{quickresto,iiko}` | JWT | Конфиг плагинов интеграций. POST `/config`, POST `/test`, POST `/sync`. Секретные поля маскируются на ответе. |

## Архитектура сервера

```
app/
├── server.js              — точка входа (~50 строк, только wiring)
├── crypto.js              — AES-256-GCM + кэш PBKDF2-ключей
├── server/                — модули
│   ├── config.js          — env-валидация + константы
│   ├── store.js           — load/save store.enc + async mutex
│   ├── migrations.js      — startup migrations (stock_entry, multi-venue)
│   ├── audit.js           — NDJSON append-only + ротация
│   ├── auth.js            — JWT middleware + login route + per-IP throttle
│   ├── records.js         — CRUD на /api/records + /api/audit + /api/stats
│   ├── exportImport.js    — /api/export, /api/import
│   ├── telegram.js        — API + дайджесты + polling + scheduler + endpoints
│   ├── alerts.js          — F04/F06 price-jump alerts (дёргает Telegram)
│   └── health.js          — /api/health
├── integrations/
│   ├── createIntegrationRouter.js — фабрика REST-эндпоинтов для плагинов
│   ├── quickresto.js      — Quick Resto плагин (спецификация + sync)
│   └── iiko.js            — iiko плагин (спецификация + sync)
└── shared/
    └── scopedTypes.json   — venue-scoped record types (общий с клиентом через Vite @shared)
```

## Шифрование

```
Схема: AES-256-GCM
Ключ:  PBKDF2(APP_PASSWORD, random_salt, 100_000, SHA-256, 256 bit)
Формат файла: base64( salt[32] | iv[12] | tag[16] | ciphertext )
```

Производный ключ кэшируется в памяти по (длина пароля + salt) — иначе каждый запрос делал бы 100k SHA-256 итераций впустую.

## Поведение при ошибке расшифровки

`loadStore()` при ошибке расшифровки возвращает sentinel `{ records: [], _decryptFailed: true }`, и `saveStore()` отказывается записывать такой store. Стартовые миграции при обнаружении decrypt-fail вызывают `process.exit(1)` — сервер не стартует. Это защищает от случая «неправильный APP_PASSWORD молча перетёр реальный store пустым» (исторический баг, см. memory `feedback-loadstore-silent-failure`).

## Структура данных

Все записи хранятся в единой коллекции. Поле `type` определяет вид. Полный список — в [`shared/scopedTypes.json`](shared/scopedTypes.json) (venue-scoped) и в коде CRUD-обработчиков. Базовые типы:

| type | Назначение |
|---|---|
| `venue` | Точка организации (multi-venue) |
| `product` | Продукт склада (venue-scoped) |
| `stock_entry` | Движение склада: receipt / writeoff / inventory (venue-scoped) |
| `dish` | Блюдо меню с рецептом (venue-scoped) |
| `dish_sale` | Дневные продажи блюда (venue-scoped) |
| `supplier`, `supplier_item`, `supplier_price_history` | Поставщики и история цен |
| `order` | Заявка поставщику (venue-scoped) |
| `revenue_entry`, `fixed_expense` | Финансы (venue-scoped) |
| `stop`, `telegram_chat`, `recommendation_action` | Прочее (venue-scoped) |
| `telegram_settings`, `quickresto_settings`, `iiko_settings` | Plugin-конфиг — НЕ возвращаются через `/api/records` |

## Резервное копирование

- **Через UI:** вкладка **Данные** → «⬇ Скачать .enc файл».
- **На сервере:** `ops/backup-store.sh` (nightly, 7-day retention) — см. [`ops/`](../ops/).
- **Перед push'ем на прод** — обязательно убедиться, что свежая копия `store.enc` существует и расшифровывается тем же `APP_PASSWORD` (иначе она бесполезна).

## Безопасность

- Единый мастер-пароль для входа и для AES-ключа на диске.
- AES-256-GCM на `store.enc`, PBKDF2 (100k iters, SHA-256).
- JWT 24 ч в localStorage браузера.
- Login throttle 5 попыток / 15 мин per-IP, timing-safe password compare.
- CORS allowlist в prod (через `CORS_ORIGIN`); по умолчанию закрыт.
- Сервер слушает только loopback (`BIND_HOST=127.0.0.1`); внешний доступ — через nginx с HTTPS.
- Нет ролей/пользователей — всё под одним паролем (пилотный режим).
