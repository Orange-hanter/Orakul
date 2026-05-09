---
Документ: Индекс трассировки (Traceability Index)
Версия: 1.0
Дата: 2026-05-07
Статус: Утверждён
Владелец: PMO + Продакт
Связанные документы: все
---

# Индекс трассировки

> Ответ на вопрос «где находится X»: KPI, требование, риск, решение. Один проход — и понимаешь, как связаны все документы.

---

## 1. Карта документов

```
README.md
└── docs/
    ├── 01-strategy/
    │   ├── 01-vision-and-strategy.md         — Vision, Mission, Tenets, North Star
    │   ├── 02-market-and-competitive-analysis.md  — TAM/SAM/SOM, конкуренты, SWOT
    │   └── 03-go-to-market.md                — ICP, каналы, воронка, Pilot Program
    │
    ├── 02-business/
    │   ├── 01-business-requirements-document.md   — BRD: цели, KPI, scope, процессы
    │   ├── 02-kpi-framework-and-dashboard.md      — Реестр KPI, формулы, дашборды
    │   └── 03-okrs-2026.md                        — OKR на 4 квартала 2026
    │
    ├── 03-product/
    │   ├── 01-product-requirements-document.md    — PRD: модули, состояния, RBAC
    │   ├── 02-user-stories.md                     — User Stories US-01..US-08
    │   ├── 03-user-journey-maps.md                — Пути пользователей по ролям
    │   └── 04-bdd-acceptance-scenarios.md         — Given/When/Then критерии
    │
    ├── 04-implementation/
    │   ├── 01-roadmap.md                          — Этапы E1..E5, релизы R1..R4, gates G1..G4
    │   ├── 02-raci-matrix.md                      — Матрица R/A/C/I
    │   ├── 03-change-management-plan.md           — ADKAR, чемпионы, сопротивление
    │   ├── 04-data-audit-checklist-kiepper.md     — Проверки данных + baseline
    │   ├── 05-communications-plan.md              — Cadence, шаблоны, кризис
    │   └── 06-vendor-and-partner-management.md    — Управление партнёрами
    │
    ├── 05-governance/
    │   ├── 01-risk-register.md                    — R-01..R-15 с митигациями
    │   ├── 02-stakeholder-register.md             — Стейкхолдеры, влияние, стратегии
    │   ├── 03-data-governance.md                  — Доступ, хранение, удаление, комплаенс
    │   ├── 04-change-request-template.md          — Шаблон CR
    │   └── 05-decision-log.md                     — Реестр решений
    │
    ├── 06-financial/
    │   ├── 01-business-case-and-roi.md            — Кейс клиента + наша unit economics
    │   └── 02-pricing-and-commercial-model.md     — Тарифы, скидки, контракт
    │
    └── 07-references/
        ├── 01-glossary.md                         — Глоссарий
        └── 02-traceability-index.md               — (этот документ)
```

---

## 2. Трассировка: KPI → User Story → Функциональность

| KPI (BRD §2) | Связанные User Stories | Модуль (PRD) | Релиз |
|--------------|------------------------|--------------|-------|
| BIZ-01 % списаний к обороту | US-01, US-02 | M1 Запасы | R1 (MVP) |
| BIZ-02 Откл. факта от плана закупок | US-03 | M2 Закупки | R1 (MVP) |
| BIZ-03 Маржинальность меню | US-05, US-06 | M3 Экономика | R1 (US-05) / R3 (US-06) |
| BIZ-04 Часы на отчётность | US-07 | M4 Контроль | R1 (MVP) |
| BIZ-05 MAPE прогноза | (ядро всех US) | Платформа | R1 (MVP) |
| BIZ-06 Стоп-листы | US-01 | M1 Запасы | R1 (MVP) |
| BIZ-07 Закупочные затраты | US-04 | M2 Закупки | R3 |
| NSM-01 ARAR | US-08 (объяснимость) | Все модули | R1 (MVP) |
| PROD-01..06 Продуктовые | US-08 | Платформа | R1 (MVP) |

---

## 3. Трассировка: Этап → Артефакты → Подписи

| Этап Roadmap | Gating-критерий | Артефакт | Кто подписывает |
|---------------|------------------|----------|------------------|
| E1 Диагностика | Audit Report + Baseline | [Data Audit Checklist §6](../04-implementation/04-data-audit-checklist-kiepper.md) | Финконтролёр клиента + PMO + IT-владелец Kiepper |
| E2 Пилот | ARAR≥60%, BIZ-05 MAPE≤15% | KPI-отчёт пилота, кейс-отчёт | PO + CSM + Опердир клиента |
| E3 Масштабирование | Все плановые точки активны, регламенты приняты | Регламенты, протокол обучения | Опердир клиента + PMO |
| E4 Стабилизация | KPI стабильны 2 мес, инцидентов P1 нет | Акт приёмки | Спонсор + Опердир + Финконтролёр |
| E5 Сопровождение | QBR ежеквартально, NRR≥110% | QBR-отчёты | Управляющий комитет |

---

## 4. Трассировка: Риск → Митигация → Документ

