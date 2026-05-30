"""
Sync: Store (QuickResto warehouse) → raw_imports + staging_stores.

Module: warehouse.stores.warehouse
"""

import logging
from client import QuickRestoClient
from db import OrakulDB

logger = logging.getLogger(__name__)


def transform_store(data: dict, venue_id: str) -> dict | None:
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None
    return {
        "source_id": str(qr_id),
        "name": data.get("name", data.get("itemTitle", "")) or "Склад без имени",
        "code": data.get("code", ""),
    }


async def sync_stores(client: QuickRestoClient, db: OrakulDB, venue_id: str = '', etl_run_id: str = '') -> int:
    """
    Выгружает все Store (warehouse) из QR и пишет в raw_imports + staging_stores.
    Поддерживает инкрементальную синхронизацию через watermark (version).
    """
    module = 'warehouse.store'
    watermark = db.get_watermark('store')
    logger.info("[sync_stores] Начало синхронизации: %s (since_version=%s)", module, watermark)

    items = await client.list_entities(
        module_name=module,
        class_name='ru.edgex.quickresto.modules.warehouse.store.Store',
        since_version=watermark,
    )
    if not items:
        logger.warning("[sync_stores] QR вернул пустой список для %s", module)
        return 0

    # 1. Raw dump
    db.insert_raw('store', items, etl_run_id, venue_id)
    logger.info("[sync_stores] raw: %s записей", len(items))

    # 2. Transform → staging
    staged = []
    for item in items:
        t = transform_store(item, venue_id)
        if not t:
            continue
        staged.append({
            'run_id': etl_run_id,
            'venue_id': venue_id,
            'source_id': t['source_id'],
            'name': t['name'],
            'code': t['code'],
        })

    # 3. Upsert staging
    db.upsert_staging('stores', staged)
    logger.info("[sync_stores] staging: %s записей", len(staged))

    # 4. Watermark
    max_version = max((int(i.get('version', 0)) for i in items), default=watermark)
    db.set_watermark('store', max_version)
    logger.info("[sync_stores] watermark обновлён: %s → %s", watermark, max_version)

    return len(staged)
