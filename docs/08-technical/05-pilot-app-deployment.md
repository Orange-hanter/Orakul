---
Документ: Pilot App — Deployment Runbook
Версия: 1.0
Дата: 2026-05-19
Статус: Действующий
Владелец: Daniil Akhramiuk
Связанные документы: [MVP Architecture](00-mvp-architecture.md), [Pilot App README](../../app/README.md)
---

# Pilot App — Deployment Runbook

Описание развёрнутого окружения пилотного приложения Orakul (планшетный сборщик данных), служебные команды и открытые риски. Документ обновляется при каждом изменении инфраструктуры.

---

## 1. Что развёрнуто

Приложение `app/` из этого репозитория — Node.js + Express сервер с React/Vite клиентом и зашифрованным файловым хранилищем (`data/store.enc`, AES-256-GCM, ключ = `APP_PASSWORD`).

| Слой | Технология | Где |
|---|---|---|
| Reverse proxy | nginx 1.24 (Ubuntu) | `:80` на публичном IP → `127.0.0.1:3001` |
| Приложение | Node.js 20 LTS + Express | systemd unit `orakul.service`, порт `3001` |
| Клиент | React 18 + Vite (статика) | `/opt/orakul/client/dist`, раздаётся самим Express |
| Хранилище | Зашифрованный файл | `/opt/orakul/data/store.enc` |
| ОС / хост | Ubuntu 24.04 LTS | hostname `106316.com`, IP `157.22.174.219` |

Сервер используется **только** под Orakul Pilot (других сервисов на нём не запущено).

---

## 2. Доступ и сеть

| Параметр | Значение |
|---|---|
| Публичный URL | `http://157.22.174.219/` |
| SSH-алиас | `orakul` (см. `~/.ssh/config` на машине разработчика) |
| SSH-ключ | `~/.ssh/orakul_deploy` (приватный, на машине разработчика) |
| SSH-пользователь | `root` |
| Открытые порты | `22` (SSH), `80` (HTTP через nginx) |
| Firewall (ufw) | **неактивен** (см. п. 7. Риски) |
| TLS / HTTPS | **не настроен** (см. п. 7. Риски) |

> Внутренний порт `3001` слушается на `0.0.0.0` процессом node — потенциально доступен снаружи в обход nginx (см. п. 7).

---

## 3. Файловая структура на сервере

```
/opt/orakul/
├── server.js              # Express API
├── crypto.js              # AES-256-GCM обёртка
├── seed-demo.js           # CLI для наполнения демо-данными (не запускается сервисом)
├── package.json
├── node_modules/          # production-only (npm install --omit=dev)
├── .env                   # секреты — chmod 600, owner orakul:orakul
├── data/
│   ├── store.enc          # зашифрованные записи (создаётся при первом запуске)
│   └── store.enc.backup-* # бэкапы перед релизами (создаются вручную — см. §8.5)
├── integrations/          # серверные модули плагинов (опциональные)
│   ├── quickresto.js      # Quick Resto POS — mock + stub для live
│   └── iiko.js            # iiko POS — mock + stub для live
└── client/
    ├── package.json       # client deps (включая xlsx с CDN SheetJS)
    ├── node_modules/      # dev-deps для сборки (опционально на проде — см. §8.5)
    ├── src/               # исходники (НЕ деплоятся, сборка локально)
    └── dist/              # собранная статика — её отдаёт Express
        ├── index.html
        └── assets/
            ├── index-*.js  # основной бандл React (~78 KB gzip)
            ├── xlsx-*.js   # отдельный чанк для xlsx (~163 KB gzip, lazy)
            └── index-*.css # стили (~5 KB gzip)
```

- Владелец всего дерева: `orakul:orakul` (системный пользователь, shell — `/usr/sbin/nologin`).
- Права на `.env`: `600`. Никто кроме `orakul` и `root` его не читает.

---

## 4. Секреты — где лежат и что значат

**Все секреты живут в одном файле:** `/opt/orakul/.env` на сервере.

```
APP_PASSWORD=zU1fxbzYGLi2zYCYbd0B
JWT_SECRET=343cf3e96a968f08cc0db712655ec0fafb11aa07bedb3aec530de16f21c47a11
PORT=3001
```

