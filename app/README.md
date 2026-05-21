# Orakul Pilot App

Планшетное веб-приложение для сбора данных пилота. Работает в Safari на iPad Air.

## Стек

- **Сервер:** Node.js + Express, AES-256-GCM шифрование (встроенный `crypto`), JWT аутентификация
- **Клиент:** React 18 + Vite, чистый CSS (без UI-фреймворков)
- **Хранилище:** зашифрованный файл `data/store.enc` на диске

## Быстрый старт

```bash
# 1. Скопировать конфиг
cp .env.example .env
# 2. Установить пароль в .env
nano .env

# 3. Установить зависимости
npm run setup

# 4. Собрать клиент
npm run build

# 5. Запустить сервер
npm start
# → http://localhost:3001
```

### Режим разработки (два терминала)

```bash
# Терминал 1 — сервер
npm run dev:server

# Терминал 2 — клиент (с hot reload)
npm run dev:client
# → http://localhost:5173  (проксирует /api → localhost:3001)
```

## Переменные окружения (.env)

| Переменная | Описание | Обязательно |
|---|---|---|
| `APP_PASSWORD` | Мастер-пароль — используется для входа **и** для шифрования данных | ✅ Да |
| `JWT_SECRET` | Секрет для JWT-токенов (если не задан — генерируется при старте, сессии сбрасываются при рестарте) | Рекомендуется |
| `PORT` | Порт сервера (default: 3001) | Нет |

## API

| Метод | Путь | Auth | Описание |
|---|---|---|---|
| POST | `/api/auth/login` | — | Авторизация, возвращает JWT |
| GET | `/api/records` | JWT | Все записи (расшифровано) |
| POST | `/api/records` | JWT | Создать запись |
| PUT | `/api/records/:id` | JWT | Обновить запись |
| DELETE | `/api/records/:id` | JWT | Удалить запись |
| GET | `/api/export` | JWT | Скачать зашифрованный файл |
| POST | `/api/import` | JWT | Загрузить зашифрованный файл |
| GET | `/api/stats` | JWT | Статистика |

## Шифрование

```
Схема: AES-256-GCM
Ключ:  PBKDF2(APP_PASSWORD, random_salt, 100_000, SHA-256, 256 bit)
Формат файла: base64( salt[32] | iv[12] | tag[16] | ciphertext )
```

## Структура данных

Все записи хранятся в единой коллекции. Поле `type` определяет вид:

| type | Поля |
|---|---|
| `kpi` | date, pilotPoint, kpiId, value, baseline, unit, notes |
| `obs` | date, author, category (positive/neutral/negative), text |
| `task` | date, taskId, taskName, status, comment |

## Резервное копирование

Данные хранятся в `data/store.enc`. Регулярно экспортируйте файл через вкладку **Данные** в приложении.

## Безопасность (минимальный уровень)

- Единый мастер-пароль для всего
- AES-256-GCM шифрование данных на диске
- JWT (24ч) в localStorage браузера
- Нет HTTPS (для локальной сети достаточно)
- Нет ролей/пользователей — всё под одним паролем
