---
Документ: Pilot App — Deployment Runbook
Версия: 1.1
Дата: 2026-05-22
Статус: Действующий
Владелец: Daniil Akhramiuk
Связанные документы: [MVP Architecture](00-mvp-architecture.md), [Pilot App README](../../app/README.md)
---

# Pilot App — Deployment Runbook

Описание развёрнутого окружения пилотного приложения Orakul (планшетный сборщик данных), служебные команды и открытые риски. Документ обновляется при каждом изменении инфраструктуры.

---

## 1. Что развёрнуто

Приложение `app/` из этого репозитория — Node.js + Express сервер с React/Vite клиентом и зашифрованным файловым хранилищем (`data/store.enc`, AES-256-GCM, ключ = `APP_PASSWORD`). С 2026-05-22 на корневом домене дополнительно раздаётся маркетинговый лендинг.

| Слой | Технология | Где |
|---|---|---|
| Reverse proxy / TLS | nginx 1.24 (Ubuntu) + Let's Encrypt | `:443`/`:80` → роутинг по домену (см. §6) |
| Лендинг | Статические HTML/CSS/JS | `/var/www/orakul-landing/`, раздаётся nginx напрямую |
| Приложение | Node.js 20 LTS + Express | systemd unit `orakul.service`, порт `3001` |
| Клиент | React 18 + Vite (статика) | `/opt/orakul/client/dist`, раздаётся самим Express |
| Хранилище | Зашифрованный файл | `/opt/orakul/data/store.enc` |
| ОС / хост | Ubuntu 24.04 LTS | hostname `106316.com`, IP `157.22.174.219` |

Сервер используется **только** под Orakul Pilot (других сервисов на нём не запущено).

---

## 2. Доступ и сеть

| Параметр | Значение |
|---|---|
| Лендинг (публичный) | `https://157-22-174-219.nip.io/` |
| Приложение (пилот) | `https://app.157-22-174-219.nip.io/` |
| SSH-алиас | `orakul` (см. `~/.ssh/config` на машине разработчика) |
| SSH-ключ | `~/.ssh/orakul_deploy` (приватный, на машине разработчика) |
| SSH-пользователь | `root` |
| Открытые порты | `22` (SSH), `80` (HTTP → redirect), `443` (HTTPS через nginx) |
| Firewall (ufw) | **неактивен** (см. п. 7. Риски) |
| TLS / HTTPS | Let's Encrypt, cert для `157-22-174-219.nip.io` + `app.157-22-174-219.nip.io`, истекает 2026-08-20, авто-renew через `certbot.timer` |

> Внутренний порт `3001` слушается на `0.0.0.0` процессом node — потенциально доступен снаружи в обход nginx (см. п. 7).

> **Важно**: старый URL `http://157.22.174.219/` продолжает работать (nginx принимает любой Host), но теперь отдаёт лендинг, а не приложение. Для пилотных пользователей актуальная ссылка — `https://app.157-22-174-219.nip.io/`.

---

## 3. Файловая структура на сервере

```
/var/www/orakul-landing/   # маркетинговый лендинг (статика)
├── index.html             # исходник: landing/index.html в репозитории
├── styles.css             # исходник: landing/styles.css
└── script.js              # исходник: landing/script.js
                           # Владелец: www-data:www-data, chmod 644

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

**TLS-сертификаты**: хранятся в `/etc/letsencrypt/live/157-22-174-219.nip.io/`. Сам сертификат покрывает оба домена (SAN: `157-22-174-219.nip.io`, `app.157-22-174-219.nip.io`). Авто-renew — `certbot.timer` (systemd). Вмешательства не требует.

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

Активный файл конфигурации: `/etc/nginx/sites-enabled/orakul` (не симлинк — certbot модифицировал его напрямую при выписке сертификата). Файл `/etc/nginx/sites-available/orakul` содержит исходную HTTP-версию и является историческим артефактом — **не используется**.

Три server-блока:

```nginx
# ============================================================
#  157-22-174-219.nip.io       → static landing
#  app.157-22-174-219.nip.io   → Orakul pilot app (Node :3001)
# ============================================================