| Переменная | Назначение | Что произойдёт при потере / смене |
|---|---|---|
| `APP_PASSWORD` | (1) Пароль для входа в приложение через `/api/auth/login`; (2) **источник ключа AES-256-GCM** для шифрования `data/store.enc` через PBKDF2 (100 000 итераций, SHA-256). | **Потеря = безвозвратная потеря данных.** Расшифровать `store.enc` без пароля невозможно. Смена пароля = `store.enc` перестаёт открываться, нужно экспортировать данные старым паролем → импортировать новым (но импорт тоже требует знания пароля файла). |
| `JWT_SECRET` | Подпись JWT-токенов выдаваемых после логина (срок жизни — 24 ч). | Смена = все активные сессии в браузерах инвалидируются, пользователи логинятся заново. На сами данные не влияет. |
| `PORT` | Локальный порт Express. | Должен совпадать с `proxy_pass` в nginx-конфиге. |

**Резервная копия пароля**: на текущий момент пароль существует **только** в `/opt/orakul/.env`. Если файл потерян и пароль не выписан в менеджер паролей — данные пилота восстановлению не подлежат. **Действие**: сохранить `APP_PASSWORD` в защищённое хранилище (1Password / Bitwarden / KeePass).

**TLS-сертификаты**: отсутствуют (HTTPS не настроен).

---

## 5. Процесс — systemd unit

Файл: `/etc/systemd/system/orakul.service`

```ini
[Unit]
Description=Orakul Pilot App
After=network.target

[Service]
Type=simple
User=orakul
Group=orakul
WorkingDirectory=/opt/orakul
EnvironmentFile=/opt/orakul/.env
ExecStart=/usr/bin/node /opt/orakul/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

- Автозапуск включён (`systemctl enable orakul`).
- При падении процесса systemd рестартует через 5 секунд.
- Логи — в `journalctl -u orakul`.

---

## 6. nginx — reverse proxy

Файл: `/etc/nginx/sites-available/orakul`, симлинк из `sites-enabled/`. Дефолтный nginx-конфиг (`sites-enabled/default`) удалён.

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 20m;     # для импорта зашифрованного store.enc

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Принимает любой `Host` (`server_name _`). HTTPS / TLS не настроен.

---

## 7. Открытые риски

### R1. HTTP без TLS на публичном IP — ~~критичный~~ ЗАКРЫТ 2026-05-22

✅ Решено: получен Let's Encrypt cert для `157-22-174-219.nip.io` (nip.io резолвит IP с дефисами в hostname → сертификат можно выписывать без покупки домена). HTTPS работает на порту 443, HTTP редиректит 301 на HTTPS. Авто-renew через `certbot.timer` (systemd).

```bash
# Проверить срок действия
ssh orakul "certbot certificates 2>&1 | grep -E 'Domain|Expiry'"

