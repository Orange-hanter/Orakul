# Orakul ETL — QuickResto Integration Plan (Index)

## Краткое описание
Полный план завершения интеграции QuickResto API в Orakul ETL. Всего 11 фаз (A + B1-B8 + C + D).

## Статус проекта
- **Kiepper:** DEPRECATED — не используется
- **QuickResto:** Единственный источник данных
- **Аккаунт:** vt786.quickresto.ru (Моцарелла)
- **Recon собран:** 14 сущностей (28.05.2026)
- **Staging реализован:** 3 сущности (product, dish, store)
- **Raw собран:** 11 сущностей

## Список фаз

| # | Фаза | Файл | Приоритет | Оценка | Зависимости |
|---|------|------|-----------|--------|-------------|
| A | Recon недостающих сущностей | [phase-a-recon.md](phase-a-recon.md) | 🔴 | 0.5 дня | — |
| B1 | CookingInvoice → staging_recipes | [phase-b1-cooking-invoice.md](phase-b1-cooking-invoice.md) | 🔴🔴🔴 | 0.5 дня | A (cooking recon) |
| B2 | Semiproduct → staging | [phase-b2-semiproduct.md](phase-b2-semiproduct.md) | 🔴 | 0.5 дня | A (semiproduct recon) |
| B3 | DishCategory → staging | [phase-b3-dish-category.md](phase-b3-dish-category.md) | 🟡 | 0.3 дня | A (dish_category recon) |
| B4 | MeasureUnit → staging | [phase-b4-measure-unit.md](phase-b4-measure-unit.md) | 🟡 | 0.3 дня | A (measure_unit recon) |
| B5 | ConcreteProvider → staging | [phase-b5-concrete-provider.md](phase-b5-concrete-provider.md) | 🟡 | 0.3 дня | A (concrete_provider recon) |
| B6 | OutgoingInvoice → staging | [phase-b6-outgoing-invoice.md](phase-b6-outgoing-invoice.md) | 🟡 | 0.3 дня | A (outgoing recon) |
| B7 | Cancellation → staging | [phase-b7-cancellation.md](phase-b7-cancellation.md) | 🟡 | 0.3 дня | A (cancellation recon) |
| B8 | Shift → staging (Revenue) | [phase-b8-shift.md](phase-b8-shift.md) | 🔴 | 0.5 дня | A (shift recon) |
| C | Core Merge + Tests | [phase-c-core-merge.md](phase-c-core-merge.md) | 🟡 | 1 день | B1-B8 |
| D | run_sync.py порядок + App | [phase-d-run-sync-app.md](phase-d-run-sync-app.md) | 🟡 | 0.5 дня | C |

**Итого:** ~4–5 дней работы (последовательно), или 2–3 дня если B3-B7 параллелить.

## Архитектурные принципы
1. **Raw → Staging → Core** — 3 слоя
2. **Инкрементальная sync** — since_version watermark
3. **Dual backend** — SQLite default, PostgreSQL prod
4. **60 RPM** — rate limiting
5. **Idempotent** — повторный run не дублирует

## Контакты / Владелец
- Venue: Моцарелла (vt786.quickresto.ru)
- ETL path: `~/Git/_my/Mozarella/Orakul/etl/quickresto/`

---

## Быстрый старт

```bash
cd ~/Git/_my/Mozarella/Orakul/etl/quickresto

# 1. Phase A — Recon
PYTHONPATH=src python -m src.recon_probe

# 2. Phase B1-B8 — Sync
PYTHONPATH=src python -m src.run_sync

# 3. Phase C — Core merge
# Встроено в run_sync после добавления merge_core()

# 4. Tests
PYTHONPATH=src python -m pytest tests/ -v
```
