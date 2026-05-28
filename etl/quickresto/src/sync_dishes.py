"""
Sync: Dish + CookingInvoice (QuickResto) → staging_dishes + staging_recipes (Orakul).

Modules:
  - warehouse.nomenclature.dish
  - warehouse.documents.cooking

Важно: рецептуры хранятся в CookingInvoice, НЕ в Dish!
"""

import logging
from typing import List

from client import QuickRestoClient
from db import DbConnection
from transform import map_dish, map_recipes_from_cooking_invoice

logger = logging.getLogger(__name__)


async def sync_dishes(client: QuickRestoClient, db: DbConnection, venue_id: str = '', etl_run_id: str = '') -> int:
    """
    Выгружает Dish и CookingInvoice.
    Dish → staging_dishes; CookingInvoice → staging_recipes.
    
    Returns: общее количество staging-записей (dishes + recipes).
    """
    total = 0

    # ── A. Синхронизация Dish ──────────────────────────────────────
    dish_module = 'warehouse.nomenclature.dish'
    logger.info("[sync_dishes] Начало синхронизации блюд: %s", dish_module)
    dishes = await client.list_entities(module_name=dish_module)

    if dishes:
        await db.insert_raw('dish', dishes, etl_run_id, venue_id)
        mapped_dishes = [map_dish(d, venue_id) for d in dishes]

        db_backend = db._backend
        if db_backend == 'sqlite':
            sql = """
                INSERT OR REPLACE INTO staging_dishes
                (source_id, name, code, unit, category, qr_data, venue_id, imported_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """
        else:
            sql = """
                INSERT INTO staging_dishes
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

        import json as _json
        dish_records = [
            (m['source_id'], m['name'], m['code'], m['unit'], m['category'],
             _json.dumps(m['qr_data'], ensure_ascii=False) if db_backend == 'sqlite' else m['qr_data'],
             m['venue_id'])
            for m in mapped_dishes
        ]
        await db.insert_many(sql, dish_records)
        total += len(dish_records)
        logger.info("[sync_dishes] staging dishes: %s", len(dish_records))
    else:
        logger.warning("[sync_dishes] Dish: пустой ответ от QR")

    # ── B. Синхронизация CookingInvoice → recipes ───────────────────
    cook_module = 'warehouse.documents.cooking'
    logger.info("[sync_dishes] Синхронизация рецептур: %s", cook_module)
    cooking_invoices = await client.list_entities(module_name=cook_module)

    if cooking_invoices:
        await db.insert_raw('cooking_invoice', cooking_invoices, etl_run_id, venue_id)

        all_recipes: List[dict] = []
        for inv in cooking_invoices:
            recipes = map_recipes_from_cooking_invoice(inv, venue_id)
            all_recipes.extend(recipes)

        if all_recipes:
            db_backend = db._backend
            if db_backend == 'sqlite':
                sql = """
                    INSERT OR REPLACE INTO staging_recipes
                    (dish_source_id, ingredient_source_id, quantity, unit, venue_id, imported_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                """
            else:
                sql = """
                    INSERT INTO staging_recipes
                    (dish_source_id, ingredient_source_id, quantity, unit, venue_id, imported_at)
                    VALUES ($1, $2, $3, $4, $5, NOW())
                    ON CONFLICT (dish_source_id, ingredient_source_id, venue_id) DO UPDATE SET
                      quantity=EXCLUDED.quantity,
                      unit=EXCLUDED.unit,
                      imported_at=NOW()
                """

            recipe_records = [
                (r['dish_source_id'], r['ingredient_source_id'], r['quantity'],
                 r['unit'], r['venue_id'])
                for r in all_recipes
            ]
            await db.insert_many(sql, recipe_records)
            total += len(recipe_records)
            logger.info("[sync_dishes] staging recipes: %s", len(recipe_records))
    else:
        logger.warning("[sync_dishes] CookingInvoice: пустой ответ от QR")

    logger.info("[sync_dishes] Итого staging записей: %s", total)
    return total
