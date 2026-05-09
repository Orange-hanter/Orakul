---
Документ: Глоссарий
Версия: 1.0
Дата: 2026-05-07
Статус: Утверждён
Владелец: PMO + Продакт
Связанные документы: все
---

# Глоссарий

> Единый словарь терминов проекта. **Источник правды для бизнес-смыслов.** Все остальные документы используют термины строго в значении этого глоссария. Изменения — через CR.

---

## А

**Аномалия (списания)** — отклонение фактического списания от нормативного по рецептуре свыше заданного порога, требующее объяснения. См. US-02.

**Аудит-трейл** — полный журнал событий: показ рекомендации, действие пользователя, результат. Хранится ≥3 года для целей внутреннего и внешнего аудита.

---

## Б

**Baseline** — зафиксированные значения KPI клиента до запуска рекомендаций. Замеряется минимум 14 рабочих дней. Подписывается финконтролёром клиента. Без baseline ROI не признаётся.

**BDD (Behavior-Driven Development)** — формат критериев приёмки в виде «Given / When / Then». См. [BDD Acceptance Scenarios](../03-product/04-bdd-acceptance-scenarios.md).

**BRD (Business Requirements Document)** — документ верхнего уровня, фиксирующий бизнес-требования заказчика. Здесь — [BRD](../02-business/01-business-requirements-document.md).

**Bus factor** — минимальное количество ключевых сотрудников, чьё одновременное отсутствие парализует проект. Целевое значение ≥2 на каждую критичную область.

---

## В

**Видение (Vision)** — долгосрочная картина продукта и компании. См. [Vision & Strategy](../01-strategy/01-vision-and-strategy.md).

---

## Г

**Gating-критерий** — условие перехода к следующему этапу. Без выполнения критерия следующий этап не стартует, даже если есть давление по срокам. См. этапы G1..G4 в [Roadmap](../04-implementation/01-roadmap.md).

---

## Д

**Decision Log** — реестр всех значимых решений с датой, обоснованием, последствиями. См. [Decision Log](../05-governance/05-decision-log.md).

**Дайджест** — агрегированное уведомление, объединяющее несколько событий, чтобы снизить шум. Формируется в часы тишины и при превышении порога частоты push'ей.

**Data Audit** — предпроектная проверка качества данных в Kiepper. Обязательный gating-критерий перехода E1 → E2. См. [Data Audit Checklist](../04-implementation/04-data-audit-checklist-kiepper.md).

**Data Governance** — политики и процессы работы с данными: доступы, хранение, удаление, комплаенс. См. [Data Governance](../05-governance/03-data-governance.md).

**DPA (Data Processing Agreement)** — соглашение об обработке персональных данных. Обязательно перед стартом E1.

---

## К

**Kiepper** — учётная система предприятия общественного питания, к которой Orakul интегрируется. Источник мастер-данных (рецептуры, остатки, продажи, закупки).

**Change Management Plan** — план организационных (не IT) изменений: как добиться того, чтобы сотрудники клиента приняли новый способ работы. См. [Change Management Plan](../04-implementation/03-change-management-plan.md).

**Change Request (CR)** — формальный запрос на изменение объёма, сроков, KPI, RACI или других элементов проекта. См. [Change Request Template](../05-governance/04-change-request-template.md).

**Champion (чемпион изменений)** — сотрудник клиента, активно поддерживающий проект и помогающий распространить новые практики внутри своей команды.

**Critical Assumption** — стратегическая ставка, которая должна подтвердиться, иначе пересматривается стратегия. См. [Vision §8](../01-strategy/01-vision-and-strategy.md), [GTM §12](../01-strategy/03-go-to-market.md).

---

## М

**MAPE (Mean Absolute Percentage Error)** — средняя абсолютная процентная ошибка прогноза. KPI BIZ-05.

**MBR (Monthly Business Review)** — ежемесячная встреча управляющего комитета. См. [Communications Plan](../04-implementation/05-communications-plan.md).

**MRR (Monthly Recurring Revenue)** — ежемесячная подписочная выручка.

---

## N

**NPS (Net Promoter Score)** — индекс готовности рекомендовать продукт. Измеряется по ролям ежеквартально. KPI PROD-05.

**NRR (Net Revenue Retention)** — удержание выручки с учётом расширения и оттока. Цель 2026: ≥110%.

**NSM (North Star Metric)** — главная метрика компании. У нас — ARAR (Adoption Rate of AI Recommendations). См. [Vision §9](../01-strategy/01-vision-and-strategy.md).

---

## О

**OKR (Objectives and Key Results)** — метод постановки амбициозных целей. См. [OKRs 2026](../02-business/03-okrs-2026.md).

**Override Rate** — доля рекомендаций, отклонённых пользователем с обоснованием. Counter-metric к ARAR. Здоровый диапазон 5–25%.

**Объяснимость (Explainability)** — обязательное свойство каждой рекомендации Orakul: видно, почему модель предложила именно это.

---

## П

**P0 / P1 / P2** — приоритеты бэклога (Must / Should / Could). См. [User Stories](../03-product/02-user-stories.md).

**Persona** — типизированный пользователь продукта (управляющий, закупщик, шеф-повар и др.). См. [PRD §4](../03-product/01-product-requirements-document.md).

