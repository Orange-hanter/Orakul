"""
Transform — маппинг сущностей QuickResto → Orakul staging.

Конвенция именования:
  QR   (source)   →   Orakul (target)
  SingleProduct   →   product
  Dish            →   dish
  Store           →   venue
  CookingInvoice  →   recipe (dish ↔ ingredients)
  OrderInfo       →   dish_sale / revenue_entry
  IncomingInvoice →   order
  DiscardInvoice  →   writeoff
  InventoryDocument2 → stock_entry (inventory)
"""

from typing import Any, Dict, List


def _safe_get(obj: dict, *keys: str, default: Any = '') -> Any:
    """Безопасное вложенное извлечение."""
    current = obj
    for key in keys:
        if isinstance(current, dict):
            current = current.get(key, default)
        else:
            return default
    return current if current is not None else default


def map_single_product(qr: dict, venue_id: str = '') -> dict:
    """SingleProduct → product (ингредиент)."""
    mu = _safe_get(qr, 'measureUnit')
    if isinstance(mu, dict):
        unit = mu.get('name', '')
    elif isinstance(mu, str):
        unit = mu
    else:
        unit = ''
    return {
        'source_id': str(qr.get('id', '')),
        'name':      str(qr.get('name', '')),
        'code':      str(qr.get('code', '')),
        'unit':      unit,
        'category':  str(qr.get('category', '')),
        'qr_data':   qr,
        'venue_id':  venue_id,
    }


def map_dish(qr: dict, venue_id: str = '') -> dict:
    """Dish → dish (блюдо)."""
    return {
        'source_id': str(qr.get('id', '')),
        'name':      str(qr.get('name', '')),
        'code':      str(qr.get('code', '')),
        'unit':      str(qr.get('measureName', '')),
        'category':  str(qr.get('category', '')),
        'qr_data':   qr,
        'venue_id':  venue_id,
    }


def map_store(qr: dict, venue_id: str = '') -> dict:
    """Store (warehouse) → venue (склад/точка)."""
    return {
        'source_id': str(qr.get('id', '')),
        'name':      str(qr.get('name', '')),
        'code':      str(qr.get('code', '')),
        'venue_id':  venue_id,
    }


def map_recipes_from_cooking_invoice(qr: dict, venue_id: str = '') -> List[dict]:
    """
    CookingInvoice → list of recipe lines (dish ↔ ingredients).

    Структура CookingInvoice:
      {
        'id': str,
        'dishId': str,  # или invoiceComponents[0].dishId
        'invoiceComponents': [
          {
            'dishId':     str,
            'productId':  str,   # ингредиент
            'amount':     float,
            'measureUnit': str|dict,
            ...
          }
        ]
      }

    Возвращает список dict'ов для staging_recipes.
    """
    recipes: List[Dict[str, Any]] = []
    inv_comps = _safe_get(qr, 'invoiceComponents', default=[])

    for comp in inv_comps:
        if not isinstance(comp, dict):
            continue
        # Порой dishId в компоненте, порой на верхнем уровне
        dish_id = comp.get('dishId') or qr.get('dishId') or qr.get('resultingProducts', [{}])[0].get('id', '')
        product_id = comp.get('productId', '')
        if not (dish_id and product_id):
            continue
        amt = comp.get('amount', 0)
        # measureUnit может быть dict
        mu = comp.get('measureUnit', '')
        if isinstance(mu, dict):
            mu = mu.get('name', '')
        recipes.append({
            'dish_source_id':     str(dish_id),
            'ingredient_source_id': str(product_id),
            'quantity':           float(amt),
            'unit':               str(mu),
            'venue_id':           venue_id,
        })

    return recipes
