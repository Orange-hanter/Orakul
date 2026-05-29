# Phase D (rev.2) — run_sync.py порядок + Watermark + App Integration

## ⚠️ Изменения после код-ревью
- Watermark ключи: `cooking_invoice`, `semiproduct`, `dish_category`, `measure_unit`, `concrete_provider`, `outgoing_invoice`, `cancellation`, `shift` (все БЕЗ суффикса `_version`)
- Добавлен `_sync_entity_raw_only()` для сущностей без staging
- Исправлен вызов `sync_dishes` — теперь с `class_name`
- Добавлена пагинация через `PAGE_SIZE`

## 1. Порядок вызовов в run_sync.py

```python
async def run_sync():
    # ... setup ...
    
    try:
        async with QuickRestoClient() as client:
            # === Phase A: Master data (no deps) ===
            await _sync_raw_only("company", client.list_company_info)
            await _sync_raw_only("business", client.list_businesses)
            await _sync_with_staging("measure_unit", client.list_measure_units, sync_measure_units)
            await _sync_with_staging("dish_category", client.list_dish_categories, sync_dish_categories)
            await _sync_with_staging("store", client.list_stores, sync_stores)
            
            # === Phase B: Products & Nomenclature ===
            await _sync_with_staging("product", client.list_ingredients, sync_products)
            await _sync_with_staging("semiproduct", client.list_semiproducts, sync_semiproducts)
            await _sync_with_staging("dish", client.list_dishes, sync_dishes)
            
            # === Phase C: Suppliers ===
            await _sync_raw_only("supplier", client.list_providers)
            await _sync_with_staging("concrete_provider", client.list_concrete_providers, sync_concrete_providers)
            
            # === Phase D: Documents (depend on stores, products, suppliers) ===
            await _sync_raw_only("incoming_invoice", client.list_incoming_invoices)
            await _sync_with_staging("outgoing_invoice", client.list_outgoing_invoices, sync_outgoing_invoices)
            await _sync_raw_only("discard_invoice", client.list_discard_invoices)
            await _sync_with_staging("cooking_invoice", client.list_cooking_invoices, sync_cooking_invoices)
            await _sync_raw_only("decomposition_invoice", client.list_decomposition_invoices)
            await _sync_raw_only("processing_invoice", client.list_processing_invoices)
            await _sync_raw_only("inventory", client.list_inventory)
            
            # === Phase E: Front / Revenue ===
            await _sync_with_staging("shift", client.list_shifts, sync_shifts)
            await _sync_raw_only("order_info", client.list_orders)
            await _sync_with_staging("cancellation", client.list_cancellations, sync_cancellations)
            
            # === Phase F: Personnel ===
            await _sync_raw_only("employee", client.list_employees)
            
    except Exception as e:
        # ... error handling ...
```

## 2. Хелперы

```python
async def _sync_raw_only(entity: str, fetch_func):
    """Sync только в raw_imports, без staging."""
    items = await fetch_func()
    if items:
        db.insert_raw(entity, items, run_id, venue_id)

async def _sync_with_staging(entity: str, fetch_func, sync_func):
    """Sync в raw + staging через dedicated sync module."""
    n = await sync_func(client, db, venue_id, run_id)
    total_staging += n
```

## 3. Пагинация

```python
# В client.py — уже есть limit/offset. Добавить в sync-функции:
async def _sync_all_pages(entity, fetch_func, sync_func):
    offset = 0
    total = 0
    while True:
        items = await fetch_func(limit=config.PAGE_SIZE, offset=offset)
        if not items:
            break
        n = await sync_func(items)
        total += n
        if len(items) < config.PAGE_SIZE:
            break
        offset += config.PAGE_SIZE
    return total
```

## 4. Raw-only сущности (явно помечены)

| Сущность | Причина raw-only |
|----------|------------------|
| DecompositionInvoice | Редкая операция, не нужна для P&L |
| ProcessingInvoice | Редкая операция |
| OrderInfo | Shift уже даёт revenue; OrderInfo = детализация для Phase 2 |

## 5. App Integration

```javascript
// app/shared/etlReader.js — НОВЫЙ
export async function readRevenueFromETL(dbPath) {
    // sqlite3 read: SELECT date(start_date) as day, SUM(total) 
    // FROM core_revenue_entries GROUP BY day
}
```

## DoD
- [ ] run_sync.py проходит end-to-end ≤60 секунд (с пагинацией)
- [ ] Нет ошибок при повторном run (idempotent)
- [ ] Все watermark корректны (без _version суффикса)
