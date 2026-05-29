"""Sync: Measure units from QuickResto API → raw_imports + staging_measure_units.

Module: core.dictionaries.measureunits
Class: ru.edgex.quickresto.modules.core.dictionaries.measureunits.MeasureUnit
"""

import logging
from client import QuickRestoClient
from db import OrakulDB

logger = logging.getLogger(__name__)


def transform_measure_unit(data: dict, venue_id: str) -> dict | None:
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None
    return {
        "source_id": str(qr_id),
        "name": data.get("name", ""),
        "code": data.get("code", ""),
        "full_name": data.get("fullName", ""),
        "parent_ratio": data.get("parentRatio", 1.0),
    }


async def sync_measure_units(client: QuickRestoClient, db: OrakulDB, venue_id: str = '', etl_run_id: str = '') -> int:
    """
    Выгружает все MeasureUnit из QR и пишет в raw_imports + staging_measure_units.
    Поддерживает инкрементальную синхронизацию через watermark (version).
    """
    module = 'core.dictionaries.measureunits'
    class_name = 'ru.edgex.quickresto.modules.core.dictionaries.measureunits.MeasureUnit'
    watermark = db.get_watermark('measure_unit')
    logger.info("[sync_measure_units] Начало синхронизации: %s (since_version=%s)", module, watermark)

    items = await client.list_entities(
        module_name=module,
        class_name=class_name,
        since_version=watermark,
    )
    if not items:
        logger.warning("[sync_measure_units] QR вернул пустой список для %s", module)
        return 0

    # 1. Raw dump
    db.insert_raw('measure_unit', items, etl_run_id, venue_id)
    logger.info("[sync_measure_units] raw: %s записей", len(items))

    # 2. Transform → staging
    staged = []
    for item in items:
        t = transform_measure_unit(item, venue_id)
        if not t:
            continue
        staged.append({
            'run_id': etl_run_id,
            'venue_id': venue_id,
            'source_id': t['source_id'],
            'name': t['name'],
            'code': t['code'],
            'full_name': t['full_name'],
            'parent_ratio': t['parent_ratio'],
        })

    # 3. Upsert staging
    db.upsert_staging('measure_units', staged)
    logger.info("[sync_measure_units] staging: %s записей", len(staged))

    # 4. Watermark
    max_version = max((int(i.get('version', 0)) for i in items), default=watermark)
    db.set_watermark('measure_unit', max_version)
    logger.info("[sync_measure_units] watermark обновлён: %s → %s", watermark, max_version)

    return len(staged)
