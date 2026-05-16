# Phase 4 — Окружения и юридика

**Цель модуля.** Подготовить технические окружения (Dev/Staging/Prod), CI/CD, observability и юридический контур (Vendor Agreement с Quick Resto, NDA/DPA с пилотами).

**Срок:** 1 календарная неделя (параллельно с Phase 2).  
**Статус:** pending (см. [Progress Tracker](../progress.md)).

---

## Артефакт-итог фазы

- Развёрнутое Dev-окружение, готовое к Sprint 0
- Подписанные договоры с Quick Resto и пилотными клиентами
- 3 утверждённых документа: Env Plan, CI/CD Design, Observability Plan

---

## Состав задач (порядок выполнения)

| # | Задача | Тип | Размер | Зависит от |
|---|--------|-----|--------|------------|
| 1 | [TASK-028](TASK-028.md) — Environment Plan | Документ | S | TASK-011 |
| 2 | [TASK-029](TASK-029.md) — CI/CD Pipeline Design | Документ | M | TASK-028 |
| 2 | [TASK-030](TASK-030.md) — Observability Plan | Документ | S | TASK-011 |
| 1 | [TASK-031](TASK-031.md) — Vendor Agreement Quick Resto | Юридика | L | TASK-001 |
| 3 | [TASK-032](TASK-032.md) — NDA + DPA с пилотными | Юридика | M | TASK-034 |
| 4 | [TASK-033](TASK-033.md) — Развернуть Dev-окружение | Инфра | M | TASK-028, 029 |

> TASK-031 (Vendor Agreement) — независимая юридическая дорожка, может стартовать сразу после TASK-001.  
> TASK-032 зависит от TASK-034 (выбор пилотной точки) из Phase 5.

---

## Параллелизм

Phase 4 идёт параллельно с [Phase 2](../phase-2-decomposition/), [Phase 3](../phase-3-testing/) и [Phase 5](../phase-5-pilot/). Все зависят от Phase 1.

## Выход из фазы

Все задачи в статусе `done`, Dev-окружение принимает первые PR от команды. Финальная проверка — в [Phase 6](../phase-6-sprint0/).
