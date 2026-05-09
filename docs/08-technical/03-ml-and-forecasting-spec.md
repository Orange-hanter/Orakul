---
Документ: ML & Forecasting Spec
Версия: 1.0
Дата: 2026-05-09
Статус: Утверждён
Владелец: Data Lead
Связанные документы: [MVP Architecture](00-mvp-architecture.md), [Data Model & Pipeline](02-data-model-and-pipeline.md), [Telegram Notification Spec](04-telegram-notification-spec.md), [KPI Framework BIZ-05](../02-business/02-kpi-framework-and-dashboard.md)
---

# ML & Forecasting Spec

## 0. Принципы

1. **Baseline first.** Никаких Prophet и ML до тех пор, пока baseline не измерен и не зафиксирован. Baseline — точка отсчёта, без неё непонятно, что улучшаем.
2. **Объяснимость обязательна.** Каждый прогноз пользователю приходит с текстовым обоснованием. «Модель сказала» — не обоснование. Обоснование — цифры из данных.
3. **Модель воздерживается явно.** Если данных мало или MAPE плохой — мы не угадываем, а говорим «не знаю». Ошибочный прогноз → потеря доверия → смерть продукта.
4. **Метрики считаются до продакшна.** Ни одна модель не уходит в прогнозы без измеренного MAPE на holdout.
5. **Переобучение — не цель.** Лучше простая модель с MAPE 12%, чем сложная с MAPE 8% на train и 25% на prod.

---

## 1. Прогнозная задача

### 1.1 Что прогнозируем
> **Дневной расход ингредиента на конкретной точке на горизонт 7 дней вперёд.**

Формально:
```
target(location_id, ingredient_id, date) = daily_qty_consumed
```

Где `daily_qty_consumed` — из `marts.daily_consumption.theoretical_qty` (теоретический расход).

> Почему теоретический, а не фактический? Теоретический расход стабилен (зависит от продаж и рецептур), фактический — зашумлён ошибками учёта, нерегулярными инвентаризациями. На старте прогнозируем теоретический; позднее — сравниваем модели.

### 1.2 Для каких ингредиентов
Приоритет: **топ-50 ингредиентов по объёму расхода** на точке. Остальные — в очереди после стабилизации.

Критерий попадания в топ-50:
```sql
SELECT ingredient_id
FROM marts.daily_consumption
WHERE location_id = :loc
  AND date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY ingredient_id
ORDER BY SUM(theoretical_qty) DESC
LIMIT 50;
```

### 1.3 Горизонт прогноза
**7 дней** — достаточно для планирования заказов с учётом срока поставки (обычно 1–3 дня).

---

## 2. Входные признаки (features)

| Признак | Тип | Описание | Доступен с |
|---------|-----|----------|-----------|
| `lag_1d` | numeric | Расход вчера | T0 (сразу) |
| `lag_7d` | numeric | Расход неделю назад | T0 + 7 дней |
| `lag_14d` | numeric | Расход 2 недели назад | T0 + 14 дней |
| `rolling_mean_7d` | numeric | Скользящее среднее за 7 дней | T0 + 7 дней |
| `rolling_mean_14d` | numeric | Скользящее среднее за 14 дней | T0 + 14 дней |
| `rolling_std_7d` | numeric | Волатильность расхода | T0 + 7 дней |
| `day_of_week` | categorical (0–6) | Пн=0, Вс=6 | T0 |
| `is_weekend` | bool | Пт–Вс | T0 |
| `week_of_year` | int (1–53) | Для сезонности | T0 |
| `month` | int (1–12) | Для сезонности | T0 |
| `is_holiday` | bool | Государственные праздники РФ | T0 (справочник) |
| `has_promo` | bool | Активная акция на точке | По мере добавления |
| `delivery_lag_1d` | numeric | Объём поставки вчера (влияет на остатки) | T0 |

> Признаки добавляются поэтапно. Baseline использует только `rolling_mean_7d` + `day_of_week`.

---

## 3. Иерархия моделей

