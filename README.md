# Orakul — ИИ-помощник для предприятий общественного питания

> **Краткое описание.** Orakul — продукт-цифровой советник, интегрируемый с учётной системой **Kiepper**. Переводит управление запасами, закупками и маржинальностью меню из режима реактивных решений в режим проактивных рекомендаций на основе ИИ.

---

## 🎯 О чём этот репозиторий

Это **бизнес-документация** проекта Orakul. Здесь нет кода — только материалы, которые формируют единое представление о продукте у всех ролей: собственника, операционного директора, продакта, технологов, инвесторов и команды внедрения.

Документация спроектирована так, чтобы:
- **Бизнес-заказчик** мог принять решения о финансировании и приоритетах без IT-погружения.
- **Продуктовая команда** получала однозначное ТЗ и трассировку каждого требования к KPI.
- **Команда внедрения** понимала, кто, когда и за что отвечает.
- **Аудитор / инвестор** мог за 30 минут оценить зрелость подхода и риски.

---

## 🗂 Структура документации

| Раздел | Что внутри | Кто читает в первую очередь |
|--------|-----------|------------------------------|
| [`01-strategy/`](docs/01-strategy/) | Видение, рынок, GTM, позиционирование | Собственник, инвестор, CMO |
| [`02-business/`](docs/02-business/) | BRD, KPI-фреймворк, OKR | Опердир, продакт, финконтролёр |
| [`03-product/`](docs/03-product/) | PRD, User Stories, Journey Maps, BDD | Продакт, дизайнер, QA, разработка |
| [`04-implementation/`](docs/04-implementation/) | Roadmap, RACI, Change Mgmt, Data Audit, Comms | PMO, опердир, IT-владелец Kiepper |
| [`05-governance/`](docs/05-governance/) | Реестры стейкхолдеров и рисков, Data Governance, шаблоны CR/Decision Log | Спонсор, юрист, безопасник, PMO |
| [`06-financial/`](docs/06-financial/) | Бизнес-кейс, расчёт ROI, ценовая модель | Финдир, инвестор, тендерный комитет |
| [`07-references/`](docs/07-references/) | Глоссарий, индекс трассировки, версионность | Все роли (справочник) |

---

## 🚀 Быстрый старт по ролям

### 👨‍💼 Собственник / Инвестор
1. [Видение и стратегия](docs/01-strategy/01-vision-and-strategy.md) — *5 минут.*
2. [Бизнес-кейс и ROI](docs/06-financial/01-business-case-and-roi.md) — *расчёт окупаемости.*
3. [BRD §10–11: коммерческая модель и приёмка](docs/02-business/01-business-requirements-document.md) — *базовый контракт.*

### 🧭 Операционный директор
1. [BRD: цели, KPI, процессы As-Is → To-Be](docs/02-business/01-business-requirements-document.md).
2. [Roadmap внедрения](docs/04-implementation/01-roadmap.md).
3. [Реестр рисков](docs/05-governance/01-risk-register.md) и [план управления изменениями](docs/04-implementation/03-change-management-plan.md).

### 🛠 Продуктовая команда
1. [Product Requirements Document (PRD)](docs/03-product/01-product-requirements-document.md).
2. [User Stories с критериями приёмки](docs/03-product/02-user-stories.md).
3. [User Journey Maps](docs/03-product/03-user-journey-maps.md) и [BDD-сценарии](docs/03-product/04-bdd-acceptance-scenarios.md).

### 💼 Внедрение / PMO
1. [Roadmap](docs/04-implementation/01-roadmap.md), [RACI](docs/04-implementation/02-raci-matrix.md), [Comms Plan](docs/04-implementation/05-communications-plan.md).
2. [Чек-лист предпроектного аудита данных Kiepper](docs/04-implementation/04-data-audit-checklist-kiepper.md).
3. [Шаблон Change Request](docs/05-governance/04-change-request-template.md), [Decision Log](docs/05-governance/05-decision-log.md).

### 🔒 Безопасность / Комплаенс
1. [Data Governance](docs/05-governance/03-data-governance.md).
2. [BRD §7: нефункциональные требования](docs/02-business/01-business-requirements-document.md).
3. [Реестр рисков, раздел «Безопасность и комплаенс»](docs/05-governance/01-risk-register.md).

---

## 🧭 Принципы документации

