# Phase B5 — ConcreteProvider → staging_concrete_providers

## Зачем
Organization = юрлицо, ConcreteProvider = конкретный поставщик (может быть несколько на одно юрлицо). Нужно для точного учёта поставок.

## Файлы

### 1. `src/sync_concrete_providers.py` — НОВЫЙ

### 2. `src/transform.py` — ДОБАВИТЬ

```python
def transform_concrete_provider(data: dict, venue_id: str) -> dict | None:
    qr_id = data.get("id")
    if qr_id is None: return None
    org = _unwrap_ref(data.get("organization"))
    return {
        "source_id": str(qr_id),
        "name": data.get("name", org.get("name", "")),
        "organization_id": str(org.get("id")) if org.get("id") else None,
        "contact": data.get("contactInfo", ""),
        "status": "active",  # QR не хранит статус
    }
```

## DDL

```sql
CREATE TABLE IF NOT EXISTS staging_concrete_providers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT NOT NULL,
    venue_id        TEXT,
    source_id       TEXT NOT NULL,
    name            TEXT,
    organization_id TEXT,
    contact         TEXT,
    status          TEXT DEFAULT 'active',
    imported_at     TEXT DEFAULT (datetime('now'))
);
```

## DoD
- [ ] ConcreteProvider связан с Organization через organization_id
- [ ] Дедупликация по source_id + venue_id
