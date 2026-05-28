"""
Transform layer: QuickResto API records → Orakul data model.

Каждая функция принимает raw dict из QR API
и возвращает dict(ы) в формате Orakul (или None при skip).

UUID-генерация: uuid5(NAMESPACE_DNS, f"qr-{record_type}-{qr_id}")
чтобы при повторном импорте ID оставались стабильными.

Dependencies: uuid (stdlib)
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from uuid import UUID, uuid5, NAMESPACE_DNS

logger = logging.getLogger(__name__)

# ── UUID helpers ──────────────────────────────────────────────

def _make_uuid(record_type: str, qr_id: str | int | None) -> str:
    """Детерминированный UUID из QR id."""
    if qr_id is None:
        raise ValueError("qr_id is None")
    return str(uuid5(NAMESPACE_DNS, f"qr-{record_type}-{qr_id}"))


def _unwrap_ref(ref_dict: dict | None) -> dict:
    """Извлекает {id, name} из nested ref-объекта QR."""
    if not isinstance(ref_dict, dict):
        return {}
    return {
        "id": ref_dict.get("id"),
        "name": ref_dict.get("name", ref_dict.get("shortName", "")),
    }

# ── Venue ───────────────────────────────────────────────────────

def transform_company(data: dict, venue_id: str | None = None) -> dict | None:
    """
    CompanyInfo → venue
    """
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    return {
        "type": "venue",
        "id": venue_id or _make_uuid("company", qr_id),
        "name": data.get("name", "Моцарелла"),
        "isDefault": True,
    }

# ── Products (SingleProduct / SemiProduct) ──────────────────────

def transform_product(data: dict, venue_id: str) -> dict | None:
    """
    SingleProduct / SemiProduct → product
    """
    if not data or not isinstance(data, dict):
        return None

    # Пропускаем категории (они идут вместе с продуктами)
    class_name = data.get("className", "")
    if "Category" in class_name:
        return None

    qr_id = data.get("id")
    if qr_id is None:
        return None

    measure = _unwrap_ref(data.get("measureUnit"))
    category_name = data.get("itemTitle", data.get("name", ""))

    return {
        "type": "product",
        "id": _make_uuid("product", qr_id),
        "venueId": venue_id,
        "name": data.get("name", category_name),
        "unit": measure.get("name", "кг"),
        "category": category_name,
    }

# ── Dishes ──────────────────────────────────────────────────────

def transform_dish(data: dict, venue_id: str) -> dict | None:
    """
    Dish (с ingredients из recipe) → dish
    """
    if not data or not isinstance(data, dict):
        return None

    # Пропускаем категории
    class_name = data.get("className", "")
    if "Category" in class_name:
        return None

    qr_id = data.get("id")
    if qr_id is None:
        return None

    measure = _unwrap_ref(data.get("measureUnit"))

    # Ингредиенты: из dish.modifierLinks[]
    # В QR рецептура хранится в modifierLinks — массив с полями:
    #   {product: {id, name}, quantity, measureUnit}
    ingredients = []
    for mod in data.get("modifierLinks", []):
        if not isinstance(mod, dict):
            continue
        product_ref = _unwrap_ref(mod.get("product"))
        qty = mod.get("quantity", 0)
        if product_ref.get("id") and qty:
            ingredients.append({
                "productId": _make_uuid("product", product_ref["id"]),
                "quantity": float(qty),
            })

    # Альтернативно: recipe может быть строкой (plain text)
    recipe_text = data.get("recipe", "")
    if recipe_text and not ingredients:
        # Парсим текстовый рецепт (fallback)
        ingredients = _parse_recipe(recipe_text)

    return {
        "type": "dish",
        "id": _make_uuid("dish", qr_id),
        "venueId": venue_id,
        "name": data.get("name", ""),
        "category": data.get("itemTitle", data.get("category", "")) or "",
        "active": data.get("displayOnTerminal", True) is not False,
        "sellPrice": data.get("basePriceInList", 0) or data.get("minimalPrice", 0) or 0,
        "ingredients": ingredients,
    }


def _parse_recipe(recipe: str) -> list[dict]:
    """
    Парсит текстовый рецепт формата:
      'ингредиент - 0.5 кг'
    Возвращает [{productId: ?, quantity: ?}] — productId будет None, нужно match по имени.
    """
    ingredients = []
    if not recipe:
        return ingredients
    # Простейший парсинг: каждая строка — 'название - количество ед'
    for line in recipe.strip().split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Ищем паттерн: текст - число единица
        m = re.match(r"(.+?)\s*[-–]\s*(\d+[.,]?\d*)\s*(.*)", line)
        if m:
            name, qty_str, unit = m.groups()
            try:
                qty = float(qty_str.replace(",", "."))
            except ValueError:
                qty = 0
            ingredients.append({
                "productName": name.strip(),
                "quantity": qty,
                "unit": unit.strip() or "кг",
                "productId": None,  # нужно match по имени
            })
    return ingredients

# ── Suppliers ───────────────────────────────────────────────────

def transform_supplier(data: dict) -> dict | None:
    """
    Organization (provider) → supplier
    """
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    name = data.get("name", data.get("shortName", "Поставщик без имени"))
    return {
        "type": "supplier",
        "id": _make_uuid("supplier", qr_id),
        "name": name,
        "contact": data.get("phone", data.get("email", "")),
        "tags": [],
        "status": "active" if data.get("deleted") is not True else "paused",
    }


def transform_supplier_item(data: dict, supplier_id: str, product_map: dict[str, str] | None = None) -> dict | None:
    """
    ConcreteProvider (организация-поставщик-магазин) → supplier_item
    """
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    measure = _unwrap_ref(data.get("measureUnit"))
    name = data.get("name", data.get("itemTitle", ""))

    # Ищем productId по имени если передан маппинг
    product_id = None
    if product_map and name:
        product_id = product_map.get(name)

    return {
        "type": "supplier_item",
        "id": _make_uuid("supplier_item", qr_id),
        "supplierId": supplier_id,
        "productId": product_id,
        "itemName": name,
        "unit": measure.get("name", "кг"),
        "price": data.get("price", 0) or 0,
        "currency": "BYN",  # QR работает в БЕЛ КОП
        "minQty": 0,
        "deliveryDays": 1,
    }

# ── Orders / Incoming (Receipt) ─────────────────────────────────

def transform_incoming_invoice(data: dict, venue_id: str) -> tuple[dict, list[dict]] | None:
    """
    IncomingInvoice → (order, [stock_entry, ...])

    Возвращает кортеж: (order_dict, [stock_entry, ...])
    Если приход уже обработан (processed=True) — stock_entry создаём.
    """
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    provider = _unwrap_ref(data.get("provider"))
    store = _unwrap_ref(data.get("store"))
    date_str = data.get("invoiceDate", "")

    # Order
    order = {
        "type": "order",
        "id": _make_uuid("order", qr_id),
        "venueId": venue_id,
        "supplierId": _make_uuid("supplier", provider.get("id")) if provider.get("id") else None,
        "number": data.get("documentNumber", f"QR-{qr_id}"),
        "status": "received" if data.get("processed") else "submitted",
        "totalAmount": data.get("totalSum", 0) or data.get("totalSumWoNds", 0) or 0,
        "currency": "BYN",
        "desiredDate": date_str[:10] if date_str else None,
        "receivedAt": date_str if data.get("processed") else None,
        "items": [],  # QR API не возвращает линии в list, нужно /api/read
    }

    # Stock entry — receipt при processed
    stock_entries = []
    if data.get("processed"):
        stock_entries.append({
            "type": "stock_entry",
            "id": _make_uuid("stock_receipt", qr_id),
            "venueId": venue_id,
            # productId будет None — нужно парсить линии из /api/read
            "productId": None,
            "kind": "receipt",
            "delta": data.get("totalAmount", 0) or 0,
            "resulting": None,  # нужно вычислять
            "source": "integration",
            "externalId": str(qr_id),
            "note": f"Приход {data.get('documentNumber', '')} от {provider.get('name', '')}",
        })

    return order, stock_entries

# ── Discard Invoice (Writeoff) ──────────────────────────────────

def transform_discard_invoice(data: dict, venue_id: str) -> dict | None:
    """
    DiscardInvoice → stock_entry (kind=writeoff)
    """
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    reason = _unwrap_ref(data.get("discardReason"))
    store = _unwrap_ref(data.get("store"))
    date_str = data.get("invoiceDate", "")

    return {
        "type": "stock_entry",
        "id": _make_uuid("stock_discard", qr_id),
        "venueId": venue_id,
        "productId": None,  # нужно парсить линии из /api/read
        "kind": "writeoff",
        "delta": -(data.get("totalAmount", 0) or 0),
        "resulting": None,
        "source": "integration",
        "externalId": str(qr_id),
        "note": f"Списание {data.get('documentNumber', '')}: {data.get('comment', '') or reason.get('name', '')}",
    }

# ── Inventory ───────────────────────────────────────────────────

def transform_inventory(data: dict, venue_id: str) -> dict | None:
    """
    InventoryDocument2 → stock_entry (kind=inventory)
    """
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    date_str = data.get("invoiceDate", "")
    shortfall = data.get("shortfallSum", 0) or 0
    surplus = data.get("surplusSum", 0) or 0

    return {
        "type": "stock_entry",
        "id": _make_uuid("stock_inventory", qr_id),
        "venueId": venue_id,
        "productId": None,
        "kind": "inventory",
        "delta": -(shortfall) + surplus,  # отрицательная = недостача, положительная = излишек
        "resulting": data.get("totalAmount", 0) or 0,
        "source": "integration",
        "externalId": str(qr_id),
        "note": f"Инвентаризация {data.get('documentNumber', '')}: {data.get('comment', '')}"[:500],
    }

# ── Revenue (OrderInfo) ─────────────────────────────────────────

def transform_order_info(data: dict, venue_id: str) -> dict | None:
    """
    OrderInfo (чек) → revenue_entry

    Пока упрощённо: считаем что каждый OrderInfo = 1 запись revenue
    с суммой totalSum за дату.
    """
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    date_str = data.get("openDate", data.get("closeDate", ""))
    total = data.get("totalSum", 0) or data.get("totalSumWoNds", 0) or 0

    return {
        "type": "revenue_entry",
        "id": _make_uuid("revenue", qr_id),
        "venueId": venue_id,
        "date": date_str[:10] if date_str else None,
        "amount": total,
        "source": "quickresto",
        "externalId": str(qr_id),
    }

# ── Dish Sales ──────────────────────────────────────────────────

def transform_dish_sale(data: dict, venue_id: str) -> dict | None:
    """
    OrderInfo.items[] / dishSales → dish_sale

    QR не возвращает dish_sales напрямую — они вычисляются из OrderInfo.
    Эта функция принимает один элемент "line" из чека.
    """
    if not data or not isinstance(data, dict):
        return None
    dish_ref = _unwrap_ref(data.get("dish"))
    qr_id = data.get("id")
    if not dish_ref.get("id") or qr_id is None:
        return None

    date_str = data.get("date", data.get("closeDate", ""))

    return {
        "type": "dish_sale",
        "id": _make_uuid("dish_sale", qr_id),
        "venueId": venue_id,
        "dishId": _make_uuid("dish", dish_ref["id"]),
        "date": date_str[:10] if date_str else None,
        "count": data.get("quantity", 1),
    }

# ── Cancellation → stock_entry ──────────────────────────────────

def transform_cancellation(data: dict, venue_id: str) -> dict | None:
    """
    Cancellation → stock_entry (kind=writeoff)  
    """
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    return {
        "type": "stock_entry",
        "id": _make_uuid("stock_cancel", qr_id),
        "venueId": venue_id,
        "productId": None,
        "kind": "writeoff",
        "delta": 0,
        "resulting": None,
        "source": "integration",
        "externalId": str(qr_id),
        "note": f"Отмена: {data.get('comment', '') or data.get('description', '')}"[:500],
    }

# ── Batch helpers ───────────────────────────────────────────────

def transform_products(raw_items: list[dict], venue_id: str) -> list[dict]:
    """Список SingleProduct/SemiProduct → product[]"""
    result = []
    for item in raw_items:
        t = transform_product(item, venue_id)
        if t:
            result.append(t)
    return result


def transform_dishes(raw_items: list[dict], venue_id: str) -> list[dict]:
    """Список Dish → dish[]"""
    result = []
    for item in raw_items:
        t = transform_dish(item, venue_id)
        if t:
            result.append(t)
    return result


def transform_suppliers(raw_items: list[dict]) -> list[dict]:
    """Список Organization → supplier[]"""
    result = []
    for item in raw_items:
        t = transform_supplier(item)
        if t:
            result.append(t)
    return result


def transform_incoming_invoices(raw_items: list[dict], venue_id: str) -> tuple[list[dict], list[dict]]:
    """Список IncomingInvoice → (orders[], stock_entries[])"""
    orders = []
    entries = []
    for item in raw_items:
        res = transform_incoming_invoice(item, venue_id)
        if res:
            o, se = res
            orders.append(o)
            entries.extend(se)
    return orders, entries


def transform_discard_invoices(raw_items: list[dict], venue_id: str) -> list[dict]:
    return [t for t in (transform_discard_invoice(i, venue_id) for i in raw_items) if t]


def transform_inventories(raw_items: list[dict], venue_id: str) -> list[dict]:
    return [t for t in (transform_inventory(i, venue_id) for i in raw_items) if t]


def transform_order_infos(raw_items: list[dict], venue_id: str) -> list[dict]:
    return [t for t in (transform_order_info(i, venue_id) for i in raw_items) if t]


def transform_cancellations(raw_items: list[dict], venue_id: str) -> list[dict]:
    return [t for t in (transform_cancellation(i, venue_id) for i in raw_items) if t]


# ── Diagnostic ────────────────────────────────────────────────

if __name__ == "__main__":
    # Smoke test
    print("Transform module loaded. UUID namespace:", NAMESPACE_DNS)
    print("UUID example:", _make_uuid("product", 123))
