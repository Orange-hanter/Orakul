"""
Sync: Shift (QuickResto) → raw_imports + staging_shifts.

Module: front.zreport
Class: ru.edgex.quickresto.modules.front.zreport.Shift

Revenue = totalCash + totalCard + totalBonuses - returns.
Only CLOSED shifts count (opened = current shift, incomplete).
"""

import logging
from typing import List

from client import QuickRestoClient
from db import OrakulDB
from transform import transform_shift

logger = logging.getLogger(__name__)


async def sync_shifts(client: QuickRestoClient, db: OrakulDB, venue_id: str = '', etl_run_id: str = '') -> int:
    """
    Выгружает Shift из QR (инкрементально, по version) → raw + staging.
    Returns: количество staging-записей (только closed).
    """
    module = 'front.zreport'
    class_name = 'ru.edgex.quickresto.modules.front.zreport.Shift'
    watermark = db.get_watermark('shift')
    logger.info("[sync_shifts] Начало синхронизации: %s (since_version=%s)", module, watermark)

    items = await client.list_entities(
        module_name=module,
        class_name=class_name,
        since_version=watermark,
    )
    if not items:
        logger.info("[sync_shifts] Нет новых записей для %s", module)
        return 0

    # 1. Raw dump (все, включая opened)
    db.insert_raw('shift', items, etl_run_id, venue_id)
    logger.info("[sync_shifts] raw: %s записей", len(items))

    # 2. Watermark — максимальная version среди ВСЕХ смен
    max_version = max((int(i.get('version', 0)) for i in items), default=watermark)
    db.set_watermark('shift', max_version)
    logger.info("[sync_shifts] watermark: %s → %s", watermark, max_version)

    # 3. Transform → staging (только closed)
    staged = []
    skipped_open = 0
    for item in items:
        status = item.get('status', '')
        if status == 'OPENED':
            skipped_open += 1
            continue

        t = transform_shift(item, venue_id)
        if not t:
            continue

        # Revenue fields из raw
        revenue = (
            (item.get('totalCash', 0) or 0) +
            (item.get('totalCard', 0) or 0) +
            (item.get('totalBonuses', 0) or 0) -
            (item.get('totalReturnCash', 0) or 0) -
            (item.get('totalReturnCard', 0) or 0) -
            (item.get('totalReturnBonuses', 0) or 0)
        )

        staged.append({
            'run_id': etl_run_id,
            'venue_id': venue_id,
            'source_id': str(item.get('id', '')),
            'shift_number': item.get('shiftNumber'),
            'opened_at': item.get('opened', ''),
            'closed_at': item.get('closed', ''),
            'status': status,
            'total_cash': item.get('totalCash', 0),
            'total_card': item.get('totalCard', 0),
            'total_bonuses': item.get('totalBonuses', 0),
            'return_cash': item.get('totalReturnCash', 0),
            'return_card': item.get('totalReturnCard', 0),
            'return_bonuses': item.get('totalReturnBonuses', 0),
            'orders_count': item.get('ordersCount', 0),
            'revenue': round(revenue, 2),
        })

    # 4. Upsert staging
    if staged:
        db.upsert_staging('shifts', staged)
        logger.info("[sync_shifts] staging: %s записей (пропущено opened: %s)", len(staged), skipped_open)
    else:
        logger.info("[sync_shifts] staging: нет закрытых смен")

    return len(staged)
