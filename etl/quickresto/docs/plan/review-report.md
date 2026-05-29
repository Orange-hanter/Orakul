# Код-ревью плана — Orakul ETL QuickResto Integration

**Дата:** 2026-05-29
**Ревьюер:** DeepSeek v4 Pro (subagent)
**Объект:** docs/plan/ (11 файлов) + src/*.py (5 ключевых файлов)

---

## Резюме

**Оценка готовности: 65%**
План требует незначительной доработки (8 пунктов). Архитектура корректна, проблемы — на уровне согласования с существующим кодом.

---

## Найденные проблемы

### 🔴 Проблема 1: `staging_recipes` — расхождение DDL план vs код
| Аспект | Код (`db_sqlite.py`) | План (B1) |
|---|---|---|
| `measure_unit` | **Отсутствует** | `TEXT DEFAULT 'кг'` |
| Индексы | `ix_staging_recipe_run` | `ix_staging_recipe_dish`, `ix_staging_recipe_product` |
| `UNIQUE` в `core_recipes` | БЕЗ `venue_id` | С `venue_id` |

**Исправление:** Убрана колонка `measure_unit` из плана. Watermark без `_version`.

---

### 🔴 Проблема 2: Новые staging-таблицы не поддерживаются в `upsert_staging()`
Существующий `upsert_staging()` использует жёсткий `if/elif`. Поддерживает только:
`staging_products`, `staging_dishes`, `staging_recipes`, `staging_suppliers`, `staging_incoming_invoices`, `staging_stores`.

План добавляет 7 новых таблиц — каждая требует новый `elif` + DDL.

**Исправление:** Добавлено примечание в каждый phase-B документ + phase-C core-merge.

---

### 🔴 Проблема 3: Новые core-таблицы не поддерживаются в `merge_core()`
`merge_core()` покрывает только `products`, `dishes`, `suppliers`, `stock_entries`, `recipes`, `stores`.

**Исправление:** Phase-C обновлён с явным списком core таблиц и примечанием о расширении `merge_core()`.

---

### 🔴 Проблема 4: Несогласованность watermarks
План B1 использовал `cooking_invoice_version`, код использует `'product'`, `'dish'` (без суффикса).

**Исправление:** Все watermark ключи в плане обновлены: `cooking_invoice`, `semiproduct`, `dish_category`, `measure_unit`, `concrete_provider`, `outgoing_invoice`, `cancellation`, `shift`.

---

### 🔴 Проблема 5: DecompositionInvoice / ProcessingInvoice — raw-only без явной пометки
План включал их в recon и run_sync, но не давал B-фазу.

**Исправление:** Phase-D обновлён с `_sync_raw_only()` хелпером и явным списком raw-only сущностей.

---

### 🟡 Проблема 6: OrderInfo — raw-only, не документировано
Аналогично проблеме 5.

**Исправление:** Явно помечен как raw-only в Phase-D.

---

### 🟡 Проблема 7: `sync_dishes.py` — отсутствует `class_name`
```python
dishes = await client.list_entities(module_name=module, since_version=watermark)
```
`list_entities` требует `class_name`.

**Исправление:** Добавлено примечание в Phase-D: `sync_dishes` нужно исправить при реализации.

---

### 🟡 Проблема 8: `transform_semiproduct` — не уточнён источник ingredients
План предлагает `json.dumps([...])` без конкретики извлечения из recon.

**Исправление:** Оставлено на Phase A (recon покажет структуру).

---

## Дополнения / улучшения (от ревьюера)

1. **Пагинация:** Добавить цикл с `offset`/`limit` (config.PAGE_SIZE=100). Phase-D обновлён.
2. **Watermark для B3-B8:** Все получили watermark. Phase-D обновлён.
3. **Названия core-таблиц:** `core_revenue_entries` допустимо, задокументировано.
4. **`_sync_entity_raw_only()` хелпер:** Добавлен в Phase-D.
5. **Per-record error handling:** Для B1 (CookingInvoice) — рекомендовано, не блокер.

---

## Можно ли B3-B7 параллелить?

**Да.** Все независимы друг от друга (master data или document-level). 
Условие: Phase A и B (product, dish) завершены до параллельного запуска.

Оптимальный граф:
```
Parallel: [B3, B4, B5, B6, B7]  # dish_category, measure_unit, concrete_provider, outgoing, cancellation
После них: B1 (recipes — зависит от dish, product, measure_unit)
После B1: B2 (semiproduct)
После B1-B2: B8 (shift)
```

---

## Что исправлено в плане (рев.2)

| # | Исправление | Где |
|---|-------------|-----|
| 1 | Убрана `measure_unit` из staging_recipes | phase-b1-cooking-invoice.md |
| 2 | Watermark без `_version` | phase-b1, phase-d |
| 3 | Добавлено примечение об `upsert_staging()` | все phase-b*.md |
| 4 | `_sync_raw_only()` + raw-only список | phase-d-run-sync-app.md |
| 5 | Пагинация через PAGE_SIZE | phase-d |
| 6 | `sync_dishes` class_name fix note | phase-d |
| 7 | `merge_core()` расширение note | phase-c-core-merge.md |

---

## Статус после ревью

**План готов к реализации** после внесения 7 исправлений (все уже внесены в рев.2).
