---
Документ: Sprints Roadmap — 3 ближайших спринта
Версия: 1.0
Дата: 2026-05-29
Статус: Утверждён
Владелец: Tech Lead
Связанные документы: [Sprint 2026-05-22 (closed)](09-sprint-2026-05-22-audit.md), [Design audit](10-design-audit-2026-05-22.md), [Roadmap](01-roadmap.md), [PRD](../03-product/01-product-requirements-document.md)
---

# Sprints Roadmap — 3 ближайших спринта (2026-05-29 → 2026-06-18)

## Контекст

R2 MVP в проде, аудит-фиксы накатаны, 72/72 тестов зелёные. **Главный стратегический разрыв:** продукт позиционируется как «цифровой советник на базе ИИ» (PRD §2), но в проде нет ни одной модели и ни одной автоматической рекомендации. На Gate G2 (Pilot → Paid ≥ 80%) этого недостаточно.

План закрывает разрыв за 3 недели:

1. **Sprint 1** — превратить накопленные данные в автоматические инсайты (фундамент).
2. **Sprint 2** — первый ИИ-слой: forecast + рекомендации + объяснимость.
3. **Sprint 3** — прод-готовность к первому платному клиенту.

---

## Sprint 1 — «Замкнуть аналитический контур» (2026-05-29 → 2026-06-04) ✅ CLOSED

**Цель:** каждое накопленное данные превращается в полезный инсайт. После спринта впервые становится возможно сказать «Orakul нашёл вот эту экономию».

| ID | Статус | Задача | Артефакт |
|----|:------:|--------|----------|
| **F01** | ✅ | ABC-анализ меню (margin × volume) | `utils/abcMenu.js`, `finance/ABCMenuCard.jsx` |
| **F02** | ✅ | Per-dish sales counter | `utils/dishSales.js`, `DishSalesModal.jsx`, кнопка в MenuTab |
| **F03** | ✅ | Theoretical vs Actual writeoff (US-02) | `utils/writeoffControl.js`, `finance/WriteoffControlCard.jsx` |
| **F04** | ✅ | Telegram алёрт «маржа упала на блюде» | hook в PUT `/api/records` + `queuePriceAlerts` |
| **F05** | ✅ | Утренний P&L digest | `buildPnLDigest(venueId)` в `server.js` |
| **F06** | ✅ | Telegram алёрт «цена выросла» | тот же hook что F04 (один коммит) |
| **F07** | ✅ | Auto-onboarding checklist | `utils/onboarding.js`, `OnboardingChecklist.jsx` |
| **F08** | ✅ | Documentation + Decision Log | этот файл + `05-decision-log.md` (DL-2026-011) |

**Sprint-метрика:** ✅ каждый пилот теперь получает ≥ 1 actionable инсайт автоматически (Telegram дайджест + алёрты на изменение цен).

**Зависимости (отработали):** F02 → F01 и F03 (нужны sales data); F04 → существующий margin-engine (Track A iter 1); F05 → существующий P&L; F06 → supplier_price_history.

### Sprint 1 deliverables (по коммитам)

| Commit | Тема |
|--------|------|
| `c91551c` | F02 + Track A iter 1 (per-dish food cost) |
| `ba08462` | F01 ABC-анализ |
| `b2f6bb4` | F04 + F05 + F06 Telegram alerts bundle |
| `9df8027` | F03 theoretical writeoff (US-02) |
| `6257825` | F07 onboarding checklist |

**Тесты:** 116 cases (10 new для dishSales, 17 для abcMenu, 18 для writeoffControl, 6 для onboarding). Все зелёные.

**Прод:** `https://app.157-22-174-219.nip.io/` — 6 деплоев за спринт без даунтайма.

---

## Sprint 2 — «Первый ИИ-слой» (2026-06-05 → 2026-06-11) ✅ CLOSED

**Цель:** существование «Оракула» подтверждается кодом. ARAR (North Star) можно начать измерять.

| ID | Статус | Задача | Артефакт |
|----|:------:|--------|----------|
| **AI01** | ✅ | Baseline forecast: WMA 28 дн × weekday seasonality, 7-дневный горизонт | `utils/forecast.js` (+ MAPE self-test) |
| **AI02** | ✅ | US-03 v2: `forecast × (lead_time + safety) − current_stock`, rounded по minQty | `utils/recommendations.js`, `RecommendationsView.jsx` в OrdersTab |
| **AI03** | ✅ | Объяснимость (US-08): expandable «Почему» с daily forecast + recipe contributors | `WhyBlock` в `RecommendationsView.jsx` |
| **AI04** | ✅ | ARAR-трекинг: 👍/✎/👎 → запись `recommendation_action` + KPI | `computeARAR` + новый тип записи в `VENUE_SCOPED_TYPES` |
| **AI05** | ✅ | Anomaly detection v1: 2σ writeoff alerts (14-дневное окно) | `utils/anomaly.js`, badge в StockTab, блок в TG digest |
| **AI06** | ✅ | US-06 минимальный: «что если» симулятор цены блюда → margin/FC/недельная Δ | `utils/whatIf.js`, `WhatIfPanel.jsx` в модалке MenuTab |
| **AI07** | ✅ | Unit-тесты forecast/recommendation/anomaly/whatIf | 52 новых кейса (168/168 green) |

