# Phase B4 — MeasureUnit → staging_measure_units

## Зачем
Конвертация единиц измерения: кг ↔ г, л ↔ мл, шт. Необходима для корректного расчёта себестоимости.

## Файлы

### 1. `src/sync_measure_units.py` — НОВЫЙ

### 2. `src/transform.py` — ДОБАВИТЬ

```python
def transform_measure_unit(data: dict) -> dict | None:
    qr_id = data.get("id")
    if qr_id is None: return None
    return {
        "source_id": str(qr_id),
        "code": data.get("code", ""),
        "name": data.get("name", ""),
        "full_name": data.get("fullName", ""),
        "parent_ratio": float(data.get("parentRatio", 1.0)),
        "system_unit": data.get("systemUnit", ""),
    }
```

## DDL

```sql
CREATE TABLE IF NOT EXISTS staging_measure_units (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id       TEXT NOT NULL,
    venue_id     TEXT,
    source_id    TEXT NOT NULL,
    code         TEXT,
    name         TEXT,
    full_name    TEXT,
    parent_ratio REAL DEFAULT 1.0,
    system_unit  TEXT,
    imported_at  TEXT DEFAULT (datetime('now'))
);
```

## DoD
- [ ] 4 единицы измерения в staging (кг, шт, л, порц)
- [ ] parent_ratio корректно парсится (1.0 default)
