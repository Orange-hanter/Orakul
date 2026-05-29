"""PostgreSQL backend stub for Orakul ETL.

Implements DbConnection interface. Currently a skeleton — will be backfilled
when production PostgreSQL is provisioned.

The stub prevents import errors in db.py::create_db('postgres').
"""

from __future__ import annotations

import logging

from db_base import DbConnection

logger = logging.getLogger(__name__)


class PostgresBackend(DbConnection):
    """PostgreSQL backend — not yet implemented."""

    def __init__(self, dsn: str | None = None):
        self._dsn = dsn
        raise NotImplementedError(
            "PostgreSQL backend is not yet implemented. "
            "Use backend='sqlite' (default) or set ETL_POSTGRES_DSN after provisioning."
        )

    # ── Run lifecycle ────────────────────────────────────────────
    def begin_run(self) -> str:
        ...

    def commit_run(self, run_id: str, status: str, records: int = 0, error: str | None = None) -> None:
        ...

    # ── Raw imports ──────────────────────────────────────────────
    def insert_raw(self, entity: str, records: list[dict], run_id: str, venue_id: str | None = None) -> int:
        ...

    def count_raw(self, entity: str, run_id: str | None = None) -> int:
        ...

    # ── Staging ──────────────────────────────────────────────────
    def upsert_staging(self, table_name: str, records: list[dict]) -> int:
        ...

    # ── Core ─────────────────────────────────────────────────────
    def merge_core(self, table_name: str, records: list[dict]) -> int:
        ...

    # ── Watermark ────────────────────────────────────────────────
    def get_watermark(self, entity: str) -> int:
        ...

    def set_watermark(self, entity: str, version: int) -> None:
        ...

    # ── Sync log / errors ────────────────────────────────────────
    def log_run(self, entity: str, action: str, count: int = 0,
                duration_ms: int = 0, error: str | None = None) -> None:
        ...

    def get_last_run(self, entity: str | None = None) -> dict | None:
        ...

    def log_error(self, run_id: str, entity: str, source_id: str | None,
                  error: str) -> None:
        ...

    def get_errors(self, limit: int = 10) -> list[dict]:
        ...

    # ── Transaction helpers ──────────────────────────────────────
    def begin(self) -> None:
        ...

    def commit(self) -> None:
        ...

    def rollback(self) -> None:
        ...

    # ── Health ───────────────────────────────────────────────────
    def get_stats(self) -> dict:
        ...

    def close(self) -> None:
        ...
