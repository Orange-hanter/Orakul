"""
Sync: ConcreteProvider (QuickResto) → raw_imports + staging_concrete_providers.

Module: warehouse.providers.concrete
Class: ru.edgex.quickresto.modules.warehouse.providers.concrete.ConcreteProvider

Note: ConcreteProvider and Organization (provider_org) may overlap.
Deduplication handled at core merge stage.
"""

import logging
from client import QuickRestoClient
from db import OrakulDB

logger = logging.getLogger(__name__)


def transform_concrete_provider(data: dict, venue_id: str) -> dict | None:
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None
    return {
        "source_id": str(qr_id),
        "full_name": data.get("fullName", ""),
        "short_name": data.get("shortName", data.get("name", "")) or "",
        "address": data.get("address", ""),
        "egais_status": data.get("egaisStatus", ""),
    }


async def sync_concrete_providers(client: QuickRestoClient, db: OrakulDB, venue_id: str = '', etl_run_id: str = '') -> int:
    """
    Выгружает ConcreteProvider из QR (инкрементально, по version) → raw + staging.
    """
    module = 'warehouse.providers.concrete'
    class_name = 'ru.edgex.quickresto.modules.warehouse.providers.concrete.ConcreteProvider'
    watermark = db.get_watermark('concrete_provider')

    if db.has_raw_data('concrete_provider') and watermark > 0:
        logger.info("[sync_concrete_providers] Статическая сущность уже загружена (watermark=%s), пропускаем", watermark)
        return 0

    logger.info("[sync_concrete_providers] Начало синхронизации: %s (since_version=%s)", module, watermark)

    items = await client.list_entities(
        module_name=module,
        class_name=class_name,
        since_version=watermark,
    )
    if not items:
        logger.info("[sync_concrete_providers] Нет новых записей для %s", module)
        return 0

    # 1. Raw dump
    db.insert_raw('concrete_provider', items, etl_run_id, venue_id)
    logger.info("[sync_concrete_providers] raw: %s записей", len(items))

    # 2. Transform → staging
    staged = []
    for item in items:
        t = transform_concrete_provider(item, venue_id)
        if not t:
            continue
        staged.append({
            'run_id': etl_run_id,
            'venue_id': venue_id,
            'source_id': t['source_id'],
            'full_name': t['full_name'],
            'short_name': t['short_name'],
            'address': t['address'],
            'egais_status': t['egais_status'],
        })

    # 3. Upsert staging
    if staged:
        db.upsert_staging('concrete_providers', staged)
        logger.info("[sync_concrete_providers] staging: %s записей", len(staged))
    else:
        logger.info("[sync_concrete_providers] staging: нет записей после трансформации")

    # 4. Watermark
    max_version = max((int(i.get('version', 0)) for i in items), default=watermark)
    db.set_watermark('concrete_provider', max_version)
    logger.info("[sync_concrete_providers] watermark: %s → %s", watermark, max_version)

    return len(staged)