| Риск (Risk Register) | Митигация | Где описана |
|----------------------|-----------|--------------|
| R-01 Kiepper выпускает свой ИИ | Партнёрство, углубление сценариев | [GTM §4.2](../01-strategy/03-go-to-market.md), [Market Analysis §7](../01-strategy/02-market-and-competitive-analysis.md) |
| R-02 Сопротивление персонала | ADKAR, чемпионы, ритуалы | [Change Management Plan](../04-implementation/03-change-management-plan.md) |
| R-03 Pilot → Paid <60% | Pilot Program, ROI-калькулятор | [GTM §6](../01-strategy/03-go-to-market.md), [Business Case & ROI](../06-financial/01-business-case-and-roi.md) |
| R-04 Качество данных Kiepper | Data Audit Checklist | [Data Audit Checklist](../04-implementation/04-data-audit-checklist-kiepper.md) |
| R-05 Нестабильность API Kiepper | Партнёрский SLA, мониторинг свежести | [PRD §8](../03-product/01-product-requirements-document.md), [Vendor Management](../04-implementation/06-vendor-and-partner-management.md) |
| R-06 Утечка данных | Шифрование, RBAC, аудит | [Data Governance](../05-governance/03-data-governance.md), [PRD §7](../03-product/01-product-requirements-document.md) |
| R-07 Нарушение комплаенса | DPA, минимизация PII | [Data Governance](../05-governance/03-data-governance.md) |
| R-08 Нехватка CSM | План найма, playbook | [GTM §10](../01-strategy/03-go-to-market.md) |
| R-10 Чрезмерное доверие к ИИ | Recommend-don't-act, Override Rate | [PRD §3](../03-product/01-product-requirements-document.md), [KPI PROD-01](../02-business/02-kpi-framework-and-dashboard.md) |
| R-15 Bus factor | Документация, парность ролей | [RACI](../04-implementation/02-raci-matrix.md), внутренняя политика |

---

## 5. Трассировка: Принцип Vision → Реализация

| Принцип Vision | Реализация в продукте | Документ |
|----------------|------------------------|----------|
| Built on Kiepper, not against | Чтение по API; запись только черновиков | [PRD §8](../03-product/01-product-requirements-document.md) |
| Explainability over magic | Поле «Обоснование» в каждой рекомендации | [PRD §3](../03-product/01-product-requirements-document.md), US-08 |
| Bias to recommendation, not automation | Все действия требуют подтверждения | [PRD §3](../03-product/01-product-requirements-document.md), [RBAC §7](../03-product/01-product-requirements-document.md) |
| Operator-first UX | Mobile-first для управляющего | [PRD §10](../03-product/01-product-requirements-document.md), [Journey Maps](../03-product/03-user-journey-maps.md) |
| Measurable or it didn't happen | Каждая US привязана к KPI | [User Stories](../03-product/02-user-stories.md), [KPI Framework](../02-business/02-kpi-framework-and-dashboard.md) |

---

## 6. Трассировка: Стейкхолдер → Что он читает

| Стейкхолдер | Документы (приоритет) |
|-------------|------------------------|
| CEO / Спонсор | Vision → BRD (§§ 1, 2, 10, 11) → Business Case → OKR → Roadmap |
| Опердир клиента | BRD → Roadmap → RACI → Change Management → KPI Framework |
| Финконтролёр клиента | BRD §2 → KPI Framework → Business Case → Data Audit |
| Управляющий точкой | User Journey Maps → US-01, US-02, US-03 → Change Management |
| Закупщик | US-03, US-04 → Journey Maps → KPI BIZ-02, BIZ-07 |
| Шеф-повар | US-02, US-05 → Journey Maps → Change Management |
| IT-владелец Kiepper | PRD §8 → Data Audit → Data Governance → Vendor Management |
| Юрист / Безопасник | Data Governance → BRD §7 → Risk Register R-06, R-07 |
| Команда продукта | PRD → User Stories → BDD → Roadmap |
| PMO | Roadmap → RACI → Risk Register → Communications Plan → Decision Log |

---

## 7. Жизненный цикл документа

```
Draft → On Review → Approved → Active → Archived
   ↓                    ↑
   ↓____ изменение ____↑ (через Change Request)
```

**Правила:**
1. Любое значимое изменение Approved-документа = CR + Decision Log + инкремент версии.
2. Изменения <минорных формулировок (опечатки, форматирование) — без CR, но с инкрементом patch-версии.
3. Document owner ответственен за актуальность; PMO — за инкс трассировки.

---

## 8. Метрики качества документации

| Метрика | Цель | Как измеряем |
|---------|------|---------------|
| Покрытие требований BRD трассировкой к US | 100% | Аудит ежеквартально |
| Покрытие US критериями приёмки (BDD) | 100% | Аудит ежеквартально |
| Все KPI имеют формулу + источник + владельца | 100% | Аудит ежеквартально |
| Все риски в Risk Register имеют митигацию + владельца | 100% | Аудит ежемесячно |
| Все Approved-документы актуализированы за последние 12 мес | ≥95% | Аудит ежемесячно |

---

## 9. Changelog

| Версия | Дата | Автор | Изменения |
|--------|------|-------|-----------|
| 1.0 | 2026-05-07 | PMO + Продакт | Первая утверждённая редакция |
