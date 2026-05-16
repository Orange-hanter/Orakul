# TASK-029 — Спроектировать CI/CD Pipeline

| Поле | Значение |
|------|----------|
| Phase | 4 |
| Тип | Документ |
| Приоритет | P0 |
| Размер | M |
| Ответственный (R) | DevOps Lead |
| Подотчётный (A) | Tech Lead |
| Зависимости | TASK-028 |
| Связанные KPI | — |
| Статус | pending |

## Описание

Дизайн пайплайна сборки, тестирования, деплоя: триггеры, шаги, тестовые гейты, секреты, откат. Конкретная реализация — в Sprint 0; на этом этапе — дизайн.

## Структура документа

1. Технологический выбор (GitHub Actions / GitLab CI / Jenkins / ArgoCD …)
2. Стадии пайплайна:
   - Build
   - Static analysis (lint, type check)
   - Unit-тесты
   - Integration-тесты
   - Security scan (SAST, dependency check)
   - Сборка артефактов (Docker / package)
   - Deploy в Dev
   - E2E на Dev
   - Promotion в Staging (manual gate)
   - Deploy в Prod (manual gate)
3. Стратегия деплоя (blue-green / canary / rolling)
4. Стратегия отката
5. Управление секретами в пайплайне

## Критерии приёмки

- [ ] Описаны все стадии пайплайна с триггерами
- [ ] Описаны гейты (тесты, ревью, security scan)
- [ ] Описана стратегия деплоя и отката
- [ ] Согласовано с QA (тестовые гейты) и Security (security gates)
- [ ] Документ в статусе `✅ Утверждён`

## Артефакт

`docs/08-technical/12-cicd-design.md`.

## Связанные документы

- [Env Plan](TASK-028.md)
- [Test Strategy](../phase-3-testing/TASK-023.md)
- [Security Design](../phase-1-tech-docs/TASK-014.md)

## Риски и блокеры

- Слишком сложный pipeline на старте → замедление команды. Принцип: начать с минимального рабочего, итеративно усиливать.
