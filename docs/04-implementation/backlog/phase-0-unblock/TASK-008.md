# TASK-008 — (Условно) Создать Change Request к BRD при дефиците API-функций

| Поле | Значение |
|------|----------|
| Phase | 0 |
| Тип | Документ |
| Приоритет | P0 |
| Размер | S |
| Ответственный (R) | Владелец продукта |
| Подотчётный (A) | Спонсор проекта |
| Зависимости | TASK-006 (выполняется только при вердикте «Go with CR» или «No-Go») |
| Связанные KPI | — |
| Статус | pending |

## Описание

**Условная задача.** Выполняется только если TASK-006 закрылся вердиктом «Go with CR» или «No-Go». Цель — оформить формальное изменение скоупа BRD: либо исключить недоступные User Stories, либо описать альтернативную интеграцию (ручная выгрузка, интеграция через UI бэк-офиса, договорённость с Quick Resto о расширении API).

## Критерии приёмки

- [ ] Change Request оформлен по [шаблону](../../../05-governance/04-change-request-template.md)
- [ ] Указаны: исходное требование BRD, предлагаемое изменение, обоснование, влияние на KPI/Roadmap/ROI
- [ ] CR утверждён спонсором проекта (подпись в Decision Log)
- [ ] Затронутые документы обновлены:
  - [BRD](../../../02-business/01-business-requirements-document.md)
  - [PRD](../../../03-product/01-product-requirements-document.md) (если изменился скоуп User Stories)
  - [User Stories](../../../03-product/02-user-stories.md)
  - [Roadmap](../../01-roadmap.md) (если сдвигаются сроки)
- [ ] Запись в [Decision Log](../../../05-governance/05-decision-log.md)

## Артефакт

`docs/05-governance/cr/CR-XXX-phase-0-api-gap.md` + обновлённые ссылочные документы.

## Связанные документы

- [Change Request Template](../../../05-governance/04-change-request-template.md)
- [Decision Log](../../../05-governance/05-decision-log.md)
- [BRD](../../../02-business/01-business-requirements-document.md)

## Риски и блокеры

- Сильное изменение скоупа может потребовать пересмотра [Business Case & ROI](../../../06-financial/01-business-case-and-roi.md) — заложить в CR оценку финансового влияния.
- Сдвиг Roadmap >2 недель — отдельный CR к Roadmap.