1. **Одна правда — один документ.** Каждое решение или требование фиксируется в одном месте; остальные ссылаются на него (см. [индекс трассировки](docs/07-references/02-traceability-index.md)).
2. **Фокус на бизнес-результате, а не реализации.** Технические детали выносятся в отдельный технический контур (TRD/SAD) и здесь не дублируются.
3. **KPI-связность.** Любое требование, история или этап имеет явную привязку к измеримому KPI из [BRD §2](docs/02-business/01-business-requirements-document.md).
4. **Версионность.** Изменения через [Change Request](docs/05-governance/04-change-request-template.md), фиксируются в [Decision Log](docs/05-governance/05-decision-log.md).
5. **Объяснимость.** Если рекомендация ИИ или решение в документе требует обоснования — оно приводится явно («чёрный ящик» запрещён).

---

## 📌 Текущий статус документации

| Документ | Статус | Версия | Последнее обновление |
|---------|--------|--------|----------------------|
| Vision & Strategy | ✅ Утверждён | 1.0 | 2026-05-07 |
| Market & Competitive Analysis | ✅ Утверждён | 1.0 | 2026-05-07 |
| Go-to-Market Strategy | ✅ Утверждён | 1.0 | 2026-05-07 |
| Business Requirements Document (BRD) | ✅ Утверждён | 1.1 | 2026-05-07 |
| KPI Framework & Dashboard | ✅ Утверждён | 1.0 | 2026-05-07 |
| OKR на 2026 | ✅ Утверждён | 1.0 | 2026-05-07 |
| Product Requirements Document (PRD) | ✅ Утверждён | 1.0 | 2026-05-07 |
| User Stories | ✅ Утверждён | 1.1 | 2026-05-07 |
| User Journey Maps | ✅ Утверждён | 1.0 | 2026-05-07 |
| BDD Acceptance Scenarios | ✅ Утверждён | 1.0 | 2026-05-07 |
| Implementation Roadmap | ✅ Утверждён | 1.0 | 2026-05-07 |
| RACI Matrix | ✅ Утверждён | 1.0 | 2026-05-07 |
| Change Management Plan | ✅ Утверждён | 1.0 | 2026-05-07 |
| Data Audit Checklist (Kiepper) | ✅ Утверждён | 1.0 | 2026-05-07 |
| Communications Plan | ✅ Утверждён | 1.0 | 2026-05-07 |
| Vendor & Partner Management | ✅ Утверждён | 1.0 | 2026-05-07 |
| Stakeholder Register | ✅ Утверждён | 1.0 | 2026-05-07 |
| Risk Register | ✅ Утверждён | 1.1 | 2026-05-07 |
| Data Governance | ✅ Утверждён | 1.0 | 2026-05-07 |
| Change Request Template | ✅ Утверждён | 1.0 | 2026-05-07 |
| Decision Log | ✅ Утверждён | 1.0 | 2026-05-07 |
| Business Case & ROI | ✅ Утверждён | 1.0 | 2026-05-07 |
| Pricing & Commercial Model | ✅ Утверждён | 1.0 | 2026-05-07 |
| Glossary | ✅ Утверждён | 1.0 | 2026-05-07 |
| Traceability Index | ✅ Утверждён | 1.0 | 2026-05-07 |

> Статусы: ⚪ Черновик · 🟡 На ревью · ✅ Утверждён · 🔁 На доработке · ⛔ Отозван

---

## 🤝 Как вносить изменения

1. Любое изменение бизнес-требования или KPI → откройте [Change Request](docs/05-governance/04-change-request-template.md).
2. Решение по CR фиксируется в [Decision Log](docs/05-governance/05-decision-log.md) с датой и подписями.
3. Документ обновляется, версия инкрементируется, в шапке добавляется запись в Changelog.

---

## 📞 Контакты управляющего комитета

| Роль | ФИО | Зона ответственности |
|------|-----|----------------------|
| Спонсор проекта | — | Финансирование, стратегические решения |
| Владелец продукта | — | Приоритезация, бэклог, KPI |
| Операционный директор | — | Внедрение в сети, дисциплина процессов |
| Финансовый контролёр | — | Верификация KPI, расчёт ROI |
| IT-владелец Kiepper | — | Интеграция, регламент изменений Kiepper |
| Куратор проекта (PMO) | — | Roadmap, риски, коммуникации |

> Заполняется на этапе старта проекта. Контактные данные — во внутреннем CRM/Wiki, не в публичной документации.
