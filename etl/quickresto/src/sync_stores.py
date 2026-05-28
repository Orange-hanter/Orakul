"""
Sync: Store (QuickResto warehouse) → staging_stores (Orakul).

Module: warehouse.stores.warehouse
"""

import logging
from client import QuickRestoClient
from db import DbConnection
from transform import map_store

logger = logging.getLogger(__name__)


async def sync_stores(client: QuickRestoClient, db: DbConnection, venue_id: str = '', etl_run_id: str = '') -> int:
    """
    Выгружает все Store (warehouse) из QR и пишет в staging_stores + raw_imports.
    """
    module = 'warehouse.stores.warehouse'
    logger.info("[sync_stores] Начало синхронизации: %s", module)

    items = await client.list_entities(module_name=module)
    if not items:
        logger.warning("[sync_stores] QR вернул пустой список для %s", module)
        return 0

    inserted_raw = await db.insert_raw('store', items, etl_run_id, venue_id)
    logger.info("[sync_stores] raw: %s записей", inserted_raw)

    mapped = [map_store(item, venue_id) for item in items]

    db_backend = db._backend
    if db_backend == 'sqlite':
        sql = """
            INSERT OR REPLACE INTO staging_stores
            (source_id, name, code, venue_id, imported_at)
            VALUES (?, ?, ?, ?, datetime('now'))
        """
    else:
        sql = """
            INSERT INTO staging_stores
            (source_id, name, code, venue_id, imported_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (source_id, venue_id) DO UPDATE SET
              name=EXCLUDED.name,
              code=EXCLUDED.code,
              imported_at=NOW()
        """

    records = [(m['source_id'], m['name'], m['code'], m['venue_id']) for m in mapped]
    await db.insert_many(sql, records)
    logger.info("[sync_stores] staging: %s записей", len(records))
    return len(records)
