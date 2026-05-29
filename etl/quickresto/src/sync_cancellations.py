"""
Sync: Cancellations (QuickResto) → raw_imports + staging_cancellations.

Module: front.cancellations
Class: ru.edgex.quickresto.modules.front.cancellations.Cancellation
"""
import logging

from client import QuickRestoClient
from db import OrakulDB

logger = logging.getLogger(__name__)


async def sync_cancellations(client: QuickRestoClient, db: OrakulDB, venue_id: str = '', etl_run_id: str = '') -> int:
    """
    Выгружает все Cancellations из QR (инкрементально, по version) → raw + staging.
    """
    module = 'front.cancellations'
    class_name = 'ru.edgex.quickresto.modules.front.cancellations.Cancellation'
    watermark = db.get_watermark('cancellation')
    logger.info(
        "[sync_cancellations] Начало синхронизации: %s (since_version=%s)",
        module, watermark,
    )

    items = await client.list_entities(
        module_name=module,
        class_name=class_name,
        since_version=watermark,
    )
    if not items:
        logger.info("[sync_cancellations] Нет новых записей для %s", module)
        return 0

    # 1. Raw dump
    db.insert_raw('cancellation', items, etl_run_id, venue_id)
    logger.info("[sync_cancellations] raw: %s записей", len(items))

    # 2. Transform → staging
    staged = []
    for item in items:
        qr_id = item.get('id')
        if qr_id is None:
            continue

        # Извлекаем reason из cancellationReason.name или comment
        reason = ''
        cancellation_reason = item.get('cancellationReason')
        if isinstance(cancellation_reason, dict):
            reason = cancellation_reason.get('name', '') or ''
        if not reason:
            reason = item.get('comment', '') or ''

        description = item.get('description', '') or ''

        # employee_id: userDocId (сырой id) или employee.id из вложенного объекта
        employee_id = ''
        raw_employee = item.get('employee')
        if isinstance(raw_employee, dict):
            employee_id = str(raw_employee.get('id', '')) or ''
        if not employee_id:
            employee_id = str(item.get('userDocId', '')) or ''

        # created_at: prefer localCreateTime, fallback to serverRegisterTime
        created_at = item.get('localCreateTime', '') or item.get('serverRegisterTime', '') or ''

        staged.append({
            'run_id': etl_run_id,
            'venue_id': venue_id,
            'source_id': str(qr_id),
            'reason': reason,
            'description': description,
            'employee_id': employee_id,
            'table_order_id': str(item.get('tableOrderDocId', '')) or '',
            'created_at': created_at,
        })

    # 3. Upsert staging
    if staged:
        db.upsert_staging('cancellations', staged)
        logger.info("[sync_cancellations] staging: %s записей", len(staged))
    else:
        logger.info("[sync_cancellations] staging: нет записей после трансформации")

    # 4. Watermark
    max_version = max((int(i.get('version', 0)) for i in items), default=watermark)
    db.set_watermark('cancellation', max_version)
    logger.info("[sync_cancellations] watermark: %s → %s", watermark, max_version)

    return len(staged)
