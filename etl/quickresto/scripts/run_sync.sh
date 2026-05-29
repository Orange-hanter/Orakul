#!/usr/bin/env bash
# QuickResto ETL sync — cron wrapper
# Runs run_sync.py with proper venv + PYTHONPATH
#
# Usage (manual):
#   cd ~/Git/_my/Mozarella/Orakul/etl/quickresto && scripts/run_sync.sh
#
# Cron (every 15 min):
#   */15 * * * * /Users/dakh/Git/_my/Mozarella/Orakul/etl/quickresto/scripts/run_sync.sh

set -euo pipefail

PROJECT="${PROJECT:-/Users/dakh/Git/_my/Mozarella/Orakul}"
ETL_DIR="$PROJECT/etl/quickresto"
VENV_PYTHON="$PROJECT/venv/bin/python"

# Activate project root for imports
export PYTHONPATH="$ETL_DIR/src"
export ETL_SYNC_LIMIT="${ETL_SYNC_LIMIT:-0}"

# Load .env if present (cron doesn't inherit .env from shell)
if [ -f "$ETL_DIR/.env" ]; then
    # Extract KEY=VALUE lines, export them safely
    while IFS='=' read -r key value; do
        [ -z "$key" ] && continue
        case "$key" in \#*) continue ;; esac
        export "$key=${value%%#*}"
    done < "$ETL_DIR/.env"
fi

LOGFILE="$ETL_DIR/data/logs/sync_cron_$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$ETL_DIR/data/logs"

exec >>"$LOGFILE" 2>>"$LOGFILE"

echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ETL sync started ==="
echo "Working dir: $ETL_DIR"
echo "Python: $($VENV_PYTHON --version)"
echo "PYTHONPATH: $PYTHONPATH"

if ! "$VENV_PYTHON" -m src.run_sync; then
    EXIT_CODE=$?
    echo "=== ETL sync FAILED with exit code $EXIT_CODE ==="
    # TODO: send alert (Telegram / email) on repeated failures
    exit $EXIT_CODE
fi

echo "=== ETL sync completed ==="
