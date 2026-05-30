"""
Transform layer: QuickResto API records → Orakul data model.
Updated for real recon data (no OrderInfo available, using Shift for revenue).

Priority: Revenue > Stock > Dishes
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any
from uuid import NAMESPACE_DNS, uuid5

logger = logging.getLogger(__name__)

# ── UUID helpers ──────────────────────────────────────────────

def _make_uuid(record_type: str, qr_id: str | int | None) -> str:
    if qr_id is None:
        raise ValueError("qr_id is None")
    return str(uuid5(NAMESPACE_DNS, f"qr-{record_type}-{qr_id}"))


def _unwrap_ref(ref_dict: dict | None) -> dict:
    if not isinstance(ref_dict, dict):
        return {}
    return {
        "id": ref_dict.get("id"),
        "name": ref_dict.get("name", ref_dict.get("shortName", "")) or "",
    }


def _parse_date(dt_str: str) -> str | None:
    """QR datetime → YYYY-MM-DD."""
    if not dt_str:
        return None
    try:
        return dt_str[:10]
    except:
        return None


def _parse_dt(dt_str: str) -> str | None:
    """Полный ISO datetime."""
    if not dt_str:
        return None
    try:
        # QR: 2026-05-28T19:59:47.000Z
        return dt_str.replace("Z", "+00:00")
    except:
        return dt_str

# ── Venue ─────────────────────────────────────────────────────

def transform_company(data: dict, venue_id: str | None = None) -> dict | None:
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

# ── Products ────────────────────────────────────────────────────

def transform_product(data: dict, venue_id: str) -> dict | None:
    if not data or not isinstance(data, dict):
        return None
    # Пропускаем категории
    if "Category" in data.get("className", ""):
        return None

    qr_id = data.get("id")
    if qr_id is None:
        return None

    measure = _unwrap_ref(data.get("measureUnit"))

    return {
        "type": "product",
        "id": _make_uuid("product", qr_id),
        "venueId": venue_id,
        "name": data.get("name", data.get("itemTitle", "")) or data.get("itemTitle", "Без названия"),
        "unit": measure.get("name") or _map_unit(measure.get("id")) or "кг",
        "category": data.get("itemTitle", ""),
    }


def _map_unit(measure_id: int | None) -> str:
    """Map measure unit id to name."""
    mapping: dict[int | None, str] = {1: "шт", 2: "кг", 3: "л", 4: "порц"}
    return mapping.get(measure_id, "кг")

# ── Dishes ────────────────────────────────────────────────────

def transform_dish(data: dict, venue_id: str) -> dict | None:
    if not data or not isinstance(data, dict):
        return None
    if "Category" in data.get("className", ""):
        return None

    qr_id = data.get("id")
    if qr_id is None:
        return None

    # Ингредиенты из modifierLinks
    ingredients = []
    for mod in data.get("modifierLinks", []):
        if not isinstance(mod, dict):
            continue
        product_ref = mod.get("modifier", {})
        pid = product_ref.get("id")
        if pid:
            ingredients.append({
                "productId": _make_uuid("product", pid),
                "quantity": float(mod.get("minValue", 0) or 0),
            })

    # Цена из dishSales[0].price или basePriceInList
    sell_price = data.get("basePriceInList", 0) or data.get("minimalPrice", 0) or 0
    sales = data.get("dishSales", [])
    if sales and isinstance(sales[0], dict):
        sell_price = sales[0].get("price", sell_price) or sell_price

    return {
        "type": "dish",
        "id": _make_uuid("dish", qr_id),
        "venueId": venue_id,
        "name": data.get("name", data.get("itemTitle", "")) or "Без названия",
        "category": data.get("itemTitle", data.get("name", "")) or "",
        "active": data.get("displayOnTerminal", True) is not False,
        "sellPrice": sell_price,
        "ingredients": ingredients,
    }

# ── Suppliers ───────────────────────────────────────────────────

def transform_supplier(data: dict) -> dict | None:
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    name = data.get("name", data.get("shortName", "Поставщик без имени")) or data.get("shortName", "Поставщик без имени")
    return {
        "type": "supplier",
        "id": _make_uuid("supplier", qr_id),
        "name": name,
        "contact": data.get("phone", data.get("email", "")),
        "tags": [],
        "status": "active" if data.get("deleted") is not True else "paused",
    }

# ── Incoming Invoice → order + stock_entry (receipt) ──────────

def transform_incoming_invoice(data: dict, venue_id: str) -> tuple[dict, list[dict]] | None:
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    provider = _unwrap_ref(data.get("provider"))
    invoice_date = _parse_date(data.get("invoiceDate", ""))

    order_id = _make_uuid("order", qr_id)

    order = {
        "type": "order",
        "id": order_id,
        "venueId": venue_id,
        "supplierId": _make_uuid("supplier", provider["id"]) if provider.get("id") else None,
        "number": data.get("documentNumber", f"QR-{qr_id}"),
        "status": "received" if data.get("processed") else "submitted",
        "totalAmount": data.get("totalSum", 0) or data.get("totalSumWoNds", 0) or 0,
        "currency": "BYN",
        "desiredDate": invoice_date,
        "receivedAt": data.get("invoiceDate") if data.get("processed") else None,
        "items": [],  # Детали через /api/read отдельно
    }

    stock_entries = []
    if data.get("processed"):
        stock_entries.append({
            "type": "stock_entry",
            "id": _make_uuid("stock_receipt", qr_id),
            "venueId": venue_id,
            "productId": None,
            "kind": "receipt",
            "delta": data.get("totalAmount", 0) or 0,
            "resulting": None,
            "source": "quickresto",
            "externalId": str(qr_id),
            "note": f"Приход {data.get('documentNumber', '')} от {provider.get('name', '')}"[:500],
        })

    return order, stock_entries

# ── Discard Invoice → stock_entry (writeoff) ──────────────────

def transform_discard_invoice(data: dict, venue_id: str) -> dict | None:
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    reason = _unwrap_ref(data.get("discardReason"))

    return {
        "type": "stock_entry",
        "id": _make_uuid("stock_discard", qr_id),
        "venueId": venue_id,
        "productId": None,
        "kind": "writeoff",
        "delta": -(data.get("totalAmount", 0) or 0),
        "resulting": None,
        "source": "quickresto",
        "externalId": str(qr_id),
        "note": f"Списание {data.get('documentNumber', '')}: {data.get('comment', '') or reason.get('name', '')}"[:500],
    }

# ── Inventory → stock_entry (inventory) ────────────────────────

def transform_inventory(data: dict, venue_id: str) -> dict | None:
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    shortfall = data.get("shortfallSum", 0) or 0
    surplus = data.get("surplusSum", 0) or 0

    return {
        "type": "stock_entry",
        "id": _make_uuid("stock_inventory", qr_id),
        "venueId": venue_id,
        "productId": None,
        "kind": "inventory",
        "delta": -(shortfall) + surplus,
        "resulting": data.get("totalAmount", 0) or 0,
        "source": "quickresto",
        "externalId": str(qr_id),
        "note": f"Инвентаризация {data.get('documentNumber', '')}: {data.get('comment', '')}"[:500],
    }

# ── Cancellation → stock_entry (writeoff) ─────────────────────

def transform_cancellation(data: dict, venue_id: str) -> dict | None:
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    comment = data.get("comment", "")
    description = data.get("description", "")

    return {
        "type": "stock_entry",
        "id": _make_uuid("stock_cancel", qr_id),
        "venueId": venue_id,
        "productId": None,
        "kind": "writeoff",
        "delta": 0,  # Отмена без списания
        "resulting": None,
        "source": "quickresto",
        "externalId": str(qr_id),
        "note": f"Отмена: {comment or description}"[:500],
    }

# ── Shift → revenue_entry (CRITICAL) ────────────────────────────

def transform_shift(data: dict, venue_id: str) -> dict | None:
    """
    Кассовая смена (Shift) → revenue_entry.

    shift.totalCash + shift.totalCard = дневная выручка.
    shift.ordersCount = количество заказов.
    """
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    closed_date = _parse_date(data.get("closed", ""))
    if not closed_date:
        closed_date = _parse_date(data.get("localClosedTime", ""))
    if not closed_date:
        closed_date = _parse_date(data.get("opened", ""))

    def _safe_float(val) -> float:
        try:
            return float(val) if val is not None else 0.0
        except (TypeError, ValueError):
            return 0.0

    def _safe_int(val) -> int:
        try:
            return int(val) if val is not None else 0
        except (TypeError, ValueError):
            return 0

    revenue = (
        _safe_float(data.get("totalCash")) +
        _safe_float(data.get("totalCard")) +
        _safe_float(data.get("totalBonuses")) -
        _safe_float(data.get("totalReturnCash")) -
        _safe_float(data.get("totalReturnCard")) -
        _safe_float(data.get("totalReturnBonuses"))
    )
    revenue = max(revenue, 0.0)

    return {
        "type": "revenue_entry",
        "id": _make_uuid("shift", qr_id),
        "venueId": venue_id,
        "date": closed_date,
        "amount": round(revenue, 2),
        "source": "quickresto",
        "externalId": str(qr_id),
        "meta": {
            "ordersCount": _safe_int(data.get("ordersCount")),
            "shiftNumber": _safe_int(data.get("shiftNumber")),
            "totalCash": _safe_float(data.get("totalCash")),
            "totalCard": _safe_float(data.get("totalCard")),
            "nonFiscalTotalCash": _safe_float(data.get("nonFiscalTotalCash")),
        },
    }


# ── Employee ──────────────────────────────────────────────────

def transform_employee(data: dict) -> dict | None:
    if not data or not isinstance(data, dict):
        return None
    qr_id = data.get("id")
    if qr_id is None:
        return None

    return {
        "type": "employee",
        "id": _make_uuid("employee", qr_id),
        "name": data.get("fullName", data.get("shortName", "")),
        "role": data.get("systemEmployee", ""),
    }

# ── Batch helpers ───────────────────────────────────────────────

def transform_products(raw_items: list[dict], venue_id: str) -> list[dict]:
    return [t for t in (transform_product(i, venue_id) for i in raw_items) if t]


def transform_dishes(raw_items: list[dict], venue_id: str) -> list[dict]:
    return [t for t in (transform_dish(i, venue_id) for i in raw_items) if t]


def transform_suppliers(raw_items: list[dict]) -> list[dict]:
    return [t for t in (transform_supplier(i) for i in raw_items) if t]


def transform_incoming_invoices(raw_items: list[dict], venue_id: str) -> tuple[list[dict], list[dict]]:
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


def transform_cancellations(raw_items: list[dict], venue_id: str) -> list[dict]:
    return [t for t in (transform_cancellation(i, venue_id) for i in raw_items) if t]


def transform_shifts(raw_items: list[dict], venue_id: str) -> list[dict]:
    """Смены → revenue_entry[]"""
    return [t for t in (transform_shift(i, venue_id) for i in raw_items) if t]


def transform_employees(raw_items: list[dict]) -> list[dict]:
    return [t for t in (transform_employee(i) for i in raw_items) if t]