```
История < 14 дней
    → forecast_quality = 'abstained'
    → прогноз не выдаётся

История 14–29 дней
    → Baseline: simple 7-day MA с поправкой на день недели
    → forecast_quality = 'medium' если MAPE > 15%

История ≥ 30 дней
    → Baseline: 7-day MA + day-of-week
    → Если MAPE baseline > 15% → пробуем ETS (statsmodels)
    → Если MAPE ETS > 15% → пробуем Prophet
    → Берём лучшую по MAPE на holdout
    → forecast_quality: 'high' (≤10%), 'medium' (10–15%), 'low' (>15%)
    → forecast_quality = 'abstained' если лучшая MAPE > 30%
```

---

## 4. Модели — детали реализации

### 4.1 Baseline: 7-day Moving Average + Day-of-Week

```python
import numpy as np
import pandas as pd

def baseline_forecast(history: pd.Series, horizon: int = 7) -> np.ndarray:
    """
    history: pd.Series indexed by date, values = daily_qty
    Возвращает массив прогнозов на horizon дней вперёд.
    """
    # Коэффициенты дня недели (отношение к среднему дню)
    dow_factors = (
        history.groupby(history.index.dayofweek).mean()
        / history.mean()
    ).to_dict()

    ma7 = history.rolling(7, min_periods=3).mean().iloc[-1]
    last_date = history.index[-1]

    forecasts = []
    for i in range(1, horizon + 1):
        next_date = last_date + pd.Timedelta(days=i)
        dow = next_date.dayofweek
        predicted = ma7 * dow_factors.get(dow, 1.0)
        forecasts.append(max(predicted, 0))  # не может быть отрицательным

    return np.array(forecasts)
```

**Обоснование для пользователя (US-08):**
> «Прогноз основан на среднем расходе за последние 7 дней ({ma7:.2f} кг/день) с поправкой на {weekday_name} (коэффициент {dow_factor:.2f}).»

### 4.2 ETS (Exponential Smoothing)

```python
from statsmodels.tsa.holtwinters import ExponentialSmoothing

def ets_forecast(history: pd.Series, horizon: int = 7) -> np.ndarray:
    model = ExponentialSmoothing(
        history,
        trend='add',
        seasonal='add',
        seasonal_periods=7,
        damped_trend=True
    )
    fit = model.fit(optimized=True)
    return fit.forecast(horizon).values.clip(min=0)
```

> ETS запускается только если история ≥ 2 полных недели (14 дней).  
**Обоснование:** «Учтены тренд и недельная сезонность. Модель строилась на {n_days} днях истории.»

### 4.3 Prophet

```python
from prophet import Prophet

def prophet_forecast(history: pd.Series, horizon: int = 7) -> np.ndarray:
    df = history.reset_index()
    df.columns = ['ds', 'y']
    df['y'] = df['y'].clip(lower=0)

    model = Prophet(
        yearly_seasonality=False,  # ≥365 дней истории нет на старте
        weekly_seasonality=True,
        daily_seasonality=False,
        seasonality_mode='multiplicative',
        changepoint_prior_scale=0.1,   # консервативный — не оверфит
    )
    model.fit(df)

    future = model.make_future_dataframe(periods=horizon)
    forecast = model.predict(future)
    return forecast['yhat'].tail(horizon).values.clip(min=0)
```

> Prophet запускается только при истории ≥ 30 дней.

---

## 5. Оценка качества (Evaluation)

### 5.1 Метрики

| Метрика | Формула | Порог | Применение |
|---------|---------|-------|------------|
| **MAPE** | mean(\|actual − pred\| / actual) × 100 | ≤15% (цель), ≤30% (приемлемо) | BIZ-05, главная метрика |
| **WAPE** | Σ\|actual − pred\| / Σactual × 100 | ≤12% | Устойчивее при маленьких значениях |
| **MAE** | mean(\|actual − pred\|) | В единицах base_unit | Для понимания абсолютной ошибки |
| **Bias** | mean(pred − actual) | Близко к 0 | Систематическое завышение/занижение |

> Главная метрика — MAPE. При `actual = 0` MAPE неопределён → используем WAPE для таких ингредиентов.

### 5.2 Holdout strategy

```
История (N дней)
└── Training set: [T0 ... T_{N-14}]   ← обучение
└── Holdout set:  [T_{N-13} ... T_N]  ← оценка (последние 14 дней)
```

