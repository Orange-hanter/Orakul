"""Sync: DishCategory (QuickResto) → raw_imports + staging_dish_categories.

Module: warehouse.nomenclature.dish
Class: ru.edgex.quickresto.modules.warehouse.nomenclature.dish.DishCategory
"""

import logging

from client import QuickRestoClient
from db import OrakulDB

logger = logging.getLogger(__name__)


def transform_dish_category(data: dict, venue_id: str) -> dict | None:
    """Transform a single DishCategory dict into staging fields."""
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None
    return {
        "source_id": str(qr_id),
        "name": data.get("name", data.get("itemTitle", "")) or "Категория без названия",
        "color": data.get("color", ""),
    }


async def sync_dish_categories(
    client: QuickRestoClient,
    db: OrakulDB,
    venue_id: str = "",
    etl_run_id: str = "",
) -> int:
    """
    Выгружает все DishCategory из QR и пишет в raw_imports + staging_dish_categories.
    Поддерживает инкрементальную синхронизацию через watermark (version).
    """
    module = "warehouse.nomenclature.dish"
    watermark = db.get_watermark("dish_category")
    logger.info(
        "[sync_dish_categories] Начало синхронизации: %s (since_version=%s)",
        module,
        watermark,
    )

    items = await client.list_entities(
        module_name=module,
        class_name="ru.edgex.quickresto.modules.warehouse.nomenclature.dish.DishCategory",
        since_version=watermark,
    )
    if not items:
        logger.warning("[sync_dish_categories] QR вернул пустой список для %s", module)
        return 0

    # 1. Raw dump
    db.insert_raw("dish_category", items, etl_run_id, venue_id)
    logger.info("[sync_dish_categories] raw: %s записей", len(items))

    # 2. Transform → staging
    staged = []
    for item in items:
        t = transform_dish_category(item, venue_id)
        if not t:
            continue
        staged.append(
            {
                "run_id": etl_run_id,
                "venue_id": venue_id,
                "source_id": t["source_id"],
                "name": t["name"],
                "color": t["color"],
            }
        )

    # 3. Upsert staging
    db.upsert_staging("dish_categories", staged)
    logger.info("[sync_dish_categories] staging: %s записей", len(staged))

    # 4. Watermark
    max_version = max(
        (int(i.get("version", 0)) for i in items), default=watermark
    )
    db.set_watermark("dish_category", max_version)
    logger.info(
        "[sync_dish_categories] watermark обновлён: %s → %s",
        watermark,
        max_version,
    )

    return len(staged)
