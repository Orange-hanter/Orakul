"""
ETL sync runner: QuickResto → Orakul SQLite.

Usage:
  cd etl/quickresto && PYTHONPATH=src python -m src.run_sync

Steps:
  1. Fetch from QR API (recon_probe → raw JSON files)
  2. Transform to Orakul model (transform.py)
  3. Upsert into SQLite (db.py)
  4. Log sync results

Параметры (через .env):
  QR_USERNAME / QR_PASSWORD / QR_BASE_URL
  ETL_SYNC_SINCE=YYYY-MM-DD  — дата начала (для инкрементальной загрузки)
  ETL_SYNC_LIMIT=N          — макс записей на entity (для тестов)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

# sys.path fix
_src_dir = Path(__file__).resolve().parent
if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))

from client import QuickRestoClient
from config import config
from db import OrakulDB
from transform import (
    transform_cancellations,
    transform_dishes,
    transform_discard_invoices,
    transform_incoming_invoices,
    transform_inventories,
    transform_order_infos,
    transform_products,
    transform_suppliers,
)

logger = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────

SYNC_SINCE = os.getenv("ETL_SYNC_SINCE", "")
SYNC_LIMIT = int(os.getenv("ETL_SYNC_LIMIT", "0") or "0")  # 0 = unlimited

# ── Main sync ──────────────────────────────────────────────────

async def run_sync():
    setup_logging()

    if not config.QR_USERNAME or not config.QR_PASSWORD:
        logger.error("QR_USERNAME / QR_PASSWORD не заданы. Заполните .env")
        return 1

    db = OrakulDB()
    logger.info("SQLite: %s", db.path)

    # Venue (company) — одна запись
    venue_records = db.list_by_type("venue")
    if venue_records:
        venue = venue_records[0]
        logger.info("Venue уже существует: %s (%s)", venue["name"], venue["id"][:8])
    else:
        venue = {
            "type": "venue",
            "id": "venue-qr-main",
            "name": "Моцарелла",
            "isDefault": True,
        }
        db.upsert(venue)
        logger.info("Venue создана: %s", venue["name"])

    venue_id = venue["id"]
    total_fetched = 0
    total_transformed = 0
    total_db = 0

    start_time = time.time()

    async with QuickRestoClient() as client:
        # ── 1. Company (venue) ────────────────────────────────
        companies = await client.list_company_info()
        for c in companies:
            record = {
                "type": "venue",
                "id": venue_id,
                "name": c.get("name", "Моцарелла"),
                "isDefault": True,
            }
            db.upsert(record)
            total_db += 1
        logger.info("[%s] Company: %d", "venue", len(companies))

        # ── 2. Products (ингредиенты + полуфабр.) ───────────────
        raw_products = await client.list_ingredients(limit=SYNC_LIMIT or None)
        products = transform_products(raw_products, venue_id)
        db.upsert_many(products)
        total_fetched += len(raw_products)
        total_transformed += len(products)
        total_db += len(products)
        logger.info("[%s] Products: %d raw → %d transformed", "product", len(raw_products), len(products))

        # ── 3. Dishes ───────────────────────────────────────────
        raw_dishes = await client.list_dishes(limit=SYNC_LIMIT or None)
        dishes = transform_dishes(raw_dishes, venue_id)
        db.upsert_many(dishes)
        total_fetched += len(raw_dishes)
        total_transformed += len(dishes)
        total_db += len(dishes)
        logger.info("[%s] Dishes: %d raw → %d transformed", "dish", len(raw_dishes), len(dishes))

        # ── 4. Suppliers ────────────────────────────────────────
        raw_suppliers = await client.list_providers(limit=SYNC_LIMIT or None)
        suppliers = transform_suppliers(raw_suppliers)
        db.upsert_many(suppliers)
        total_fetched += len(raw_suppliers)
        total_transformed += len(suppliers)
        total_db += len(suppliers)
        logger.info("[%s] Suppliers: %d raw → %d transformed", "supplier", len(raw_suppliers), len(suppliers))

        # ── 5. Incoming invoices (orders + stock_entry receipt) ─
        raw_incoming = await client.list_incoming_invoices(limit=SYNC_LIMIT or None)
        orders, stock_receipts = transform_incoming_invoices(raw_incoming, venue_id)
        db.upsert_many(orders)
        db.upsert_many(stock_receipts)
        total_fetched += len(raw_incoming)
        total_transformed += len(orders) + len(stock_receipts)
        total_db += len(orders) + len(stock_receipts)
        logger.info(
            "[%s] Incoming: %d raw → %d orders + %d stock_entries",
            "incoming", len(raw_incoming), len(orders), len(stock_receipts)
        )

        # ── 6. Discard invoices (stock_entry writeoff) ─────────
        raw_discard = await client.list_discard_invoices(limit=SYNC_LIMIT or None)
        discards = transform_discard_invoices(raw_discard, venue_id)
        db.upsert_many(discards)
        total_fetched += len(raw_discard)
        total_transformed += len(discards)
        total_db += len(discards)
        logger.info("[%s] Discard: %d raw → %d stock_entries", "discard", len(raw_discard), len(discards))

        # ── 7. Inventory (stock_entry inventory) ──────────────────
        raw_inventory = await client.list_inventory(limit=SYNC_LIMIT or None)
        inventories = transform_inventories(raw_inventory, venue_id)
        db.upsert_many(inventories)
        total_fetched += len(raw_inventory)
        total_transformed += len(inventories)
        total_db += len(inventories)
        logger.info("[%s] Inventory: %d raw → %d stock_entries", "inventory", len(raw_inventory), len(inventories))

        # ── 8. Cancellations (stock_entry writeoff) ─────────────
        raw_cancellations = await client.list_cancellations(limit=SYNC_LIMIT or None)
        cancellations = transform_cancellations(raw_cancellations, venue_id)
        db.upsert_many(cancellations)
        total_fetched += len(raw_cancellations)
        total_transformed += len(cancellations)
        total_db += len(cancellations)
        logger.info("[%s] Cancellations: %d raw → %d stock_entries", "cancellation", len(raw_cancellations), len(cancellations))

    # ── Summary ─────────────────────────────────────────────────
    duration = time.time() - start_time
    logger.info("╔═══════════════════════════════════════╗")
    logger.info("║  ETL Sync завершён                    ║")
    logger.info("╠═══════════════════════════════════════╣")
    logger.info("║  Duration:       %.1f s", duration)
    logger.info("║  Raw fetched:    %d", total_fetched)
    logger.info("║  Transformed:   %d", total_transformed)
    logger.info("║  DB records:    %d", total_db)
    logger.info("╚═══════════════════════════════════════╝")

    # Подсчёт по типам
    conn = db._conn()
    for t in ("venue", "product", "dish", "supplier", "order", "stock_entry", "revenue_entry"):
        c = db.count_by_type(t)
        logger.info("  %-15s: %d records", t, c)

    # Sync log
    db.log_sync("quickresto", "all", "sync", count=total_db, duration_ms=int(duration * 1000))
    return 0


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


if __name__ == "__main__":
    sys.exit(asyncio.run(run_sync()))
