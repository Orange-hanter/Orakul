"""
DB layer — factory + legacy OrakulDB wrapper.

Usage:
    from db import create_db, OrakulDB

    # New dual-backend
    db = create_db('sqlite')          # SqliteBackend (default)
    db = create_db('postgres')       # PostgresBackend (requires ETL_POSTGRES_DSN)

    # Legacy compat
    db_legacy = OrakulDB()           # wraps SqliteBackend internally
"""

from __future__ import annotations

import json

from db_base import DbConnection


def create_db(backend: str = 'sqlite', **kwargs) -> DbConnection:
    """Factory: create a DbConnection backend."""
    if backend == 'sqlite':
        from db_sqlite import SqliteBackend
        return SqliteBackend(**kwargs)
    if backend == 'postgres':
        from db_postgres import PostgresBackend
        return PostgresBackend(**kwargs)
    raise ValueError(f"Unknown DB backend: {backend}. Available: ['sqlite', 'postgres']")


# ── Legacy OrakulDB (wraps SqliteBackend for compat) ─────────────

class OrakulDB:
    """Legacy SQLite DB — thin wrapper around SqliteBackend.

    Preserves old API: upsert(), upsert_many(), get(), list_by_type(),
    count_by_type(), log_sync(), get_sync_log().

    Under the hood uses SqliteBackend with raw_imports + staging + core.
    """

    def __init__(self, path: str | None = None):
        from db_sqlite import SqliteBackend
        self._backend = SqliteBackend(path)

    @property
    def path(self):
        return self._backend._path

    # ── CRUD (legacy -> via upsert_legacy) ─────────────────────────

    def upsert(self, record: dict) -> None:
        """INSERT OR REPLACE одной записи (legacy table)."""
        self._backend.upsert_legacy(record)

    def upsert_many(self, records: list[dict]) -> int:
        """Batch upsert (legacy table). Returns count."""
        return self._backend.upsert_many_legacy(records)

    def get(self, record_id: str) -> dict | None:
        conn = self._backend._get_conn()
        row = conn.execute(
            "SELECT data FROM orakul_records WHERE id = ?", (record_id,)
        ).fetchone()
        return ({"id": record_id, **json.loads(row["data"])} if row else None)

    def list_by_type(self, record_type: str, venue_id: str | None = None) -> list[dict]:
        conn = self._backend._get_conn()
        if venue_id:
            rows = conn.execute(
                "SELECT id, data FROM orakul_records WHERE type = ? AND venue_id = ?",
                (record_type, venue_id)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, data FROM orakul_records WHERE type = ?",
                (record_type,)
            ).fetchall()
        return [{"id": r["id"], **json.loads(r["data"])} for r in rows]

    def count_by_type(self, record_type: str, venue_id: str | None = None) -> int:
        conn = self._backend._get_conn()
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
        return row[0]

    # ── Sync log (legacy) ───────────────────────────────────────

    def log_sync(
        self,
        source: str,
        entity: str,
        action: str,
        count: int = 0,
        duration_ms: int = 0,
        error: str | None = None,
    ) -> None:
        return self._backend.log_run(entity, action, count=count,
                                      duration_ms=duration_ms, error=error)

    def get_sync_log(self, limit: int = 50) -> list[dict]:
        conn = self._backend._get_conn()
        rows = conn.execute(
            "SELECT * FROM etl_sync_log ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    # ── New API passthrough ─────────────────────────────────────

    def begin_run(self) -> str:
        return self._backend.begin_run()

    def commit_run(self, run_id: str, status: str, records: int = 0, error: str | None = None) -> None:
        self._backend.commit_run(run_id, status, records=records, error=error)

    def insert_raw(self, entity: str, records: list[dict], run_id: str, venue_id: str | None = None) -> int:
        return self._backend.insert_raw(entity, records, run_id, venue_id)

    def has_raw_data(self, entity: str) -> bool:
        return self._backend.has_raw_data(entity)

    def upsert_staging(self, table_name: str, records: list[dict]) -> int:
        return self._backend.upsert_staging(table_name, records)

    def merge_core(self, table_name: str, records: list[dict]) -> int:
        return self._backend.merge_core(table_name, records)

    def get_watermark(self, entity: str) -> int:
        return self._backend.get_watermark(entity)

    def set_watermark(self, entity: str, version: int) -> None:
        return self._backend.set_watermark(entity, version)

    def get_stats(self) -> dict:
        return self._backend.get_stats()

    def close(self) -> None:
        self._backend.close()


if __name__ == "__main__":
    db = OrakulDB()
    print(f"DB: {db.path} — connected")
    print(f"New run id: {db.begin_run()}")