> Не используем k-fold или walk-forward validation на MVP — достаточно one-shot holdout. После 3 месяцев работы переходим на rolling holdout.

### 5.3 Что значит forecast_quality

```python
def get_forecast_quality(mape: float, history_days: int) -> str:
    if history_days < 14:
        return 'abstained'
    if mape > 30:
        return 'abstained'
    if mape <= 10:
        return 'high'
    if mape <= 15:
        return 'medium'
    return 'low'
```

---

## 6. Days-to-Depletion

```python
def days_to_depletion(
    current_stock: float,       # текущий остаток в base_unit
    forecast_daily: np.ndarray  # прогноз расхода на 7 дней
) -> float:
    """
    Возвращает дробное количество дней до истощения остатка.
    Если остатка хватит на весь горизонт — возвращает > 7.
    """
    cumulative = 0.0
    for i, daily in enumerate(forecast_daily, start=1):
        cumulative += daily
        if cumulative >= current_stock:
            # Линейная интерполяция внутри дня
            prev_cumulative = cumulative - daily
            fraction = (current_stock - prev_cumulative) / daily
            return i - 1 + fraction
    return len(forecast_daily) + 1  # > горизонта
```

---

## 7. Retraining Policy

| Событие | Действие |
|---------|---------|
| Ежедневно 03:00 | Пересчёт прогнозов для всех (location, ingredient) |
| MAPE деградировал >5 п.п. за 7 дней | Алёрт Data Lead, принудительный refit |
| Изменилась рецептура (core.recipes) | Пересчёт daily_consumption за последние 90 дней → refit |
| Новая точка подключена | Full fit с нуля при накоплении 14 дней истории |
| Сезонная смена (каждые 90 дней) | Проверка сезонных коэффициентов |

---

## 8. Мониторинг качества моделей

```sql
-- Аномалия: MAPE вырос более чем на 5 п.п. за 7 дней
SELECT mr1.location_id, mr1.ingredient_id,
       mr1.mape AS mape_today,
       mr2.mape AS mape_7d_ago,
       mr1.mape - mr2.mape AS delta
FROM ops.model_runs mr1
JOIN ops.model_runs mr2
    ON mr1.location_id = mr2.location_id
    AND mr1.ingredient_id = mr2.ingredient_id
    AND mr2.started_at::date = CURRENT_DATE - 7
WHERE mr1.started_at::date = CURRENT_DATE
  AND mr1.mape - mr2.mape > 5;
```

---

## 9. Обоснование прогноза для пользователя (US-08)

Каждый прогноз должен содержать читаемый текст. Шаблоны:

### Baseline:
```
Прогноз расхода «{ingredient_name}»: {predicted:.1f} кг/день.
Основан на среднем за 7 дней ({ma7:.1f} кг) с учётом {weekday} 
(исторически {dow_factor:.0%} от среднего).
Текущий остаток: {stock:.1f} кг → хватит на ~{days:.0f} дн.
```

### ETS:
```
Прогноз «{ingredient_name}»: {predicted:.1f} кг/день.
Модель учла тренд и недельную сезонность ({n_days} дней истории).
Ошибка прогноза на исторических данных: {mape:.0f}%.
Остаток {stock:.1f} кг → ~{days:.0f} дн.
```

### Abstained:
```
«{ingredient_name}»: недостаточно данных для надёжного прогноза 
(история {history_days} дн, нужно ≥14). 
Текущий остаток: {stock:.1f} кг.
```

---

## 10. Тест-план моделей

| Тест | Что проверяем | Инструмент |
|------|--------------|-----------|
| Unit: baseline | Возвращает массив длиной horizon, значения ≥ 0 | pytest |
| Unit: дни_до_окончания | Корректно считает при остатке = 0, при остатке > горизонта | pytest |
| Unit: forecast_quality | Правильные пороги | pytest |
| Integration: full pipeline | Данные из core → прогноз в marts.forecasts | pytest + testcontainers |
| Offline eval: baseline MAPE | На синтетических данных с известным ответом MAPE < 15% | pytest notebook |

---

## 11. Changelog

| Версия | Дата | Автор | Изменения |
|--------|------|-------|-----------|
| 1.0 | 2026-05-09 | Data Lead | Первая утверждённая редакция |
