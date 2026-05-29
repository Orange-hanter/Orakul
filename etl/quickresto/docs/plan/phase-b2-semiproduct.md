# Phase B2 — Semiproduct → staging_semiproducts

## Зачем
Полуфабрикаты = связующее звено между ингредиентами и блюдами. Некоторые блюда используют semiproduct как ingredient.

## Файлы

### 1. `src/sync_semiproducts.py` — НОВЫЙ

```python
async def sync_semiproducts(
    client: QuickRestoClient, db: OrakulDB, venue_id: str = '', etl_run_id: str = ''
) -> int:
```

### 2. `src/transform.py` — ДОБАВИТЬ

```python
def transform_semiproduct(data: dict, venue_id: str) -> dict | None:
    qr_id = data.get("id")
    if qr_id is None: return None
    return {
        "type": "semiproduct",
        "id": _make_uuid("semiproduct", qr_id),
        "venueId": venue_id,
        "name": data.get("name", data.get("itemTitle", "")) or "Без названия",
        "unit": _unwrap_ref(data.get("measureUnit")).get("name") or "кг",
        "ingredients_json": json.dumps([...]),  # ingredients[] как JSON
    }
```

## DDL

```sql
CREATE TABLE IF NOT EXISTS staging_semiproducts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT NOT NULL,
    venue_id         TEXT,
    source_id        TEXT NOT NULL,
    name             TEXT,
    unit             TEXT,
    ingredients_json TEXT,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_semiprod_run ON staging_semiproducts(run_id);
CREATE INDEX IF NOT EXISTS ix_staging_semiprod_source ON staging_semiproducts(source_id);
```

## DoD
- [ ] Recon: 6 semiproducts в raw_imports
- [ ] Staging: 6 записей в staging_semiproducts
- [ ] ingredients_json валидный JSON