# Принудительный renew (обычно не нужен — certbot.timer делает сам)
ssh orakul "certbot renew --quiet"
```

**Исторический контекст:**
- **Что**: пароль (`APP_PASSWORD`) и JWT-токен передаются по сети в открытом виде.
- **Почему важно**: APP_PASSWORD = ключ шифрования всех данных. Перехват = полная компрометация хранилища.
- **Чем смягчить**: либо ограничить доступ только локальной сетью пилотной точки (см. R3), либо привязать домен + выпустить Let's Encrypt сертификат через certbot и редиректить :80 → :443.
- **Триггер закрытия**: до выхода приложения за пределы локальной сети пилота.

### R2. Пароль существует в единственном экземпляре — критичный
- **Что**: `APP_PASSWORD` лежит только в `/opt/orakul/.env`. Резервной копии нет.
- **Почему важно**: пароль = ключ дешифрования `data/store.enc`. Потеря файла `.env` без копии пароля = безвозвратная потеря всех записей пилота.
- **Чем смягчить**: сохранить пароль в менеджер паролей. Дополнительно — регулярный экспорт `data/store.enc` через UI приложения (вкладка «Данные»).
- **Триггер закрытия**: сразу.

### R3. UFW неактивен, порт 3001 биндится на `0.0.0.0` — высокий
- **Что**: `node` слушает `*:3001`, а не `127.0.0.1:3001`. Firewall выключен. То есть API доступен и напрямую, минуя nginx.
- **Почему важно**: лишняя поверхность атаки. Любые будущие nginx-фичи (rate limit, заголовки) обходятся прямым обращением к `:3001`.
- **Чем смягчить (любой из вариантов)**:
  - Включить ufw: `ufw default deny incoming && ufw allow 22 && ufw allow 80 && ufw enable`.
  - Или изменить `server.js`: `app.listen(PORT, '127.0.0.1', ...)` — слушать только loopback.
- **Триггер закрытия**: до начала боевого пилота.

### R4. Бэкапов хранилища нет — высокий
- **Что**: `data/store.enc` существует в одном экземпляре на одном диске.
- **Почему важно**: диск VPS, аппаратный сбой / ошибка администратора = потеря данных пилота.
- **Чем смягчить**: cron-задача, копирующая `data/store.enc` на внешнее хранилище (S3 / другой VPS / локальная машина) ежедневно. Файл уже зашифрован, поэтому передавать его безопасно.
- **Триггер закрытия**: до того как в хранилище попадёт первая боевая запись пилота.

### R5. SSH под `root` по ключу — средний
- **Что**: SSH-доступ открыт под `root`. Парольная аутентификация по умолчанию обычно отключена в provider-образах, но это нужно проверить.
- **Чем смягчить**: завести непривилегированного пользователя с `sudo`, отключить `PermitRootLogin` и парольную аутентификацию в `sshd_config`.
- **Триггер закрытия**: до выхода в прод.

### R6. Зависимости и ОС без процесса обновления — средний
- **Что**: `unattended-upgrades` стандартный для Ubuntu, но npm-зависимости (`express`, `jsonwebtoken` и т.д.) не аудируются.
- **Чем смягчить**: периодический `npm audit` + ручной апгрейд патч-версий.
- **Триггер закрытия**: ежемесячный чек-лист.

---

## 8. Служебные команды

Все команды выполняются с локальной машины (`ssh orakul ...`) либо после `ssh orakul` интерактивно. Алиас `orakul` уже настроен в `~/.ssh/config`.

### 8.1. Подключение

```bash
ssh orakul
```

### 8.2. Управление сервисом

```bash
# Текущий статус (active/failed/inactive, PID, uptime)
systemctl status orakul

# Живые логи (Ctrl+C — выход)
journalctl -u orakul -f

# Последние 200 строк лога без слежения
journalctl -u orakul -n 200 --no-pager

# Рестарт (например, после правки .env)
systemctl restart orakul

# Остановить / запустить
systemctl stop orakul
systemctl start orakul

# Выключить автозапуск (рестарт после ребута не произойдёт)
systemctl disable orakul

# Проверка что сервис слушает порт
ss -tlnp | grep 3001
```

### 8.3. Просмотр и правка секретов

```bash
# Посмотреть текущий .env
cat /opt/orakul/.env

# Отредактировать (например, сменить APP_PASSWORD — см. предупреждение в п. 4)
nano /opt/orakul/.env

# После любой правки .env — обязательный рестарт
systemctl restart orakul
```

> **Внимание**: смена `APP_PASSWORD` делает существующий `data/store.enc` нечитаемым. Перед сменой — экспортировать данные через UI старым паролем.

### 8.4. Управление nginx

```bash
# Проверить синтаксис конфига
nginx -t

# Применить изменения без полного рестарта (graceful reload)
systemctl reload nginx

# Полный рестарт (если reload не помогает)
systemctl restart nginx

# Логи nginx
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### 8.5. Обновление кода (релиз)

С локальной машины из корня репозитория. **Предварительно собрать клиент локально** (`npm run build`) — на проде сборку не делаем, чтобы избежать установки dev-зависимостей и тянуть xlsx с CDN при каждом релизе.

```bash
# 0. ВСЕГДА сначала бэкап (см. §8.6)
ssh orakul "cp /opt/orakul/data/store.enc \
  /opt/orakul/data/store.enc.backup-pre-deploy-$(date +%Y%m%d-%H%M%S)"

# 1. Локально пересобрать клиент
cd ~/Git/Mozarella/Orakul/app && npm run build

# 2. Залить обновлённый код. БЕЗ --delete: на проде есть .env / data / node_modules,
#    которые в локальном чекауте отсутствуют. Лишние файлы dist остаются — disk only.
rsync -avz \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='client/node_modules' \
  --exclude='client/src' \
  --exclude='Dockerfile' \
  --exclude='docker-compose*' \
  --exclude='.dockerignore' \
  --exclude='*.log' \
  --exclude='.githooks' \
  ./ orakul:/opt/orakul/

# 3. Восстановить владельца + рестарт.
#    npm install обычно не нужен — все runtime-зависимости client-side (xlsx)
#    собраны в dist; server-side набор cors/dotenv/express/jsonwebtoken не менялся.
ssh orakul "set -e
  chown -R orakul:orakul /opt/orakul/server.js /opt/orakul/seed-demo.js \
    /opt/orakul/integrations /opt/orakul/client /opt/orakul/package.json \
    /opt/orakul/package-lock.json
  systemctl restart orakul.service
  sleep 2
  systemctl is-active orakul.service"
```

