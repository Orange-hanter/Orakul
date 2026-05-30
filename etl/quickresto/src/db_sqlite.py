"""SQLite implementation of DbConnection.

Tables:
  raw_imports       — raw JSON from QR API
  ops_etl_runs      — run lifecycle (running/success/partial/failed)
  ops_sync_errors   — per-record errors
  staging_products  — transformed products
  staging_dishes    — transformed dishes
  staging_recipes   — cooking invoice items (dish ingredients)
  staging_suppliers — transformed suppliers
  staging_incoming_invoices — transformed incoming documents
  core_products     — normalized deduplicated products
  core_suppliers    — normalized suppliers
  core_stock_entries — receipt/writeoff/inventory/cooking
  legacy: orakul_records (deprecation), etl_sync_log (deprecation)

Usage:
    from db_sqlite import SqliteBackend
    db = SqliteBackend('/tmp/orakul.db')
    run_id = db.begin_run()
    db.insert_raw('product', items, run_id, venue_id='vt786')
    db.upsert_staging('products', transformed)
    db.merge_core('products', deduped)
    db.commit_run(run_id, 'success', records=len(items))
    db.close()
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from db_base import DbConnection
from config import config

logger = logging.getLogger(__name__)


SCHEMA = """
-- ── Raw imports ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raw_imports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL,
    entity      TEXT NOT NULL,   -- 'product', 'dish', 'incoming_invoice', ...
    venue_id    TEXT,
    source_id   TEXT,            -- QR id
    version     INTEGER,         -- QR version for watermark
    data        TEXT NOT NULL,   -- full JSON
    fetched_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_raw_entity_run ON raw_imports(entity, run_id);
CREATE INDEX IF NOT EXISTS ix_raw_version   ON raw_imports(entity, version);
CREATE INDEX IF NOT EXISTS ix_raw_source    ON raw_imports(source_id);

-- ── Run tracking ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops_etl_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT NOT NULL UNIQUE,
    started_at       TEXT DEFAULT (datetime('now')),
    finished_at      TEXT,
    status           TEXT DEFAULT 'running',   -- running, success, partial, failed
    error            TEXT,
    records_processed INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_run_status ON ops_etl_runs(status);

-- ── Sync errors ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops_sync_errors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT,
    entity      TEXT,
    source_id   TEXT,
    error       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_err_run ON ops_sync_errors(run_id);

