# Phase B3 — DishCategory → staging_dish_categories

## Зачем
ABC-анализ и маржинальность по категориям меню (пиццы, салаты, напитки и т.д.).

## Файлы

### 1. `src/sync_dish_categories.py` — НОВЫЙ

```python
async def sync_dish_categories(...) -> int:
```

### 2. `src/transform.py` — ДОБАВИТЬ

```python
def transform_dish_category(data: dict, venue_id: str) -> dict | None:
    qr_id = data.get("id")
    if qr_id is None: return None
    return {
        "source_id": str(qr_id),
        "name": data.get("name", ""),
        "color": data.get("color", ""),
        "parent_id": str(data.get("parentId")) if data.get("parentId") else None,
    }
```

## DDL

```sql
CREATE TABLE IF NOT EXISTS staging_dish_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL,
    venue_id    TEXT,
    source_id   TEXT NOT NULL,
    name        TEXT,
    color       TEXT,
    parent_id   TEXT,
    imported_at TEXT DEFAULT (datetime('now'))
);
```

## DoD
- [ ] 32 категории в staging (совпадает с recon)
- [ ] parent_id корректно обрабатывает иерархию