#### Что произойдёт при первом релизе с multi-venue

При старте сервиса автоматически запустится миграция:

```
✅  Multi-venue migration applied (default venue: «Точка 1»)
```

Она:
- создаст запись `venue` с `isDefault: true` (если ещё не существует);
- проставит `venueId` всем существующим записям типов `product`, `dish`, `stop`, `stock_entry`, `order`, `revenue_entry`, `fixed_expense`, `telegram_chat`.

Миграция **идемпотентна** — повторные запуски ничего не делают.

#### Зависимости

- **Server-side прод-deps:** не изменились (cors, dotenv, express, jsonwebtoken) — `npm install` пропускаем.
- **Client-side:** `xlsx@0.20.3` тянется с CDN SheetJS (`https://cdn.sheetjs.com/...`). Прод нужен исходящий доступ при `npm install`. Локальная сборка решает: dist уже содержит xlsx чанком.

#### Если нужно поднять с нуля (fresh server)

```bash
ssh orakul "set -e
  cd /opt/orakul
  npm install --omit=dev --no-fund --no-audit
  cd client && npm install --no-fund --no-audit
  cd /opt/orakul && chown -R orakul:orakul ."
```

После этого один раз: `systemctl enable --now orakul.service`.

### 8.6. Бэкап / восстановление хранилища

```bash
# Снять бэкап на локальную машину (с таймстампом)
scp orakul:/opt/orakul/data/store.enc \
    ~/orakul-backups/store-$(date +%Y%m%d-%H%M%S).enc

# Восстановить из бэкапа (приложение должно быть остановлено)
ssh orakul 'systemctl stop orakul'
scp ~/orakul-backups/store-XXXXXXXX.enc orakul:/opt/orakul/data/store.enc
ssh orakul 'chown orakul:orakul /opt/orakul/data/store.enc && systemctl start orakul'
```

Внутри приложения тот же бэкап доступен через UI: вкладка «Данные» → «Экспортировать».

### 8.7. Диагностика

```bash
# Health-check API (вернёт 401 без токена — это норма)
curl -i http://157.22.174.219/api/records

# Логин (вернёт JWT)
curl -X POST -H 'Content-Type: application/json' \
  -d '{"password":"...APP_PASSWORD..."}' \
  http://157.22.174.219/api/auth/login

# Использование диска
ssh orakul 'df -h / && du -sh /opt/orakul'

# Использование памяти процессом
ssh orakul 'systemctl status orakul | grep Memory'

# Кто слушает какие порты
ssh orakul 'ss -tlnp'
```

### 8.8. Полная переустановка с нуля (disaster recovery)

Если сервер потерян, на новой машине Ubuntu 24.04:

1. Установить Node.js 20: `curl -fsSL https://deb.nodesource.com/setup_20.x | bash && apt-get install -y nodejs nginx`.
2. Завести пользователя: `useradd --system --home /opt/orakul --shell /usr/sbin/nologin orakul`.
3. Сделать `mkdir -p /opt/orakul/data && chown -R orakul:orakul /opt/orakul`.
4. Залить код (см. 8.5, шаг 1).
5. Восстановить `.env` **с тем же `APP_PASSWORD`**, что и был (иначе старый `store.enc` не откроется).
6. Создать `/etc/systemd/system/orakul.service` (см. п. 5).
7. Создать `/etc/nginx/sites-available/orakul` (см. п. 6), `ln -sf` в `sites-enabled`, `rm sites-enabled/default`.
8. `systemctl daemon-reload && systemctl enable --now orakul && systemctl reload nginx`.
9. Положить бэкап `store.enc` в `/opt/orakul/data/`, `chown orakul:orakul`.

---

## 9. История изменений

| Дата | Изменение | Автор |
|---|---|---|
| 2026-05-19 | Первичное развёртывание: Node.js 20, systemd, nginx :80 → :3001, доступ по HTTP на `157.22.174.219` | Daniil Akhramiuk |
