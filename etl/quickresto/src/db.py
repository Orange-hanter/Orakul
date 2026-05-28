"""
Database layer — абстракция над SQLite (MVP) и PostgreSQL (production).

Асинхронный доступ через aiosqlite (SQLite) или asyncpg (PostgreSQL).
Единый интерфейс для обоих backend'ов.
"""

import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional

from config import config

logger = logging.getLogger(__name__)

# Пробуем импортировать asyncpg — если не установлен, fallback на SQLite
_uses_postgres = config.DB_BACKEND == 'postgres'
try:
    if _uses_postgres:
        import asyncpg
        _asyncpg_available = True
    else:
        _asyncpg_available = False
except ImportError:
    _uses_postgres = False
    _asyncpg_available = False
    logger.warning("asyncpg not installed, using SQLite backend")

# Для SQLite используем aiosqlite
try:
    import aiosqlite
    _aiosqlite_available = True
except ImportError:
    _aiosqlite_available = False


class DbConnection:
    """Унифицированный async DB-коннектор (SQLite / PostgreSQL)."""

    def __init__(self):
        self._conn = None
        self._pool = None
        self._backend = 'postgres' if (_uses_postgres and _asyncpg_available) else 'sqlite'

    async def connect(self):
        if self._backend == 'postgres':
            self._pool = await asyncpg.create_pool(
                config.postgres_dsn,
                min_size=1,
                max_size=5,
            )
            logger.info("DB: connected to PostgreSQL")
        else:
            # SQLite
            db_path = Path(config.SQLITE_PATH)
            db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = await aiosqlite.connect(str(db_path))
            self._conn.row_factory = sqlite3.Row
            await self._init_sqlite_schema()
            logger.info("DB: connected to SQLite at %s", db_path)

    async def close(self):
        if self._pool:
            await self._pool.close()
            self._pool = None
        if self._conn:
            await self._conn.close()
            self._conn = None

    async def __aenter__(self) -> 'DbConnection':
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    # ── Schema init (SQLite MVP) ─────────────────────────────────

    async def _init_sqlite_schema(self):
        """Создаёт таблицы SQLite если нет."""
        schema = """
            CREATE TABLE IF NOT EXISTS raw_imports (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                source_entity TEXT NOT NULL,
                source_id     TEXT,
                payload       TEXT NOT NULL,
                import_ts     TEXT NOT NULL DEFAULT (datetime('now')),
                etl_run_id    INTEGER,
                location_id   TEXT,
                is_processed  INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_raw_entity_ts ON raw_imports(source_entity, import_ts);
            CREATE INDEX IF NOT EXISTS idx_raw_entity_sid ON raw_imports(source_entity, source_id);

            CREATE TABLE IF NOT EXISTS ops_etl_runs (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id       TEXT UNIQUE NOT NULL,
                started_at   TEXT NOT NULL,
                ended_at     TEXT,
                entity       TEXT,
                records_processed INTEGER DEFAULT 0,
                status       TEXT NOT NULL DEFAULT 'running',
                error_message TEXT
            );

            CREATE TABLE IF NOT EXISTS staging_products (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id    TEXT NOT NULL,
                name         TEXT NOT NULL,
                code         TEXT,
                unit         TEXT,
                category     TEXT,
                qr_data      TEXT,          -- JSON оригинала
                venue_id     TEXT,
                imported_at  TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(source_id, venue_id)
            );

            CREATE TABLE IF NOT EXISTS staging_dishes (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id    TEXT NOT NULL,
                name         TEXT NOT NULL,
                code         TEXT,
                unit         TEXT,
                category     TEXT,
                qr_data      TEXT,
                venue_id     TEXT,
                imported_at  TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(source_id, venue_id)
            );

            CREATE TABLE IF NOT EXISTS staging_stores (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id    TEXT NOT NULL,
                name         TEXT NOT NULL,
                code         TEXT,
                venue_id     TEXT,
                imported_at  TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(source_id, venue_id)
            );

            CREATE TABLE IF NOT EXISTS staging_recipes (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                dish_source_id TEXT NOT NULL,
                ingredient_source_id TEXT NOT NULL,
                quantity     REAL NOT NULL,
                unit         TEXT,
                venue_id     TEXT,
                imported_at  TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(dish_source_id, ingredient_source_id, venue_id)
            );
        """
        for stmt in schema.strip().split(';\n'):
            stmt = stmt.strip()
            if stmt:
                await self._conn.execute(stmt)
        await self._conn.commit()

    # ── Generic execute / fetch ────────────────────────────────────

    async def execute(self, sql: str, params: tuple = ()):
        if self._backend == 'postgres':
            async with self._pool.acquire() as conn:
                await conn.execute(sql, *params)
        else:
            await self._conn.execute(sql, params)

    async def fetchall(self, sql: str, params: tuple = ()) -> List[dict]:
        if self._backend == 'postgres':
            async with self._pool.acquire() as conn:
                rows = await conn.fetch(sql, *params)
                return [dict(r) for r in rows]
        else:
            async with self._conn.execute(sql, params) as cursor:
                rows = await cursor.fetchall()
                return [dict(row) for row in rows]

    async def fetchone(self, sql: str, params: tuple = ()) -> Optional[dict]:
        if self._backend == 'postgres':
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(sql, *params)
                return dict(row) if row else None
        else:
            async with self._conn.execute(sql, params) as cursor:
                row = await cursor.fetchone()
                return dict(row) if row else None

    async def insert_many(self, sql: str, records: List[tuple]):
        """Batch INSERT с fallback на SQLite."""
        if not records:
            return
        if self._backend == 'postgres':
            # asyncpg поддерживает executemany
            async with self._pool.acquire() as conn:
                await conn.executemany(sql, records)
        else:
            await self._conn.executemany(sql, records)
            await self._conn.commit()

    # ── ETL run logging ────────────────────────────────────────────

    async def start_etl_run(self, entity: str) -> str:
        run_id = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        now = datetime.utcnow().isoformat()
        sql = """
            INSERT INTO ops_etl_runs (run_id, started_at, entity, status)
            VALUES (?, ?, ?, 'running')
        """
        if self._backend == 'postgres':
            sql = sql.replace('?', '$1, $2, $3, $4')
        await self.execute(sql, (run_id, now, entity))
        logger.info("ETL run started: %s for %s", run_id, entity)
        return run_id

    async def finish_etl_run(
        self,
        run_id: str,
        status: str = 'success',
        records_processed: int = 0,
        error_message: Optional[str] = None,
    ):
        now = datetime.utcnow().isoformat()
        sql = """
            UPDATE ops_etl_runs
            SET ended_at = ?, status = ?, records_processed = ?, error_message = ?
            WHERE run_id = ?
        """
        if self._backend == 'postgres':
            sql = sql.replace('?', '$1, $2, $3, $4, $5')
        await self.execute(sql, (now, status, records_processed, error_message or '', run_id))
        logger.info("ETL run finished: %s — %s (%s records)", run_id, status, records_processed)

    # ── Raw imports ────────────────────────────────────────────────

    async def insert_raw(self, entity: str, items: List[dict], etl_run_id: str, venue_id: str = ''):
        if not items:
            return 0
        sql = """
            INSERT INTO raw_imports (source_entity, source_id, payload, etl_run_id, location_id)
            VALUES (?, ?, ?, ?, ?)
        """
        if self._backend == 'postgres':
            sql = sql.replace('?', '$1, $2, $3, $4, $5')
        records = []
        for item in items:
            sid = str(item.get('id', ''))
            records.append((entity, sid, json.dumps(item, ensure_ascii=False), etl_run_id, venue_id))
        await self.insert_many(sql, records)
        return len(records)

__all__ = ['DbConnection']
