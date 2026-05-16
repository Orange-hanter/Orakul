---
Документ: Delivery Backlog — Progress Tracker
Версия: 1.0
Дата: 2026-05-15
Статус: Активный (обновляется по мере выполнения задач)
Владелец: PMO
Связанные документы: [Backlog README](README.md), [Task Standard](../templates/task-template.md)
---

# Progress Tracker — журнал выполнения задач

> **Назначение.** Единая точка состояния всех задач бэклога. Обновляется при каждом изменении статуса задачи. Карточка самой задачи остаётся источником истины по её содержанию; этот файл — источник истины по её статусу и срокам.

---

## Сводная статистика

| Фаза | Всего | `pending` | `in_progress` | `blocked` | `review` | `done` | `cancelled` |
|------|-------|-----------|---------------|-----------|----------|--------|-------------|
| Phase 0 — Разблокировка | 8 | 8 | 0 | 0 | 0 | 0 | 0 |
| Phase 1 — Тех. документация | 7 | 7 | 0 | 0 | 0 | 0 | 0 |
| Phase 2 — Декомпозиция | 7 | 7 | 0 | 0 | 0 | 0 | 0 |
| Phase 3 — Тестирование | 5 | 5 | 0 | 0 | 0 | 0 | 0 |
| Phase 4 — Окружения | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| Phase 5 — Пилот | 5 | 5 | 0 | 0 | 0 | 0 | 0 |
| Phase 6 — Sprint 0 | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| **ИТОГО** | **40** | **40** | **0** | **0** | **0** | **0** | **0** |

**Прогресс:** 0 / 40 (0%)

---

## Текущие активные задачи

> *Раздел заполняется по мере появления задач в статусах `in_progress`, `blocked`, `review`.*

| ID | Название | Статус | Ответственный | Старт | План завершения |
|----|----------|--------|----------------|-------|------------------|
| — | — | — | — | — | — |

---

## Журнал задач — Phase 0: Разблокировка

| ID | Название | Статус | Ответственный | Старт | Завершение | Артефакт |
|----|----------|--------|----------------|-------|------------|----------|
| [TASK-001](phase-0-unblock/TASK-001.md) | Установить контакт с Quick Resto | pending | PMO | — | — | — |
| [TASK-002](phase-0-unblock/TASK-002.md) | Получить тестовый API-ключ | pending | Tech Lead | — | — | — |
| [TASK-003](phase-0-unblock/TASK-003.md) | Спайк: рецептуры в API | pending | Tech Lead | — | — | — |
| [TASK-004](phase-0-unblock/TASK-004.md) | Спайк: списания в API | pending | Tech Lead | — | — | — |
| [TASK-005](phase-0-unblock/TASK-005.md) | Спайк: глубина истории и rate limits | pending | Tech Lead | — | — | — |
| [TASK-006](phase-0-unblock/TASK-006.md) | Gate-решение Phase 0 | pending | Владелец продукта | — | — | — |
| [TASK-007](phase-0-unblock/TASK-007.md) | Обновить Risk Register | pending | PMO | — | — | — |
| [TASK-008](phase-0-unblock/TASK-008.md) | (Условно) CR к BRD | pending | Владелец продукта | — | — | — |

---

## Журнал задач — Phase 1: Технический контур

| ID | Название | Статус | Ответственный | Старт | Завершение | Артефакт |
|----|----------|--------|----------------|-------|------------|----------|
| [TASK-009](phase-1-tech-docs/TASK-009.md) | Закрыть открытые вопросы PRD §12.2 | pending | Владелец продукта | — | — | — |
| [TASK-010](phase-1-tech-docs/TASK-010.md) | TRD | pending | Tech Lead | — | — | — |
| [TASK-011](phase-1-tech-docs/TASK-011.md) | SAD | pending | Архитектор | — | — | — |
| [TASK-012](phase-1-tech-docs/TASK-012.md) | Integration Specification | pending | Tech Lead | — | — | — |
| [TASK-013](phase-1-tech-docs/TASK-013.md) | Data Contract | pending | Data Lead | — | — | — |
| [TASK-014](phase-1-tech-docs/TASK-014.md) | Security & Privacy Design | pending | Безопасник | — | — | — |
| [TASK-015](phase-1-tech-docs/TASK-015.md) | Sign-off Phase 1 | pending | Владелец продукта | — | — | — |

---

## Журнал задач — Phase 2: Декомпозиция

| ID | Название | Статус | Ответственный | Старт | Завершение | Артефакт |
|----|----------|--------|----------------|-------|------------|----------|
| [TASK-016](phase-2-decomposition/TASK-016.md) | Назначить команду разработки | pending | Спонсор | — | — | — |
| [TASK-017](phase-2-decomposition/TASK-017.md) | WBS | pending | Tech Lead | — | — | — |
| [TASK-018](phase-2-decomposition/TASK-018.md) | Backlog в трекере | pending | PMO | — | — | — |
| [TASK-019](phase-2-decomposition/TASK-019.md) | Оценки команды | pending | Tech Lead | — | — | — |
| [TASK-020](phase-2-decomposition/TASK-020.md) | Sprint Plan | pending | PMO | — | — | — |
| [TASK-021](phase-2-decomposition/TASK-021.md) | DoR / DoD | pending | Tech Lead | — | — | — |
| [TASK-022](phase-2-decomposition/TASK-022.md) | Release Plan | pending | PMO | — | — | — |

