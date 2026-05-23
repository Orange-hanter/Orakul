#!/bin/sh
# Demo container entrypoint.
#
# Behaviour:
#   - On every start: if data/store.enc is missing or DEMO_RESEED=1, wipe
#     and re-seed via seed-demo.js.
#   - Then exec the app as PID 1 (via tini).
#
# This keeps the demo always-fresh: just `docker compose restart orakul-demo`
# (or set a daily cron via a sidecar) and visitors land on a clean synthetic
# state, with no risk of one visitor's experiments persisting for the next.

set -eu

: "${APP_PASSWORD:?APP_PASSWORD must be set for demo}"
: "${PORT:=3001}"

DATA="/app/data"
STORE="$DATA/store.enc"

reseed_needed=0
if [ "${DEMO_RESEED:-0}" = "1" ]; then
  echo "demo-entrypoint: DEMO_RESEED=1 — wiping data/ before seed"
  rm -f "$STORE" "$DATA"/audit.jsonl "$DATA"/store.enc.bak-*
  reseed_needed=1
elif [ ! -f "$STORE" ]; then
  echo "demo-entrypoint: no store.enc yet — first-boot seed"
  reseed_needed=1
fi

if [ "$reseed_needed" = "1" ]; then
  # Start the server in the background, run the seed against itself,
  # then stop it. seed-demo.js talks to the running server over HTTP.
  node server.js &
  server_pid=$!
  # Wait for /api/health to respond.
  i=0
  until wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; do
    i=$((i+1))
    if [ $i -gt 30 ]; then
      echo "demo-entrypoint: server did not become healthy in time" >&2
      kill $server_pid 2>/dev/null || true
      exit 1
    fi
    sleep 0.5
  done
  echo "demo-entrypoint: server up, seeding synthetic data…"
  SEED_URL="http://127.0.0.1:${PORT}" node seed-demo.js
  echo "demo-entrypoint: seed complete, stopping bootstrap server…"
  kill $server_pid 2>/dev/null || true
  wait $server_pid 2>/dev/null || true
fi

exec node server.js
