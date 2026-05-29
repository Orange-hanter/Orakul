# Phase B1 (rev.2) — CookingInvoice → staging_recipes

## ⚠️ Изменения после код-ревью
- Убрана колонка `measure_unit` (не существует в текущем DDL)
- Watermark ключ: `cooking_invoice` (без суффикса `_version`)
- Добавлено примечание: нужно расширить `upsert_staging()` в `db_sqlite.py`

## Зачем
Себестоимость блюда = Σ(ингредиент × количество × цена поставщика). Без рецептур себестоимость не считается.

## Файлы

### 1. `src/sync_cooking_invoices.py` — НОВЫЙ

```python
async def sync_cooking_invoices(
    client: QuickRestoClient,
    db: OrakulDB,
    venue_id: str = '',
    etl_run_id: str = ''
) -> int:
    """Выгружает CookingInvoice из QR и пишет в raw + staging_recipes."""
    module = 'warehouse.documents.cooking'
    watermark = db.get_watermark('cooking_invoice')  # ← без _version
    
    invoices = await client.list_cooking_invoices(since_version=watermark)
    if not invoices:
        return 0
    
    # Raw
    db.insert_raw('cooking_invoice', invoices, etl_run_id, venue_id)
    
    # Transform
    staged = []
    for inv in invoices:
        recipes = transform_cooking_invoice(inv, venue_id)
        staged.extend(recipes)
    
    # Staging
    db.upsert_staging('recipes', staged)  # ← требует расширения upsert_staging()
    
    # Watermark
    max_version = max((int(i.get('version', 0)) for i in invoices), default=watermark)
    db.set_watermark('cooking_invoice', max_version)
    
    return len(staged)
```

### 2. `src/transform.py` — ДОБАВИТЬ

```python
def transform_cooking_invoice(data: dict, venue_id: str) -> list[dict]:
    """
    Разворачивает CookingInvoice.items.ingredients в плоский список.
    Returns: [{dish_source_id, product_source_id, quantity}, ...]
    """
    recipes = []
    for item in data.get("items", []):
        dish_id = item.get("productId") or item.get("product", {}).get("id")
        for ing in item.get("ingredients", []):
            recipes.append({
                "dish_source_id": str(dish_id),
                "product_source_id": str(ing.get("productId") or ing.get("product", {}).get("id")),
                "quantity": float(ing.get("quantity", 0)),
                # measure_unit не хранится в staging_recipes (нет колонки)
            })
    return recipes
```

### 3. `src/db_sqlite.py` — ИЗМЕНИТЬ `upsert_staging()`

Добавить `elif table_name == 'recipes':` блок (если ещё нет).

## DDL (текущая — без measure_unit)

```sql
CREATE TABLE IF NOT EXISTS staging_recipes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT,
    venue_id         TEXT,
    dish_source_id   TEXT NOT NULL,
    product_source_id TEXT NOT NULL,
    quantity         REAL,
    imported_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_staging_recipe_run ON staging_recipes(run_id);
```

## DoD
- [ ] `staging_recipes` содержит ≥50 записей после первого run
- [ ] Связь dish↔product работает (JOIN по source_id)
- [ ] Watermark `cooking_invoice` инкрементальный
