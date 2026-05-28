"""
Sync: SingleProduct (QuickResto) → staging_products (Orakul).

Module: warehouse.nomenclature.singleproduct
"""

import logging
from typing import List

from client import QuickRestoClient
from db import DbConnection
from transform import map_single_product

logger = logging.getLogger(__name__)


async def sync_products(client: QuickRestoClient, db: DbConnection, venue_id: str = '', etl_run_id: str = '') -> int:
    """
    Выгружает все SingleProduct из QR и пишет в staging_products + raw_imports.
    
    Returns: количество обработанных записей.
    """
    module = 'warehouse.nomenclature.singleproduct'
    logger.info("[sync_products] Начало синхронизации: %s", module)

    # 1. Выгрузка из QR
    items = await client.list_entities(module_name=module)
    if not items:
        logger.warning("[sync_products] QR вернул пустой список для %s", module)
        return 0

    # 2. Сырой дамп в raw_imports
    inserted_raw = await db.insert_raw('product', items, etl_run_id, venue_id)
    logger.info("[sync_products] raw: %s записей", inserted_raw)

    # 3. Transform + staging
    mapped = [map_single_product(item, venue_id) for item in items]

    # Upsert (INSERT OR REPLACE / ON CONFLICT UPDATE)
    db_backend = db._backend
    if db_backend == 'sqlite':
        sql = """
            INSERT OR REPLACE INTO staging_products
            (source_id, name, code, unit, category, qr_data, venue_id, imported_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """
    else:
        sql = """
            INSERT INTO staging_products
            (source_id, name, code, unit, category, qr_data, venue_id, imported_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (source_id, venue_id) DO UPDATE SET
              name=EXCLUDED.name,
              code=EXCLUDED.code,
              unit=EXCLUDED.unit,
              category=EXCLUDED.category,
              qr_data=EXCLUDED.qr_data,
              imported_at=NOW()
        """

    records = [
        (m['source_id'], m['name'], m['code'], m['unit'], m['category'],
         m['qr_data'], m['venue_id'])
        for m in mapped
    ]
    # SQLite требует строки для qr_data; postgres — JSONB
    if db_backend == 'sqlite':
        import json as _json
        records = [
            (r[0], r[1], r[2], r[3], r[4],
             _json.dumps(r[5], ensure_ascii=False), r[6])
            for r in records
        ]

    await db.insert_many(sql, records)
    logger.info("[sync_products] staging: %s записей", len(records))
    return len(records)