**Sprint-метрика:** ✅ запуск возможен — ARAR метрика инструментирована, как только пользователи начнут нажимать кнопки, она появляется в UI. MAPE measurable через `computeMAPE` (целевой ≤ 15% — будет измеряться по факту собранных данных в Sprint 3).

**Принцип PRD §3 «Recommend, don't act»:** соблюдён — ни AI02, ни AI06 не создают записей заказа без явного действия пользователя.

### Sprint 2 deliverables (по коммитам)

| Commit | Тема |
|--------|------|
| `14ed11b` | AI01 + AI02 + AI03 + AI04 (forecast + recommendations + explainability + ARAR) |
| `846eece` | AI05 anomaly detection (2σ writeoff alerts) |
| `f928379` | AI06 what-if price simulator |

**Тесты:** 168 cases total (+52 за спринт: 14 для forecast, 14 для recommendations, 12 для anomaly, 12 для whatIf).

**Bundle:** 89.39 KB gzip (+2.48 KB к Sprint 1 baseline 86.91 KB).

---

## Sprint 3 — «Готовность к платному клиенту» (2026-06-12 → 2026-06-18)

**Цель:** инфраструктура не упирается в первый paying contract.

| ID | Задача | Условие |
|----|--------|---------|
| **O01** | Audit log (JSONL по записи) + UI просмотра в «Данные» | Всегда |
| **O02** | L1 multi-user login (учётные записи + bcrypt + invitation flow) | Если есть клиент с 2+ сотрудниками на горизонте |
| **O03** | Live QR / iiko адаптер (реальные REST + webhook) | Если у клиента эта POS |
| **O04** | Backup автоматизация: nightly cron + 7-дневная ретенция | Всегда (закрывает R4) |
| **O05** | Monitoring: healthcheck endpoint + Uptimerobot | Всегда |
| **O06** | Migration plan для Postgres (документ, не код) | Всегда |
| **O07** | CI: GitHub Action auto-test on push | Всегда |

**Sprint-метрика:** прохождение чек-листа SLA (audit-trail, бэкап есть, uptime ≥ 99 %, восстановление из бэкапа отработано).

**Условные задачи:** O02 и O03 — поднимаются в Sprint 2 в обмен на AI06, если контекст клиента требует.

---

## Что НЕ в этих 3 спринтах

| Тема | Почему отложено | Когда |
|------|-----------------|-------|
| Flutter миграция | Review trigger — Gate G3 (DL-2026-008) | Q4 2026 |
| Полная PostgreSQL миграция кода | Только план в Sprint 3, код — в R3 | По росту данных > 10k записей |
| L3 / L4 RBAC слои | Пока нет 5+ ролей у пилотных клиентов | По факту запроса |
| Расширение каталога поставщиков (рейтинги, PDF импорт) | R3 per CR-2026-001 | После Gate G2 |
| ML глубже baseline (Prophet, LSTM) | Преждевременно — сначала собрать baseline-данные | После MAPE ≤ 15% на baseline |
| Полная QuickResto live-интеграция с write-off engine | Только если конкретный пилот на QR | По факту |

---

## Триггеры пересмотра плана

| Условие | Действие |
|---------|----------|
| Появляется реальный пилотный клиент с QR/iiko на 2-й неделе | O03 (live POS) поднимается в Sprint 2 вместо AI06 |
| Пилотный клиент уже подписан, готов платить | Sprint 3 двигается на 2-ю неделю |
| Прогноз спроса даёт MAPE > 25 % в Sprint 2 | AI02 (рекомендации заказа) замораживается, фокус на сборе baseline |
| Пользователи игнорируют рекомендации (ARAR < 30 %) | Возврат к Sprint 1: чинить UX подачи рекомендаций |
| В Sprint 1 обнаружится критичный баг в проде | Sprint 2 откладывается, делаем hot-fix |

---

## Гейтинг между спринтами

- **Sprint 1 → 2:** ✅ выполнено. F02 в проде, Telegram-механизм готов отправлять алёрты (mock сценарии проверены).
- **Sprint 2 → 3:** ✅ AI01-AI07 закрыты. MAPE / ARAR будут измеряться по факту использования. Можно переходить к Sprint 3 либо к продакшен-валидации с пилотом.
- **Sprint 3 → дальнейшая работа:** SLA-чеклист пройден + есть подписанный paying-контракт ИЛИ ≥ 2 пилотов с положительной обратной связью.

---

## Changelog

| Версия | Дата | Автор | Изменения |
|--------|------|-------|-----------|
| 1.0 | 2026-05-29 | Tech Lead | Создан после Sprint 2026-05-22 + design audit |
| 1.1 | 2026-06-11 | Tech Lead | Sprint 2 закрыт: все 7 AI-задач выполнены, 168/168 тестов, +2.48 KB bundle |
