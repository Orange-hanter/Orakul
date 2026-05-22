#!/usr/bin/env bash
# O04 — Nightly backup of Orakul store.enc + audit.jsonl with 7-day retention.
#
# Должен быть запущен от имени пользователя `orakul` (см. orakul-backup.service).
# Идемпотентен: повторный запуск создаёт новый файл с timestamp.
#
# Конфигурируется через переменные окружения:
#   ORAKUL_DATA_DIR    — где лежит store.enc / audit.jsonl  (default: /opt/orakul/data)
#   ORAKUL_BACKUP_DIR  — куда складывать бэкапы              (default: /var/backups/orakul)
#   ORAKUL_BACKUP_KEEP — сколько дней хранить                (default: 7)

set -euo pipefail

DATA_DIR="${ORAKUL_DATA_DIR:-/opt/orakul/data}"
BACKUP_DIR="${ORAKUL_BACKUP_DIR:-/var/backups/orakul}"
KEEP_DAYS="${ORAKUL_BACKUP_KEEP:-7}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DATA_DIR/store.enc" ]]; then
  echo "backup: $DATA_DIR/store.enc not found — skip" >&2
  exit 0
fi

# Atomic copy: cp в tmp + mv. Защита от частичного файла при чтении.
TMP="$BACKUP_DIR/.store-$STAMP.enc.partial"
DEST="$BACKUP_DIR/store-$STAMP.enc"
cp "$DATA_DIR/store.enc" "$TMP"
mv "$TMP" "$DEST"
chmod 600 "$DEST"

# Audit лог (если есть)
if [[ -f "$DATA_DIR/audit.jsonl" ]]; then
  AUDIT_DEST="$BACKUP_DIR/audit-$STAMP.jsonl"
  cp "$DATA_DIR/audit.jsonl" "$AUDIT_DEST"
  chmod 600 "$AUDIT_DEST"
fi

# Retention: удаляем файлы старше KEEP_DAYS дней.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'store-*.enc' -o -name 'audit-*.jsonl' \) -mtime "+$KEEP_DAYS" -delete

# Подсчёт текущего размера бэкап-директории для диагностики
TOTAL="$(du -sh "$BACKUP_DIR" | cut -f1)"
echo "backup: ok — $DEST ($(du -sh "$DEST" | cut -f1)); retention=${KEEP_DAYS}d; total=${TOTAL}"
