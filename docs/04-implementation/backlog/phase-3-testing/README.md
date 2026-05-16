# Phase 3 — Стратегия тестирования

**Цель модуля.** Определить, как мы проверяем, что продукт работает корректно и соответствует требованиям: уровни тестирования, инструменты, план тестирования интеграции, UAT, data quality и performance.

**Срок:** 1 календарная неделя (параллельно с Phase 2).  
**Статус:** pending (см. [Progress Tracker](../progress.md)).

---

## Артефакт-итог фазы

Test Strategy + 4 Test Plans в папке `docs/08-technical/`.

---

## Состав задач (порядок выполнения)

| # | Задача | Тип | Размер | Зависит от |
|---|--------|-----|--------|------------|
| 1 | [TASK-023](TASK-023.md) — Test Strategy | Документ | M | TASK-010, 011 |
| 2 | [TASK-024](TASK-024.md) — Integration Test Plan | Документ | M | TASK-012, 023 |
| 2 | [TASK-025](TASK-025.md) — UAT Plan | Документ | S | TASK-023 |
| 2 | [TASK-026](TASK-026.md) — Data Quality Validation Plan | Документ | S | TASK-013 |
| 2 | [TASK-027](TASK-027.md) — Performance Test Plan | Документ | S | TASK-023 |

> TASK-024 … 027 можно начинать параллельно после TASK-023.

---

## Параллелизм

Phase 3 идёт параллельно с [Phase 2](../phase-2-decomposition/), [Phase 4](../phase-4-environments/) и [Phase 5](../phase-5-pilot/). Все зависят от Phase 1.

## Выход из фазы

Все 5 документов утверждены, ссылки добавлены в [README](../../../../README.md). Финальная проверка — в [Phase 6](../phase-6-sprint0/).
