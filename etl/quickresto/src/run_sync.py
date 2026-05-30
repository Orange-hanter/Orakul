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

# Import sync modules
from sync_products import sync_products
from sync_dishes import sync_dishes
from sync_stores import sync_stores

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

    run_id = db.begin_run()
    logger.info("ETL run started: %s", run_id)

    venue_id = "venue-qr-main"
    total_staging = 0
    total_raw = 0
    errors: list[str] = []
    failed_steps = 0

    start_time = time.time()

    try:
        async with QuickRestoClient() as client:
            # ── 1. Company (venue) ────────────────────────────────
            try:
                companies = await client.list_company_info()
                if companies:
                    db.insert_raw('company', companies, run_id, venue_id)
                    logger.info("[%s] Company: %d", "company", len(companies))
            except Exception as e:
                logger.warning("Company fetch failed: %s", e)
                errors.append(f"company: {e}")
                failed_steps += 1

            # ── 2. Products ───────────────────────────────────────────
            try:
                n = await sync_products(client, db, venue_id, run_id)
                total_staging += n
            except Exception as e:
                logger.error("Products sync failed: %s", e)
                errors.append(f"products: {e}")
                failed_steps += 1

            # ── 3. Dishes ─────────────────────────────────────────────
            try:
                n = await sync_dishes(client, db, venue_id, run_id)
                total_staging += n
            except Exception as e:
                logger.error("Dishes sync failed: %s", e)
                errors.append(f"dishes: {e}")
                failed_steps += 1

            # ── 4. Stores ───────────────────────────────────────────
            try:
                n = await sync_stores(client, db, venue_id, run_id)
                total_staging += n
            except Exception as e:
                logger.error("Stores sync failed: %s", e)
                errors.append(f"stores: {e}")
                failed_steps += 1

            # ── 5. Suppliers (providers) ────────────────────────────
            try:
                providers = await client.list_providers()
                if providers:
                    db.insert_raw('supplier', providers, run_id, venue_id)
                    logger.info("[%s] Suppliers: %d", "supplier", len(providers))
            except Exception as e:
                logger.warning("Suppliers fetch failed: %s", e)
                errors.append(f"suppliers: {e}")
                failed_steps += 1

            # ── 6. Incoming invoices ────────────────────────────────
            try:
                invoices = await client.list_incoming_invoices()
                if invoices:
                    db.insert_raw('incoming_invoice', invoices, run_id, venue_id)
                    logger.info("[%s] Incoming invoices: %d", "incoming_invoice", len(invoices))
            except Exception as e:
                logger.warning("Incoming invoices fetch failed: %s", e)
                errors.append(f"incoming_invoices: {e}")
                failed_steps += 1

            # ── 7. Discard invoices ─────────────────────────────────
            try:
                discards = await client.list_discard_invoices()
                if discards:
                    db.insert_raw('discard_invoice', discards, run_id, venue_id)
                    logger.info("[%s] Discard invoices: %d", "discard_invoice", len(discards))
            except Exception as e:
                logger.warning("Discard invoices fetch failed: %s", e)
                errors.append(f"discard_invoices: {e}")
                failed_steps += 1

            # ── 8. Inventory ────────────────────────────────────────
            try:
                inventories = await client.list_inventory()
                if inventories:
                    db.insert_raw('inventory', inventories, run_id, venue_id)
                    logger.info("[%s] Inventory: %d", "inventory", len(inventories))
            except Exception as e:
                logger.warning("Inventory fetch failed: %s", e)
                errors.append(f"inventory: {e}")
                failed_steps += 1

            # ── 9. Dish categories ──────────────────────────────────
            try:
                from sync_dish_categories import sync_dish_categories
                n = await sync_dish_categories(client, db, venue_id, run_id)
                total_staging += n
            except Exception as e:
                logger.error("Dish categories sync failed: %s", e)
                errors.append(f"dish_categories: {e}")
                failed_steps += 1

            # ── 10. Measure units ───────────────────────────────────
            try:
                from sync_measure_units import sync_measure_units
                n = await sync_measure_units(client, db, venue_id, run_id)
                total_staging += n
            except Exception as e:
                logger.error("Measure units sync failed: %s", e)
                errors.append(f"measure_units: {e}")
                failed_steps += 1

            # ── 11. Concrete providers ──────────────────────────────
            try:
                from sync_concrete_providers import sync_concrete_providers
                n = await sync_concrete_providers(client, db, venue_id, run_id)
                total_staging += n
            except Exception as e:
                logger.error("Concrete providers sync failed: %s", e)
                errors.append(f"concrete_providers: {e}")
                failed_steps += 1

            # ── 12. Cancellations ───────────────────────────────────
            try:
                from sync_cancellations import sync_cancellations
                n = await sync_cancellations(client, db, venue_id, run_id)
                total_staging += n
            except Exception as e:
                logger.error("Cancellations sync failed: %s", e)
                errors.append(f"cancellations: {e}")
                failed_steps += 1

            # ── 13. Shifts (revenue) ─────────────────────────────────
            try:
                from sync_shifts import sync_shifts
                n = await sync_shifts(client, db, venue_id, run_id)
                total_staging += n
            except Exception as e:
                logger.error("Shifts sync failed: %s", e)
                errors.append(f"shifts: {e}")
                failed_steps += 1

            # ── 14. Employees ─────────────────────────────────────────
            try:
                employees = await client.list_employees()
                if employees:
                    db.insert_raw('employee', employees, run_id, venue_id)
                    logger.info("[%s] Employees: %d", "employee", len(employees))
            except Exception as e:
                logger.warning("Employees fetch failed: %s", e)
                errors.append(f"employees: {e}")
                failed_steps += 1

    except Exception as e:
        logger.error("Fatal sync error: %s", e)
        db.commit_run(run_id, "failed", records=total_staging, error=str(e))
        return 1

    # ── Summary ─────────────────────────────────────────────────
    duration = time.time() - start_time
    status = "completed" if not errors else "completed_with_errors"
    error_msg = "; ".join(errors) if errors else None

    db.commit_run(run_id, status, records=total_staging, error=error_msg)

    logger.info("╔═══════════════════════════════════════╗")
    logger.info("║  ETL Sync завершён                    ║")
    logger.info("╠═══════════════════════════════════════╣")
    logger.info("║  Run id:         %s", run_id)
    logger.info("║  Duration:       %.1f s", duration)
    logger.info("║  Staging records: %d", total_staging)
    logger.info("║  Failed steps:    %d", failed_steps)
    logger.info("║  Errors:         %d", len(errors))
    logger.info("╚═══════════════════════════════════════╝")

    # DB stats
    stats = db.get_stats()
    logger.info("DB stats: %s", stats)

    return 0


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


if __name__ == "__main__":
    sys.exit(asyncio.run(run_sync()))