-- ── Staging ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging_products (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT NOT NULL,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    name             TEXT,
    unit             TEXT,
    category         TEXT,
    measure_unit_id  TEXT,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_prod_run ON staging_products(run_id);

CREATE TABLE IF NOT EXISTS staging_dishes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    name             TEXT,
    code             TEXT,
    unit             TEXT,
    category         TEXT,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_dish_run ON staging_dishes(run_id);

CREATE TABLE IF NOT EXISTS staging_recipes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT,
    venue_id         TEXT,
    dish_source_id   TEXT NOT NULL,
    product_source_id TEXT NOT NULL,
    quantity         REAL,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_recipe_run ON staging_recipes(run_id);

CREATE TABLE IF NOT EXISTS staging_suppliers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    name             TEXT,
    contact          TEXT,
    status           TEXT,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_supp_run ON staging_suppliers(run_id);

CREATE TABLE IF NOT EXISTS staging_incoming_invoices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    document_number  TEXT,
    supplier_source_id TEXT,
    invoice_date     TEXT,
    total_sum        REAL,
    total_sum_wo_nds REAL,
    processed        INTEGER,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_inv_run ON staging_incoming_invoices(run_id);

CREATE TABLE IF NOT EXISTS staging_stores (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT NOT NULL,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    name             TEXT,
    code             TEXT,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_store_run ON staging_stores(run_id);

CREATE TABLE IF NOT EXISTS staging_dish_categories (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT NOT NULL,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    name             TEXT,
    color            TEXT,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_dish_cat_run ON staging_dish_categories(run_id);

CREATE TABLE IF NOT EXISTS staging_measure_units (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT NOT NULL,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    name             TEXT,
    code             TEXT,
    full_name        TEXT,
    parent_ratio     REAL DEFAULT 1.0,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_mu_run ON staging_measure_units(run_id);

CREATE TABLE IF NOT EXISTS staging_shifts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT NOT NULL,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    shift_number     INTEGER,
    opened_at        TEXT,
    closed_at        TEXT,
    status           TEXT,
    total_cash       REAL DEFAULT 0,
    total_card       REAL DEFAULT 0,
    total_bonuses    REAL DEFAULT 0,
    return_cash      REAL DEFAULT 0,
    return_card      REAL DEFAULT 0,
    return_bonuses   REAL DEFAULT 0,
    orders_count     INTEGER,
    revenue          REAL DEFAULT 0,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_shift_run ON staging_shifts(run_id);
CREATE INDEX IF NOT EXISTS ix_staging_shift_closed ON staging_shifts(closed_at);

CREATE TABLE IF NOT EXISTS staging_cancellations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT NOT NULL,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    reason           TEXT,
    description      TEXT,
    employee_id      TEXT,
    table_order_id   TEXT,
    created_at       TEXT,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_cancel_run ON staging_cancellations(run_id);

CREATE TABLE IF NOT EXISTS staging_concrete_providers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT NOT NULL,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    full_name        TEXT,
    short_name       TEXT,
    address          TEXT,
    egais_status     TEXT,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_cp_run ON staging_concrete_providers(run_id);

-- ── Core ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core_products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id    TEXT,
    source_id   TEXT NOT NULL UNIQUE,
    name        TEXT,
    unit        TEXT,
    category    TEXT,
    first_seen_at TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_core_prod_venue ON core_products(venue_id);

CREATE TABLE IF NOT EXISTS core_suppliers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id    TEXT,
    source_id   TEXT NOT NULL UNIQUE,
    name        TEXT,
    contact     TEXT,
    status      TEXT DEFAULT 'active',
    first_seen_at TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_core_supp_venue ON core_suppliers(venue_id);

CREATE TABLE IF NOT EXISTS core_stock_entries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id         TEXT,
    kind             TEXT,  -- 'receipt', 'writeoff', 'inventory', 'cooking'
    source_id        TEXT,
    product_source_id TEXT,
    delta            REAL,
    resulting        REAL,
    document_date    TEXT,
    note             TEXT,
    first_seen_at    TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_stock_kind ON core_stock_entries(kind);
CREATE INDEX IF NOT EXISTS ix_stock_venue ON core_stock_entries(venue_id);

CREATE TABLE IF NOT EXISTS core_dishes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id    TEXT,
    source_id   TEXT NOT NULL UNIQUE,
    name        TEXT,
    category    TEXT,
    sell_price  REAL,
    active      INTEGER,
    first_seen_at TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_core_dish_venue ON core_dishes(venue_id);

CREATE TABLE IF NOT EXISTS core_recipes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id         TEXT,
    dish_source_id   TEXT NOT NULL,
    product_source_id TEXT NOT NULL,
    quantity         REAL,
    first_seen_at    TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now')),
    UNIQUE(dish_source_id, product_source_id)
);
CREATE INDEX IF NOT EXISTS ix_core_recipe_dish ON core_recipes(dish_source_id);

CREATE TABLE IF NOT EXISTS core_stores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id    TEXT,
    source_id   TEXT NOT NULL UNIQUE,
    name        TEXT,
    code        TEXT,
    first_seen_at TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_core_store_venue ON core_stores(venue_id);

CREATE TABLE IF NOT EXISTS core_revenue_entries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    revenue_date     TEXT,
    amount           REAL DEFAULT 0,
    currency         TEXT DEFAULT 'BYN',
    orders_count     INTEGER,
    source           TEXT DEFAULT 'quickresto',
    first_seen_at    TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_revenue_date ON core_revenue_entries(revenue_date);
CREATE INDEX IF NOT EXISTS ix_revenue_venue ON core_revenue_entries(venue_id);

-- ── Legacy (deprecation) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS orakul_records (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    venue_id    TEXT,
    data        TEXT NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_type ON orakul_records(type);
CREATE INDEX IF NOT EXISTS idx_venue ON orakul_records(venue_id);
CREATE INDEX IF NOT EXISTS idx_updated ON orakul_records(updated_at);

CREATE TABLE IF NOT EXISTS etl_sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    entity      TEXT NOT NULL,
    action      TEXT NOT NULL,
    count       INTEGER DEFAULT 0,
    duration_ms INTEGER,
    error       TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Watermark (incremental sync) ────────────────────────────────
CREATE TABLE IF NOT EXISTS ops_watermarks (
    entity      TEXT PRIMARY KEY,
    version     INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT DEFAULT (datetime('now'))
);
"""


class SqliteBackend(DbConnection):
    """SQLite production-ready backend."""

    def __init__(self, path: str | Path | None = None):
        self._path = Path(path or config.SQLITE_PATH)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._db_conn: sqlite3.Connection | None = None
        self._init_db()

    # ── Connection helpers ────────────────────────────────────────

    def _get_conn(self) -> sqlite3.Connection:
        if self._db_conn is None:
            conn = sqlite3.connect(str(self._path), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            self._db_conn = conn
        return self._db_conn

    def _init_db(self) -> None:
        conn = sqlite3.connect(str(self._path))
        conn.executescript(SCHEMA)
        conn.commit()
        conn.close()

    # ── Run lifecycle ────────────────────────────────────────────

    def begin_run(self) -> str:
        run_id = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S') + '-' + uuid4().hex[:6]
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO ops_etl_runs (run_id, status) VALUES (?, 'running')",
            (run_id,)
        )
        conn.commit()
        return run_id

    def commit_run(self, run_id: str, status: str, records: int = 0, error: str | None = None) -> None:
        conn = self._get_conn()
        conn.execute(
            "UPDATE ops_etl_runs SET status=?, finished_at=datetime('now'), records_processed=?, error=? WHERE run_id=?",
            (status, records, error, run_id)
        )
        conn.commit()

    def update_run_status(self, run_id: str, status: str, error: str | None = None) -> None:
        conn = self._get_conn()
        conn.execute(
            "UPDATE ops_etl_runs SET status=?, error=? WHERE run_id=?",
            (status, error, run_id)
        )
        conn.commit()

    # ── Raw imports ──────────────────────────────────────────────

    def insert_raw(self, entity: str, records: list[dict], run_id: str, venue_id: str | None = None) -> int:
        if not records:
            return 0
        conn = self._get_conn()
        rows = []
        for r in records:
            rows.append((
                run_id, entity, venue_id,
                str(r.get('id', '')),
                int(r.get('version', 0)) if r.get('version') is not None else 0,
                json.dumps(r, ensure_ascii=False, default=str)
            ))
        conn.executemany(
            """
            INSERT INTO raw_imports (run_id, entity, venue_id, source_id, version, data)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING
            """,
            rows
        )
        conn.commit()
        return conn.total_changes

    def count_raw(self, entity: str, run_id: str | None = None) -> int:
        conn = self._get_conn()
        if run_id:
            row = conn.execute(
                "SELECT COUNT(*) FROM raw_imports WHERE entity=? AND run_id=?",
                (entity, run_id)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) FROM raw_imports WHERE entity=?",
                (entity,)
            ).fetchone()
        return row[0] if row else 0

    def has_raw_data(self, entity: str) -> bool:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT 1 FROM raw_imports WHERE entity=? LIMIT 1",
            (entity,)
        ).fetchone()
        return row is not None

    # ── Staging ──────────────────────────────────────────────────

    def upsert_staging(self, table_name: str, records: list[dict]) -> int:
        if not records:
            return 0
        conn = self._get_conn()
        actual = self._resolve_table(table_name)
        if actual == 'staging_products':
            conn.executemany(
                """
                INSERT INTO staging_products (run_id, venue_id, source_id, name, unit, category, measure_unit_id)
                VALUES (:run_id, :venue_id, :source_id, :name, :unit, :category, :measure_unit_id)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        elif actual == 'staging_dishes':
            conn.executemany(
                """
                INSERT INTO staging_dishes (run_id, venue_id, source_id, name, code, unit, category)
                VALUES (:run_id, :venue_id, :source_id, :name, :code, :unit, :category)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        elif actual == 'staging_recipes':
            conn.executemany(
                """
                INSERT INTO staging_recipes (run_id, venue_id, dish_source_id, product_source_id, quantity)
                VALUES (:run_id, :venue_id, :dish_source_id, :product_source_id, :quantity)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        elif actual == 'staging_suppliers':
            conn.executemany(
                """
                INSERT INTO staging_suppliers (run_id, venue_id, source_id, name, contact, status)
                VALUES (:run_id, :venue_id, :source_id, :name, :contact, :status)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        elif actual == 'staging_incoming_invoices':
            conn.executemany(
                """
                INSERT INTO staging_incoming_invoices
                    (run_id, venue_id, source_id, document_number, supplier_source_id, invoice_date, total_sum, total_sum_wo_nds, processed)
                VALUES
                    (:run_id, :venue_id, :source_id, :document_number, :supplier_source_id, :invoice_date, :total_sum, :total_sum_wo_nds, :processed)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        elif actual == 'staging_stores':
            conn.executemany(
                """
                INSERT INTO staging_stores (run_id, venue_id, source_id, name, code)
                VALUES (:run_id, :venue_id, :source_id, :name, :code)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        elif actual == 'staging_dish_categories':
            conn.executemany(
                """
                INSERT INTO staging_dish_categories (run_id, venue_id, source_id, name, color)
                VALUES (:run_id, :venue_id, :source_id, :name, :color)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        elif actual == 'staging_measure_units':
            conn.executemany(
                """
                INSERT INTO staging_measure_units (run_id, venue_id, source_id, name, code, full_name, parent_ratio)
                VALUES (:run_id, :venue_id, :source_id, :name, :code, :full_name, :parent_ratio)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        elif actual == 'staging_shifts':
            conn.executemany(
                """
                INSERT INTO staging_shifts
                    (run_id, venue_id, source_id, shift_number, opened_at, closed_at, status,
                     total_cash, total_card, total_bonuses, return_cash, return_card, return_bonuses,
                     orders_count, revenue)
                VALUES
                    (:run_id, :venue_id, :source_id, :shift_number, :opened_at, :closed_at, :status,
                     :total_cash, :total_card, :total_bonuses, :return_cash, :return_card, :return_bonuses,
                     :orders_count, :revenue)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        elif actual == 'staging_cancellations':
            conn.executemany(
                """
                INSERT INTO staging_cancellations
                    (run_id, venue_id, source_id, reason, description, employee_id, table_order_id, created_at)
                VALUES
                    (:run_id, :venue_id, :source_id, :reason, :description, :employee_id, :table_order_id, :created_at)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        elif actual == 'staging_concrete_providers':
            conn.executemany(
                """
                INSERT INTO staging_concrete_providers
                    (run_id, venue_id, source_id, full_name, short_name, address, egais_status)
                VALUES
                    (:run_id, :venue_id, :source_id, :full_name, :short_name, :address, :egais_status)
                ON CONFLICT DO NOTHING
                """,
                records
            )
        else:
            raise ValueError(f"Unknown staging table: {table_name}")
        conn.commit()
        return conn.total_changes

    def _resolve_table(self, name: str) -> str:
        TABLE_MAP = {
            'products': 'staging_products',
            'dishes': 'staging_dishes',
            'recipes': 'staging_recipes',
            'suppliers': 'staging_suppliers',
            'incoming_invoices': 'staging_incoming_invoices',
            'stores': 'staging_stores',
            'shifts': 'staging_shifts',
            'dish_categories': 'staging_dish_categories',
            'measure_units': 'staging_measure_units',
            'cancellations': 'staging_cancellations',
            'concrete_providers': 'staging_concrete_providers',
        }
        return TABLE_MAP.get(name, name)

    # ── Core ─────────────────────────────────────────────────────

    def merge_core(self, table_name: str, records: list[dict]) -> int:
        if not records:
            return 0
        conn = self._get_conn()
        if table_name == 'products':
            conn.executemany(
                """
                INSERT INTO core_products (venue_id, source_id, name, unit, category, first_seen_at, updated_at)
                VALUES (:venue_id, :source_id, :name, :unit, :category, datetime('now'), datetime('now'))
                ON CONFLICT(source_id) DO UPDATE SET
                    name=excluded.name, unit=excluded.unit, category=excluded.category, updated_at=excluded.updated_at
                """,
                records
            )
        elif table_name == 'suppliers':
            conn.executemany(
                """
                INSERT INTO core_suppliers (venue_id, source_id, name, contact, status, first_seen_at, updated_at)
                VALUES (:venue_id, :source_id, :name, :contact, :status, datetime('now'), datetime('now'))
                ON CONFLICT(source_id) DO UPDATE SET
                    name=excluded.name, contact=excluded.contact, status=excluded.status, updated_at=excluded.updated_at
                """,
                records
            )
        elif table_name == 'stock_entries':
            conn.executemany(
                """
                INSERT INTO core_stock_entries
                    (venue_id, kind, source_id, product_source_id, delta, resulting, document_date, note, first_seen_at, updated_at)
                VALUES
                    (:venue_id, :kind, :source_id, :product_source_id, :delta, :resulting, :document_date, :note, datetime('now'), datetime('now'))
                ON CONFLICT(source_id, kind) DO UPDATE SET
                    delta=excluded.delta, resulting=excluded.resulting, document_date=excluded.document_date, note=excluded.note, updated_at=excluded.updated_at
                """,
                records
            )
        elif table_name == 'dishes':
            conn.executemany(
                """
                INSERT INTO core_dishes (venue_id, source_id, name, category, sell_price, active, first_seen_at, updated_at)
                VALUES (:venue_id, :source_id, :name, :category, :sell_price, :active, datetime('now'), datetime('now'))
                ON CONFLICT(source_id) DO UPDATE SET
                    name=excluded.name, category=excluded.category, sell_price=excluded.sell_price, active=excluded.active, updated_at=excluded.updated_at
                """,
                records
            )
        elif table_name == 'recipes':
            conn.executemany(
                """
                INSERT INTO core_recipes (venue_id, dish_source_id, product_source_id, quantity, first_seen_at, updated_at)
                VALUES (:venue_id, :dish_source_id, :product_source_id, :quantity, datetime('now'), datetime('now'))
                ON CONFLICT(dish_source_id, product_source_id) DO UPDATE SET
                    quantity=excluded.quantity, updated_at=excluded.updated_at
                """,
                records
            )
        elif table_name == 'stores':
            conn.executemany(
                """
                INSERT INTO core_stores (venue_id, source_id, name, code, first_seen_at, updated_at)
                VALUES (:venue_id, :source_id, :name, :code, datetime('now'), datetime('now'))
                ON CONFLICT(source_id) DO UPDATE SET
                    name=excluded.name, code=excluded.code, updated_at=excluded.updated_at
                """,
                records
            )
        else:
            raise ValueError(f"Unknown core table: {table_name}")
        conn.commit()
        return conn.total_changes

    # ── Watermark ────────────────────────────────────────────────

    def get_watermark(self, entity: str) -> int:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT version FROM ops_watermarks WHERE entity=?",
            (entity,)
        ).fetchone()
        return row[0] if row else 0

    def set_watermark(self, entity: str, version: int) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO ops_watermarks (entity, version, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(entity) DO UPDATE SET
                version=excluded.version, updated_at=excluded.updated_at
            """,
            (entity, version)
        )
        conn.commit()

    # ── Transaction helpers ──────────────────────────────────────

    def begin(self) -> None:
        pass

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        self._get_conn().rollback()

    # ── Sync log / errors ────────────────────────────────────────

    def log_run(self, entity: str, action: str, count: int = 0,
                duration_ms: int = 0, error: str | None = None) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO etl_sync_log (source, entity, action, count, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?)",
            ('quickresto', entity, action, count, duration_ms, error)
        )
        conn.commit()

    def get_last_run(self, entity: str | None = None) -> dict | None:
        conn = self._get_conn()
        if entity:
            row = conn.execute(
                "SELECT * FROM ops_etl_runs WHERE records_processed > 0 ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM ops_etl_runs ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
        return dict(row) if row else None

    def log_error(self, run_id: str, entity: str, source_id: str | None, error: str) -> None:
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO ops_sync_errors (run_id, entity, source_id, error) VALUES (?, ?, ?, ?)",
            (run_id, entity, source_id, error)
        )
        conn.commit()

    def get_errors(self, limit: int = 10) -> list[dict]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM ops_sync_errors ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Health ───────────────────────────────────────────────────

    def get_stats(self) -> dict:
        conn = self._get_conn()
        entities = [
            'product', 'dish', 'incoming_invoice', 'discard_invoice',
            'inventory', 'shift', 'supplier', 'employee',
        ]
        raw_counts = {}
        for e in entities:
            row = conn.execute(
                "SELECT COUNT(*) FROM raw_imports WHERE entity=?", (e,)
            ).fetchone()
            raw_counts[e] = row[0]
        return {
            "last_run": self.get_last_run(),
            "raw_counts": raw_counts,
            "staging_counts": {
                "products": conn.execute("SELECT COUNT(*) FROM staging_products").fetchone()[0],
                "dishes": conn.execute("SELECT COUNT(*) FROM staging_dishes").fetchone()[0],
                "suppliers": conn.execute("SELECT COUNT(*) FROM staging_suppliers").fetchone()[0],
                "stores": conn.execute("SELECT COUNT(*) FROM staging_stores").fetchone()[0],
                "measure_units": conn.execute("SELECT COUNT(*) FROM staging_measure_units").fetchone()[0],
            },
            "core_counts": {
                "products": conn.execute("SELECT COUNT(*) FROM core_products").fetchone()[0],
                "suppliers": conn.execute("SELECT COUNT(*) FROM core_suppliers").fetchone()[0],
                "dishes": conn.execute("SELECT COUNT(*) FROM core_dishes").fetchone()[0],
                "stores": conn.execute("SELECT COUNT(*) FROM core_stores").fetchone()[0],
                "stock_entries": conn.execute("SELECT COUNT(*) FROM core_stock_entries").fetchone()[0],
            },
            "recent_errors": self.get_errors(5),
        }

    def close(self) -> None:
        if self._db_conn:
            self._db_conn.close()
            self._db_conn = None

    # ── Legacy helpers (deprecation) ─────────────────────────────

    def upsert_legacy(self, record: dict) -> None:
        """DEPRECATED: use upsert_staging + merge_core."""
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO orakul_records (id, type, venue_id, data, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                type=excluded.type, venue_id=excluded.venue_id, data=excluded.data, updated_at=excluded.updated_at
            """,
            (record["id"], record.get("type", ""),
             record.get("venueId", record.get("venue_id", "")),
             json.dumps(record, ensure_ascii=False, default=str),
             datetime.now(timezone.utc).isoformat())
        )
        conn.commit()

    def upsert_many_legacy(self, records: list[dict]) -> int:
        """DEPRECATED: use insert_raw + upsert_staging."""
        if not records:
            return 0
        conn = self._get_conn()
        now = datetime.now(timezone.utc).isoformat()
        rows = [
            (r["id"], r.get("type", ""), r.get("venueId", r.get("venue_id", "")),
             json.dumps(r, ensure_ascii=False, default=str), now)
            for r in records
        ]
        conn.executemany(
            """
            INSERT INTO orakul_records (id, type, venue_id, data, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                type=excluded.type, venue_id=excluded.venue_id, data=excluded.data, updated_at=excluded.updated_at
            """,
            rows
        )
        conn.commit()
        return conn.total_changes