---

## Журнал задач — Phase 3: Тестирование

| ID | Название | Статус | Ответственный | Старт | Завершение | Артефакт |
|----|----------|--------|----------------|-------|------------|----------|
| [TASK-023](phase-3-testing/TASK-023.md) | Test Strategy | pending | QA Lead | — | — | — |
| [TASK-024](phase-3-testing/TASK-024.md) | Integration Test Plan | pending | QA Lead | — | — | — |
| [TASK-025](phase-3-testing/TASK-025.md) | UAT Plan | pending | QA Lead | — | — | — |
| [TASK-026](phase-3-testing/TASK-026.md) | Data Quality Validation Plan | pending | Data Lead | — | — | — |
| [TASK-027](phase-3-testing/TASK-027.md) | Performance Test Plan | pending | QA Lead | — | — | — |

---

## Журнал задач — Phase 4: Окружения и юридика

| ID | Название | Статус | Ответственный | Старт | Завершение | Артефакт |
|----|----------|--------|----------------|-------|------------|----------|
| [TASK-028](phase-4-environments/TASK-028.md) | Environment Plan | pending | DevOps Lead | — | — | — |
| [TASK-029](phase-4-environments/TASK-029.md) | CI/CD Pipeline Design | pending | DevOps Lead | — | — | — |
| [TASK-030](phase-4-environments/TASK-030.md) | Observability Plan | pending | DevOps Lead | — | — | — |
| [TASK-031](phase-4-environments/TASK-031.md) | Vendor Agreement Quick Resto | pending | Юрист | — | — | — |
| [TASK-032](phase-4-environments/TASK-032.md) | NDA + DPA с пилотными | pending | Юрист | — | — | — |
| [TASK-033](phase-4-environments/TASK-033.md) | Развернуть Dev-окружение | pending | DevOps Lead | — | — | — |

---

## Журнал задач — Phase 5: Пилот

| ID | Название | Статус | Ответственный | Старт | Завершение | Артефакт |
|----|----------|--------|----------------|-------|------------|----------|
| [TASK-034](phase-5-pilot/TASK-034.md) | Выбрать пилотную точку | pending | Опердир | — | — | — |
| [TASK-035](phase-5-pilot/TASK-035.md) | Pilot Plan | pending | PMO | — | — | — |
| [TASK-036](phase-5-pilot/TASK-036.md) | Pilot Success Criteria | pending | Владелец продукта | — | — | — |
| [TASK-037](phase-5-pilot/TASK-037.md) | Rollback Plan | pending | PMO | — | — | — |
| [TASK-038](phase-5-pilot/TASK-038.md) | Onboarding Materials | pending | Владелец продукта | — | — | — |

---

## Журнал задач — Phase 6: Sprint 0 Readiness

| ID | Название | Статус | Ответственный | Старт | Завершение | Артефакт |
|----|----------|--------|----------------|-------|------------|----------|
| [TASK-039](phase-6-sprint0/TASK-039.md) | Финальный review Phase 0–5 | pending | PMO | — | — | — |
| [TASK-040](phase-6-sprint0/TASK-040.md) | Kick-off разработки | pending | PMO | — | — | — |

---

## Журнал блокировок

> *Раздел заполняется при появлении задач в статусе `blocked`.*

| ID | Название | Дата блокировки | Причина | Блокирует | Ожидаемая разблокировка |
|----|----------|-----------------|---------|-----------|--------------------------|
| — | — | — | — | — | — |

---

## Журнал гейтов

| Gate | Задача | Решение | Дата | Запись в Decision Log |
|------|--------|---------|------|------------------------|
| Phase 0 → 1 | TASK-006 | — | — | — |
| Phase 1 → 2 | TASK-015 | — | — | — |
| Все → Phase 6 | TASK-039 | — | — | — |
| Phase 6 → Sprint 0 | TASK-040 | — | — | — |

---

## Как обновлять этот файл

1. **При смене статуса задачи:** обновить статус в карточке задачи `TASK-XXX.md` И в этом файле в соответствующей строке. Дата обновления фиксируется в Changelog.
2. **При завершении задачи:** проставить статус `done`, дату завершения и ссылку на артефакт.
3. **При блокировке:** добавить запись в «Журнал блокировок» с причиной и ожидаемой датой разблокировки.
4. **При прохождении гейта:** заполнить строку в «Журнал гейтов» с ссылкой на запись в Decision Log.
5. **Сводная статистика** в шапке пересчитывается при каждом обновлении.

---

## Changelog

| Версия | Дата | Автор | Изменения |
|--------|------|-------|-----------|
| 1.0 | 2026-05-15 | PMO | Первая редакция, все 40 задач в статусе `pending` |
