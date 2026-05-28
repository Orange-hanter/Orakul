"""
Lightweight SQLite wrapper for Orakul ETL.

- Создаёт таблицы под модель Orakul (venue, product, stock_entry, supplier,
  supplier_item, order, dish, revenue_entry, ...)
- Upsert = INSERT OR REPLACE
- Get by id / type
- List all by type
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from config import config

logger = logging.getLogger(__name__)

# ── Schema ──────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS orakul_records (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    venue_id    TEXT,
    data        TEXT NOT NULL,  -- JSON
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_type ON orakul_records(type);
CREATE INDEX IF NOT EXISTS idx_venue ON orakul_records(venue_id);
CREATE INDEX IF NOT EXISTS idx_updated ON orakul_records(updated_at);

CREATE TABLE IF NOT EXISTS etl_sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,    -- 'quickresto'
    entity      TEXT NOT NULL,    -- 'product', 'dish', ...
    action      TEXT NOT NULL,    -- 'fetch', 'transform', 'upsert'
    count       INTEGER DEFAULT 0,
    duration_ms INTEGER,
    error       TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
"""

# ── DB class ────────────────────────────────────────────────────

class OrakulDB:
    """SQLite DB for Orakul records."""

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path or config.SQLITE_PATH)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    # ── Connection ─────────────────────────────────────────────

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self):
        conn = self._conn()
        conn.executescript(SCHEMA)
        conn.commit()
        conn.close()

    # ── CRUD ────────────────────────────────────────────────────

    def upsert(self, record: dict) -> None:
        """INSERT OR REPLACE одной записи."""
        conn = self._conn()
        conn.execute(
            """
            INSERT INTO orakul_records (id, type, venue_id, data, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                type=excluded.type,
                venue_id=excluded.venue_id,
                data=excluded.data,
                updated_at=excluded.updated_at
            """,
            (
                record["id"],
                record.get("type", ""),
                record.get("venueId", record.get("venue_id", "")),
                json.dumps(record, ensure_ascii=False, default=str),
                datetime.utcnow().isoformat(),
            )
        )
        conn.commit()
        conn.close()

    def upsert_many(self, records: list[dict]) -> int:
        """Batch upsert. Returns count."""
        if not records:
            return 0
        conn = self._conn()
        now = datetime.utcnow().isoformat()
        rows = [
            (
                r["id"],
                r.get("type", ""),
                r.get("venueId", r.get("venue_id", "")),
                json.dumps(r, ensure_ascii=False, default=str),
                now,
            )
            for r in records
        ]
        conn.executemany(
            """
            INSERT INTO orakul_records (id, type, venue_id, data, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                type=excluded.type,
                venue_id=excluded.venue_id,
                data=excluded.data,
                updated_at=excluded.updated_at
            """,
            rows,
        )
        conn.commit()
        count = conn.total_changes
        conn.close()
        return count

    def get(self, record_id: str) -> dict | None:
        conn = self._conn()
        row = conn.execute(
            "SELECT data FROM orakul_records WHERE id = ?", (record_id,)
        ).fetchone()
        conn.close()
        if row:
            return json.loads(row["data"])
        return None

    def list_by_type(self, record_type: str, venue_id: str | None = None) -> list[dict]:
        conn = self._conn()
        if venue_id:
            rows = conn.execute(
                "SELECT data FROM orakul_records WHERE type = ? AND venue_id = ?",
                (record_type, venue_id)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT data FROM orakul_records WHERE type = ?",
                (record_type,)
            ).fetchall()
        conn.close()
        return [json.loads(r["data"]) for r in rows]

    def count_by_type(self, record_type: str, venue_id: str | None = None) -> int:
        conn = self._conn()
        if venue_id:
            row = conn.execute(
                "SELECT COUNT(*) FROM orakul_records WHERE type = ? AND venue_id = ?",
                (record_type, venue_id)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) FROM orakul_records WHERE type = ?",
                (record_type,)
            ).fetchone()
        conn.close()
        return row[0]

    # ── Sync log ────────────────────────────────────────────────

    def log_sync(
        self,
        source: str,
        entity: str,
        action: str,
        count: int = 0,
        duration_ms: int = 0,
        error: str | None = None,
    ) -> None:
        conn = self._conn()
        conn.execute(
            """
            INSERT INTO etl_sync_log (source, entity, action, count, duration_ms, error)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (source, entity, action, count, duration_ms, error),
        )
        conn.commit()
        conn.close()

    def get_sync_log(self, limit: int = 50) -> list[dict]:
        conn = self._conn()
        rows = conn.execute(
            """
            SELECT * FROM etl_sync_log
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,)
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]


if __name__ == "__main__":
    db = OrakulDB()
    print(f"DB: {db.path} — created/connected")
    print(f"Tables: orakul_records, etl_sync_log")
