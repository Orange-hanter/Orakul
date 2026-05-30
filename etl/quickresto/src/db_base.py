"""Abstract DB interface for Orakul ETL.

Dual-backend: SQLite (default/MVP) and PostgreSQL (production).

Typical usage:
    db = create_db('sqlite', sqlite_path='/tmp/orakul.db')
    run_id = db.begin_run()
    count = db.insert_raw('product', items, run_id, venue_id='vt786')
    db.upsert_staging('products', transformed)
    db.commit_run(run_id, 'success', records=count)
    db.close()
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class DbConnection(ABC):
    """Abstract DB backend."""

    # ── Run lifecycle ────────────────────────────────────────────

    @abstractmethod
    def begin_run(self) -> str:
        """Start a new ETL run. Returns run_id."""
        ...

    @abstractmethod
    def commit_run(self, run_id: str, status: str, records: int = 0, error: str | None = None) -> None:
        """Finalize a run (success / partial / failed)."""
        ...

    # ── Raw imports ──────────────────────────────────────────────

    @abstractmethod
    def insert_raw(self, entity: str, records: list[dict], run_id: str, venue_id: str | None = None) -> int:
        """Insert raw JSON records into raw_imports. Returns count inserted."""
        ...

    @abstractmethod
    def count_raw(self, entity: str, run_id: str | None = None) -> int:
        """Count raw records."""
        ...

    @abstractmethod
    def has_raw_data(self, entity: str) -> bool:
        """Check if any raw data exists for entity."""
        ...

    # ── Staging ──────────────────────────────────────────────────

    @abstractmethod
    def upsert_staging(self, table_name: str, records: list[dict]) -> int:
        """Upsert transformed records into staging table."""
        ...

    # ── Core ─────────────────────────────────────────────────────

    @abstractmethod
    def merge_core(self, table_name: str, records: list[dict]) -> int:
        """Merge staging records into core table."""
        ...

    # ── Watermark ────────────────────────────────────────────────

    @abstractmethod
    def get_watermark(self, entity: str) -> int:
        """Return max version for entity (0 if none)."""
        ...

    @abstractmethod
    def set_watermark(self, entity: str, version: int) -> None:
        """Store watermark."""
        ...

    # ── Sync log / errors ────────────────────────────────────────

    @abstractmethod
    def log_run(self, entity: str, action: str, count: int = 0,
                duration_ms: int = 0, error: str | None = None) -> None:
        """Log a sync operation (legacy)."""
        ...

    @abstractmethod
    def get_last_run(self, entity: str | None = None) -> dict | None:
        """Last run summary."""
        ...

    @abstractmethod
    def log_error(self, run_id: str, entity: str, source_id: str | None,
                  error: str) -> None:
        """Log sync error."""
        ...

    @abstractmethod
    def get_errors(self, limit: int = 10) -> list[dict]:
        """Recent sync errors."""
        ...

    # ── Transaction helpers ──────────────────────────────────────

    @abstractmethod
    def begin(self) -> None:
        """Start transaction."""
        ...

    @abstractmethod
    def commit(self) -> None:
        """Commit transaction."""
        ...

    @abstractmethod
    def rollback(self) -> None:
        """Rollback."""
        ...

    # ── Health ───────────────────────────────────────────────────

    @abstractmethod
    def get_stats(self) -> dict[str, Any]:
        """Entity counts and health info."""
        ...

    @abstractmethod
    def close(self) -> None:
        """Close connection."""
        ...
