# TASK-026 — Создать Data Quality Validation Plan

| Поле | Значение |
|------|----------|
| Phase | 3 |
| Тип | Документ |
| Приоритет | P1 |
| Размер | S |
| Ответственный (R) | Data Lead |
| Подотчётный (A) | Tech Lead |
| Зависимости | TASK-013 |
| Связанные KPI | OPS-05 (свежесть данных), BIZ-05 (точность прогноза) |
| Статус | pending |

## Описание

План валидации качества входных данных из Quick Resto: проверки целостности, актуальности, аномалий. Соответствие [Data Contract](../phase-1-tech-docs/TASK-013.md). Без этого ML-модели обучаются на грязных данных и дают плохие прогнозы.

## Структура документа

1. Цели DQ-валидации
2. Уровни проверок:
   - Schema validation (соответствие Data Contract)
   - Constraint validation (NULL, диапазоны, форматы)
   - Cross-entity validation (FK, ссылочная целостность)
   - Freshness validation (актуальность)
   - Anomaly detection (статистические аномалии)
3. По каждой сущности — правила валидации
4. Реакция на нарушение: alert / skip / fail
5. Метрики качества данных и SLO
6. Дашборд DQ

## Критерии приёмки

- [ ] Для каждой сущности Data Contract определены правила валидации
- [ ] Описаны действия при нарушении качества
- [ ] Метрики качества данных (OPS-05) автоматизированы
- [ ] Согласовано с Data Lead и Tech Lead
- [ ] Документ в статусе `✅ Утверждён`

## Артефакт

`docs/08-technical/09-data-quality-plan.md`.

## Связанные документы

- [Data Contract](../phase-1-tech-docs/TASK-013.md)
- [Data Audit Checklist Kiepper](../../04-data-audit-checklist-kiepper.md)
- [Data Governance](../../../05-governance/03-data-governance.md)

## Риски и блокеры

- Жёсткие правила DQ могут привести к частым false-positive алертам на старте. Заложить настраиваемые пороги.
