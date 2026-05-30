"""
Sync: Dish (QuickResto) → raw_imports + staging_dishes.

Module: warehouse.nomenclature.dish

NOTE: Рецептуры (CookingInvoice) отключены — нужен recon дамп.
      Раскомментировать блок B когда будет data/recon/cooking_invoice.json.
"""

import logging
from client import QuickRestoClient
from db import OrakulDB
from transform import transform_dish

logger = logging.getLogger(__name__)


async def sync_dishes(client: QuickRestoClient, db: OrakulDB, venue_id: str = '', etl_run_id: str = '') -> int:
    """
    Выгружает Dish из QR (инкрементально) и пишет в raw_imports + staging_dishes.
    Returns: количество staging-записей.
    """
    module = 'warehouse.nomenclature.dish'
    watermark = db.get_watermark('dish')
    logger.info("[sync_dishes] Начало синхронизации: %s (since_version=%s)", module, watermark)

    dishes = await client.list_entities(
        module_name=module,
        class_name='ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish',
        since_version=watermark,
    )
    if not dishes:
        logger.info("[sync_dishes] Нет новых записей для %s", module)
        return 0

    # 1. Raw dump
    db.insert_raw('dish', dishes, etl_run_id, venue_id)
    logger.info("[sync_dishes] raw: %s записей", len(dishes))

    # 2. Обновляем watermark
    max_version = max((int(d.get('version', 0)) for d in dishes), default=watermark)
    db.set_watermark('dish', max_version)
    logger.info("[sync_dishes] watermark обновлён: %s → %s", watermark, max_version)

    # 3. Transform → staging
    staged = []
    for d in dishes:
        t = transform_dish(d, venue_id)
        if not t:
            continue
        staged.append({
            'run_id': etl_run_id,
            'venue_id': venue_id,
            'source_id': str(d.get('id', '')),
            'name': t['name'],
            'code': d.get('code', ''),
            'unit': 'порц',
            'category': t.get('category', ''),
        })

    # 4. Upsert staging
    db.upsert_staging('dishes', staged)
    logger.info("[sync_dishes] staging: %s записей", len(staged))
    return len(staged)
