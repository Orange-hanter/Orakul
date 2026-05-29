# Phase B8 — Shift → staging_shifts (Revenue)

## Зачем
Кассовые смены = единственный источник выручки. Без этого P&L невозможен.

## Файлы

### 1. `src/sync_shifts.py` — НОВЫЙ

### 2. `src/transform.py` — ДОБАВИТЬ

```python
def transform_shift(data: dict, venue_id: str) -> dict | None:
    qr_id = data.get("id")
    if qr_id is None: return None
    return {
        "source_id": str(qr_id),
        "start_date": _parse_dt(data.get("startDate")),
        "end_date": _parse_dt(data.get("endDate")),
        "total": float(data.get("total", 0)),
        "cash": float(data.get("cash", 0)),
        "card": float(data.get("card", 0)),
        "currency": data.get("currency", "BYN"),
        "shift_number": data.get("shiftNumber", ""),
    }
```

## DDL

```sql
CREATE TABLE IF NOT EXISTS staging_shifts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id       TEXT NOT NULL,
    venue_id     TEXT,
    source_id    TEXT NOT NULL,
    start_date   TEXT,
    end_date     TEXT,
    total        REAL,
    cash         REAL,
    card         REAL,
    currency     TEXT DEFAULT 'BYN',
    shift_number TEXT,
    imported_at  TEXT DEFAULT (datetime('now'))
);
```

## DoD
- [ ] Shift в raw + staging
- [ ] total = cash + card (валидировать)
- [ ] Группировка по дням: SELECT date(start_date), SUM(total)
