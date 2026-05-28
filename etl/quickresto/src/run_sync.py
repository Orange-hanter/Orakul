#! /usr/bin/env python3
"""
Entry point — фаза 1 ETL для QuickResto.

Запускает синхронизацию справочников:
  1. SingleProduct → product
  2. Store → venue
  3. Dish + CookingInvoice → dish + recipe

Usage:
  python -m src.run_sync
  python -m src.run_sync --venue-id ABC123 --debug

Exit codes:
  0 — успех
  1 — ошибка аутентификации / API
  2 — ошибка БД
  3 — нет данных (может быть OK для dry-run)
"""

import argparse
import asyncio
import logging
import sys
from datetime import datetime

from client import QuickRestoClient
from db import DbConnection
from sync_products import sync_products
from sync_stores import sync_stores
from sync_dishes import sync_dishes
from config import config

logger = logging.getLogger(__name__)


def setup_logging(debug: bool = False):
    level = logging.DEBUG if debug else logging.INFO
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    logging.basicConfig(level=level, format=fmt, handlers=[
        logging.StreamHandler(sys.stdout),
    ])


async def main():
    parser = argparse.ArgumentParser(description="Orakul QuickResto ETL — Phase 1")
    parser.add_argument("--venue-id", default=config.DEFAULT_VENUE_ID, help="ID точки (venue)")
    parser.add_argument("--debug", action="store_true", help="Включить debug-лог")
    parser.add_argument("--dry-run", action="store_true", help="Не писать в БД, только показать")
    args = parser.parse_args()

    setup_logging(args.debug)
    venue_id = args.venue_id

    if not config.QR_USERNAME or not config.QR_PASSWORD:
        logger.error("Не заданы QR_USERNAME / QR_PASSWORD. Заполните .env")
        return 1

    logger.info("╔═══════════════════════════════════════╗")
    logger.info("║   Orakul ETL — QuickResto Phase 1     ║")
    logger.info("╠═══════════════════════════════════════╣")
    logger.info("║ Venue: %-30s ║", venue_id or "(default)")
    logger.info("║ DB:   %-30s ║", config.DB_BACKEND)
    logger.info("║ QR:   %-30s ║", config.qr_api_url)
    logger.info("╚═══════════════════════════════════════╝")

    async with DbConnection() as db:
        async with QuickRestoClient() as client:
            overall_success = True
            overall_total = 0

            # ── 1. Products ───────────────────────────────────────────
            run_id = await db.start_etl_run("product")
            try:
                count = await sync_products(client, db, venue_id, run_id)
                await db.finish_etl_run(run_id, status='success', records_processed=count)
                overall_total += count
                logger.info("✅ Products: %s записей", count)
            except Exception as e:
                logger.exception("❌ Products failed")
                await db.finish_etl_run(run_id, status='failed', error_message=str(e))
                overall_success = False

            # ── 2. Stores ─────────────────────────────────────────────
            run_id = await db.start_etl_run("store")
            try:
                count = await sync_stores(client, db, venue_id, run_id)
                await db.finish_etl_run(run_id, status='success', records_processed=count)
                overall_total += count
                logger.info("✅ Stores: %s записей", count)
            except Exception as e:
                logger.exception("❌ Stores failed")
                await db.finish_etl_run(run_id, status='failed', error_message=str(e))
                overall_success = False

            # ── 3. Dishes + Recipes ──────────────────────────────────
            run_id = await db.start_etl_run("dish_and_recipe")
            try:
                count = await sync_dishes(client, db, venue_id, run_id)
                await db.finish_etl_run(run_id, status='success', records_processed=count)
                overall_total += count
                logger.info("✅ Dishes+Recipes: %s записей", count)
            except Exception as e:
                logger.exception("❌ Dishes+Recipes failed")
                await db.finish_etl_run(run_id, status='failed', error_message=str(e))
                overall_success = False

            logger.info("╔═══════════════════════════════════════╗")
            logger.info("║  Phase 1 завершён                     ║")
            logger.info("║  Всего записей: %-21s ║", overall_total)
            logger.info("║  Статус: %-28s ║", "OK" if overall_success else "PARTIAL FAILURE")
            logger.info("╚═══════════════════════════════════════╝")
            return 0 if overall_success else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
