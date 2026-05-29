"""
Sync: SingleProduct (QuickResto) → raw_imports + staging_products.

Module: warehouse.nomenclature.singleproduct
"""

import logging
from typing import List

from client import QuickRestoClient
from db import OrakulDB
from transform import transform_product

logger = logging.getLogger(__name__)


async def sync_products(client: QuickRestoClient, db: OrakulDB, venue_id: str = '', etl_run_id: str = '') -> int:
    """
    Выгружает SingleProduct из QR (инкрементально) и пишет в raw_imports + staging_products.
    Returns: количество staging-записей.
    """
    module = 'warehouse.nomenclature.singleproduct'
    watermark = db.get_watermark('product')
    logger.info("[sync_products] Начало синхронизации: %s (since_version=%s)", module, watermark)

    items = await client.list_entities(
        module_name=module,
        class_name='ru.edgex.quickresto.modules.warehouse.nomenclature.singleproduct.SingleProduct',
        since_version=watermark,
    )
    if not items:
        logger.info("[sync_products] Нет новых записей для %s", module)
        return 0

    # 1. Raw dump
    db.insert_raw('product', items, etl_run_id, venue_id)
    logger.info("[sync_products] raw: %s записей", len(items))

    # 2. Обновляем watermark
    max_version = max((int(i.get('version', 0)) for i in items), default=watermark)
    db.set_watermark('product', max_version)
    logger.info("[sync_products] watermark обновлён: %s → %s (raw records: %d)", watermark, max_version, len(items))

    # 3. Transform → staging format
    staged = []
    for item in items:
        t = transform_product(item, venue_id)
        if not t:
            continue
        measure = item.get('measureUnit', {}) or {}
        staged.append({
            'run_id': etl_run_id,
            'venue_id': venue_id,
            'source_id': str(item.get('id', '')),
            'name': t['name'],
            'unit': t.get('unit', 'кг'),
            'category': t.get('category', ''),
            'measure_unit_id': str(measure.get('id', '')),
        })

    # 4. Upsert staging
    db.upsert_staging('products', staged)
    logger.info("[sync_products] staging: %s записей", len(staged))
    return len(staged)