**Pilot** — 6-недельный проверочный режим работы продукта на 1–2 точках клиента с целью подтверждения ROI и перехода в платящих. См. [GTM §6](../01-strategy/03-go-to-market.md).

**PRD (Product Requirements Document)** — документ продуктовых требований. См. [PRD](../03-product/01-product-requirements-document.md).

---

## R

**RACI Matrix** — матрица ответственности (Responsible / Accountable / Consulted / Informed). См. [RACI](../04-implementation/02-raci-matrix.md).

**ARAR (Adoption Rate of AI Recommendations)** — North Star метрика: доля рекомендаций, принятых или скорректированных пользователем. KPI NSM-01.

**Recommend, don't act** — продуктовый принцип: Orakul рекомендует, человек утверждает. Авто-действия запрещены без явного CR.

**Risk Register** — реестр рисков с владельцами и митигациями. См. [Risk Register](../05-governance/01-risk-register.md).

**ROI (Return on Investment)** — окупаемость подписки и внедрения для клиента. См. [Business Case & ROI](../06-financial/01-business-case-and-roi.md).

---

## С

**Severity (риска)** — произведение Вероятности × Влияние. Шкала 1–25. См. [Risk Register §1](../05-governance/01-risk-register.md).

**SKU (Stock Keeping Unit)** — учётная единица номенклатуры (ингредиент, товар, материал).

**SLA (Service Level Agreement)** — соглашение об уровне сервиса (uptime, время реакции на инцидент). См. [Pricing](../06-financial/02-pricing-and-commercial-model.md), [BRD §7](../02-business/01-business-requirements-document.md).

**SQL (Sales Qualified Lead)** — квалифицированный лид: ICP, есть ЛПР, бюджет, срок.

**Sponsor** — лицо со стороны заказчика или инвестора, отвечающее за финансирование и стратегические решения.

**Стейкхолдер** — любая сторона, чьи интересы затрагивает проект. См. [Stakeholder Register](../05-governance/02-stakeholder-register.md).

**Стоп-лист** — позиция меню, временно недоступная для заказа из-за нехватки ингредиента. Главный operational pain.

---

## Т

**TAM / SAM / SOM** — Total / Serviceable / Obtainable Addressable Market. Уровни оценки рынка. См. [Market Analysis §3](../01-strategy/02-market-and-competitive-analysis.md).

**T&M (Time & Materials)** — модель оплаты по фактическим часам и материалам.

**TTV (Time-to-Value)** — время от начала проекта до первой принятой рекомендации. KPI OPS-03. Цель ≤21 день.

---

## У

**Управляющий комитет** — орган управления проектом со стороны клиента и Orakul. Состав: спонсор + опердир + финконтролёр + куратор проекта (PMO).

**User Journey Map** — карта пути пользователя по продукту. См. [User Journey Maps](../03-product/03-user-journey-maps.md).

**User Story (US)** — формализованное описание сценария ценности для пользователя. См. [User Stories](../03-product/02-user-stories.md).

---

## Ф

**Food Cost** — отношение себестоимости продуктов к цене блюда. Базовая метрика управления экономикой меню.

---

## Х

**Health Score** — композитный индикатор «здоровья» клиента: красный/жёлтый/зелёный. См. [GTM §10](../01-strategy/03-go-to-market.md), [KPI HLT-01..04](../02-business/02-kpi-framework-and-dashboard.md).

---

## Ч

**Чемпион изменений** — см. Champion.

---

## Э

**Этапы внедрения** — E1 (диагностика), E2 (пилот), E3 (масштабирование), E4 (стабилизация), E5 (сопровождение). См. [Roadmap §3](../04-implementation/01-roadmap.md).

---

## Сокращения (быстрая справка)

| Сокращение | Расшифровка |
|------------|-------------|
| ARAR | Adoption Rate of AI Recommendations |
| ARR | Annual Recurring Revenue |
| BDD | Behavior-Driven Development |
| BRD | Business Requirements Document |
| CAC | Customer Acquisition Cost |
| CR | Change Request |
| CSM | Customer Success Manager |
| DPA | Data Processing Agreement |
| GTM | Go-to-Market |
| ICP | Ideal Customer Profile |
| KPI | Key Performance Indicator |
| LTV | Lifetime Value |
| MAPE | Mean Absolute Percentage Error |
| MBR | Monthly Business Review |
| MQL | Marketing Qualified Lead |
| MRR | Monthly Recurring Revenue |
| NRR | Net Revenue Retention |
| NSM | North Star Metric |
| OKR | Objectives and Key Results |
| PMO | Project Management Office / Куратор проекта |
| PO | Product Owner |
| PRD | Product Requirements Document |
| QBR | Quarterly Business Review |
| RACI | Responsible / Accountable / Consulted / Informed |
| RBAC | Role-Based Access Control |
| ROI | Return on Investment |
| SAM | Serviceable Addressable Market |
| SLA | Service Level Agreement |
| SOM | Serviceable Obtainable Market |
| SQL | Sales Qualified Lead |
| TAM | Total Addressable Market |
| TCO | Total Cost of Ownership |
| TTV | Time-to-Value |
| US | User Story |
| WBR | Weekly Business Review |

---

## Changelog

| Версия | Дата | Автор | Изменения |
|--------|------|-------|-----------|
| 1.0 | 2026-05-07 | PMO + Продакт | Первая утверждённая редакция |
