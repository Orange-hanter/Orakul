# Phase B6 — OutgoingInvoice → staging_outgoing_invoices

## Зачем
Расходные накладные = убыток товара (не списание, а отгрузка). Нужно для полного учёта движения товаров.

## Файлы

### 1. `src/sync_outgoing_invoices.py` — НОВЫЙ

### 2. `src/transform.py` — ДОБАВИТЬ

```python
def transform_outgoing_invoice(data: dict, venue_id: str) -> dict | None:
    qr_id = data.get("id")
    if qr_id is None: return None
    store = _unwrap_ref(data.get("store"))
    return {
        "source_id": str(qr_id),
        "doc_number": data.get("documentNumber", ""),
        "doc_date": _parse_date(data.get("documentDate")),
        "store_id": str(store.get("id")) if store.get("id") else None,
        "store_name": store.get("name", ""),
        "total_sum": float(data.get("totalSum", 0)),
        "items_json": json.dumps(data.get("items", [])),
    }
```

## DDL

```sql
CREATE TABLE IF NOT EXISTS staging_outgoing_invoices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL,
    venue_id    TEXT,
    source_id   TEXT NOT NULL,
    doc_number  TEXT,
    doc_date    TEXT,
    store_id    TEXT,
    store_name  TEXT,
    total_sum   REAL,
    items_json  TEXT,
    imported_at TEXT DEFAULT (datetime('now'))
);
```

## DoD
- [ ] OutgoingInvoice в raw + staging
- [ ] items_json валидный JSON (line items)