# --- Лендинг на корневом домене ---
server {
    server_name 157-22-174-219.nip.io;

    root /var/www/orakul-landing;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # Агрессивное кэширование статики (имена файлов меняются при деплое)
    location ~* \.(css|js|svg|woff2?|ico|png|jpg|webp)$ {
        expires 7d;
        add_header Cache-Control 'public, immutable';
    }

    # ACME-challenge (для будущих renew через webroot)
    location /.well-known/acme-challenge/ {
        root /var/www/orakul-landing;
    }

    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl;                  # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/157-22-174-219.nip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/157-22-174-219.nip.io/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# --- Пилотное приложение на поддомене ---
server {
    server_name app.157-22-174-219.nip.io;

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

    listen [::]:443 ssl; # managed by Certbot
    listen 443 ssl;      # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/157-22-174-219.nip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/157-22-174-219.nip.io/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# --- HTTP: ACME + redirect на HTTPS ---
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 157-22-174-219.nip.io app.157-22-174-219.nip.io _;

    location /.well-known/acme-challenge/ {
        root /var/www/orakul-landing;
    }

    location / {
        if ($host = 157-22-174-219.nip.io)     { return 301 https://$host$request_uri; }
        if ($host = app.157-22-174-219.nip.io) { return 301 https://$host$request_uri; }
        return 404;
    }
}
```

---

## 7. Открытые риски

### R1. HTTP без TLS на публичном IP — ~~критичный~~ ЗАКРЫТ 2026-05-22

✅ Решено: выпущен Let's Encrypt cert через certbot, SAN: `157-22-174-219.nip.io` + `app.157-22-174-219.nip.io`. HTTPS работает на порту 443, HTTP редиректит 301. Авто-renew через `certbot.timer` (systemd). Webroot для renew — `/var/www/orakul-landing/.well-known/acme-challenge/`.

```bash
# Проверить срок действия и покрываемые домены
ssh orakul "certbot certificates 2>&1 | grep -E 'Certificate Name|Domain|Expiry'"

# Принудительный renew (обычно не нужен — certbot.timer делает сам)
ssh orakul "certbot renew --quiet"

# Проверить SANs сертификата через openssl
echo | openssl s_client -connect 157.22.174.219:443 -servername 157-22-174-219.nip.io 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
```

**Исторический контекст:**
- **Что**: пароль (`APP_PASSWORD`) и JWT-токен передавались по сети в открытом виде.
- **Почему важно**: APP_PASSWORD = ключ шифрования всех данных. Перехват = полная компрометация хранилища.
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

#### Автоматический nightly бэкап (O04)

С коммита `Sprint 3 / O04` репозиторий содержит `ops/backup-store.sh` +
systemd unit pair. Запуск ежедневно в 03:30 UTC, retention = 7 дней.

**Установка на сервере (one-shot):**

```bash
# 1. Кладём скрипт и unit-файлы из репо
sudo install -o orakul -g orakul -m 0755 /opt/orakul/ops/backup-store.sh /opt/orakul/ops/backup-store.sh
sudo install -o root   -g root   -m 0644 /opt/orakul/ops/orakul-backup.service /etc/systemd/system/
sudo install -o root   -g root   -m 0644 /opt/orakul/ops/orakul-backup.timer   /etc/systemd/system/

# 2. Создаём целевую директорию
sudo mkdir -p /var/backups/orakul
sudo chown orakul:orakul /var/backups/orakul
sudo chmod 750 /var/backups/orakul

# 3. Перезагружаем systemd и включаем таймер
sudo systemctl daemon-reload
sudo systemctl enable --now orakul-backup.timer

# 4. Проверка
sudo systemctl list-timers orakul-backup.timer
sudo systemctl start orakul-backup.service        # пробный запуск
sudo journalctl -u orakul-backup.service -n 20
ls -lh /var/backups/orakul
```

Конфигурация переопределяется через переменные `ORAKUL_DATA_DIR` /
`ORAKUL_BACKUP_DIR` / `ORAKUL_BACKUP_KEEP` в `orakul-backup.service` (или
override-файле).

#### Ручной бэкап / восстановление

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

### 8.7. Мониторинг (O05)

#### Healthcheck endpoint

`GET /api/health` — публичный (без auth), возвращает 200 + JSON если процесс
жив и data-директория доступна, 503 при проблеме. Подходит для:

- **Uptimerobot** (free tier): https://uptimerobot.com → Add Monitor → HTTPS →
  URL `https://app.157-22-174-219.nip.io/api/health` → interval 5 мин →
  alert при двух fail подряд (≈ 10 мин даунтайма).
- **Healthchecks.io**: для проверки nightly-backup можно добавить ping-URL
  в конец `ops/backup-store.sh`:
  `curl -fsS --retry 3 https://hc-ping.com/<uuid> > /dev/null` (опционально).
- **Локальный smoke-test**: `curl -fsS https://app.157-22-174-219.nip.io/api/health`
  должен вернуть `{"status":"ok",...}`.

#### Что показывает healthcheck

| Поле | Назначение |
|------|------------|
| `status` | `ok` / `error` |
| `uptimeSec` | сколько секунд с момента старта процесса |
| `version` | значение `ORAKUL_VERSION` env (если задано), иначе `dev` |
| `ts` | server time в ms |

#### SLA-цель пилотного периода

| Метрика | Цель | Как замеряется |
|---------|------|----------------|
| Uptime | ≥ 99 % за месяц | Uptimerobot history |
| Бэкап выполняется ежедневно | да | `journalctl -u orakul-backup.service` + наличие свежего файла в `/var/backups/orakul` |
| Восстановление из бэкапа | ≤ 15 мин | Один раз отработать вручную (см. §8.6) |

### 8.8. Диагностика

```bash
# Лендинг отдаёт 200
curl -sI https://157-22-174-219.nip.io/ | head -5

# Приложение отдаёт 200
curl -sI https://app.157-22-174-219.nip.io/ | head -5

# Health-check API (вернёт 401 без токена — это норма)
curl -i https://app.157-22-174-219.nip.io/api/records

# Логин (вернёт JWT)
curl -X POST -H 'Content-Type: application/json' \
  -d '{"password":"...APP_PASSWORD..."}' \
  https://app.157-22-174-219.nip.io/api/auth/login

# HTTP → HTTPS redirect (должен вернуть 301)
curl -sI http://157-22-174-219.nip.io/ | grep -E 'HTTP|location'

# Использование диска
ssh orakul 'df -h / && du -sh /opt/orakul /var/www/orakul-landing'

# Использование памяти процессом
ssh orakul 'systemctl status orakul | grep Memory'

# Кто слушает какие порты
ssh orakul 'ss -tlnp'
```

### 8.9. Обновление лендинга

Лендинг — три статических файла в `/var/www/orakul-landing/`. Источник — папка `landing/` в репозитории.

```bash
# С локальной машины из корня репозитория
rsync -avz \
  landing/index.html \
  landing/styles.css \
  landing/script.js \
  orakul:/var/www/orakul-landing/

# Восстановить владельца (если rsync залил под root)
ssh orakul "chown www-data:www-data /var/www/orakul-landing/*"
```

Перезапуск nginx не нужен — nginx читает статические файлы при каждом запросе.

### 8.10. Полная переустановка с нуля (disaster recovery)

Если сервер потерян, на новой машине Ubuntu 24.04:

1. Установить Node.js 20 и nginx: `curl -fsSL https://deb.nodesource.com/setup_20.x | bash && apt-get install -y nodejs nginx certbot python3-certbot-nginx`.
2. Завести пользователя: `useradd --system --home /opt/orakul --shell /usr/sbin/nologin orakul`.
3. Создать директории: `mkdir -p /opt/orakul/data /var/www/orakul-landing && chown -R orakul:orakul /opt/orakul && chown -R www-data:www-data /var/www/orakul-landing`.
4. Залить код приложения (см. §8.5, шаг 1).
5. Залить файлы лендинга (см. §8.8).
6. Восстановить `.env` **с тем же `APP_PASSWORD`**, что и был (иначе старый `store.enc` не откроется).
7. Создать `/etc/systemd/system/orakul.service` (см. §5).
8. Скопировать nginx-конфиг (см. §6) в `/etc/nginx/sites-enabled/orakul`. Удалить default: `rm -f /etc/nginx/sites-enabled/default`.
9. `nginx -t && systemctl daemon-reload && systemctl enable --now orakul && systemctl reload nginx`.
10. Выпустить TLS-сертификат:
    ```bash
    certbot certonly --webroot -w /var/www/orakul-landing \
      -d 157-22-174-219.nip.io -d app.157-22-174-219.nip.io \
      --non-interactive --agree-tos --email admin@157-22-174-219.nip.io
    systemctl reload nginx
    ```
11. Положить бэкап `store.enc` в `/opt/orakul/data/`, `chown orakul:orakul`.

---

## 9. История изменений

| Дата | Изменение | Автор |
|---|---|---|
| 2026-05-19 | Первичное развёртывание: Node.js 20, systemd, nginx :80 → :3001, доступ по HTTP на `157.22.174.219` | Daniil Akhramiuk |
| 2026-05-22 | TLS: Let's Encrypt cert для `157-22-174-219.nip.io`, HTTP → 301 HTTPS | Daniil Akhramiuk |
| 2026-05-22 | Лендинг: загружен в `/var/www/orakul-landing/`; cert расширен на `app.157-22-174-219.nip.io`; nginx разбит на два HTTPS server-блока — лендинг на корне, приложение на поддомене `app.*` | Daniil Akhramiuk |
