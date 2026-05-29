# Phase B7 — Cancellations → staging_cancellations

## Зачем
Анализ причин отмен: какие блюда отменяют чаще, какие причины (ошибка кухни, отказ гостя).

## Файлы

### 1. `src/sync_cancellations.py` — НОВЫЙ

### 2. `src/transform.py` — ДОБАВИТЬ

```python
def transform_cancellation(data: dict, venue_id: str) -> dict | None:
    qr_id = data.get("id")
    if qr_id is None: return None
    return {
        "source_id": str(qr_id),
        "date": _parse_date(data.get("date")),
        "order_id": str(data.get("orderId", "")),
        "reason": data.get("reason", ""),
        "amount": float(data.get("amount", 0)),
        "dish_name": data.get("dishName", ""),
    }
```

## DDL

```sql
CREATE TABLE IF NOT EXISTS staging_cancellations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL,
    venue_id    TEXT,
    source_id   TEXT NOT NULL,
    date        TEXT,
    order_id    TEXT,
    reason      TEXT,
    amount      REAL,
    dish_name   TEXT,
    imported_at TEXT DEFAULT (datetime('now'))
);
```

## DoD
- [ ] 470 cancellations из recon в staging
- [ ] Группировка по reason работает (SELECT reason, COUNT(*), SUM(amount))
