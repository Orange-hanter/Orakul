/*
 * AI01 — Baseline forecast для продаж блюд и потребления ингредиентов.
 *
 * Алгоритм:
 *   1. Среднее за последние N дней (по умолчанию 28) — baseline.
 *   2. Weekday seasonality (мультипликативный фактор):
 *        wdFactor[d] = avg(sales on dayOfWeek=d) / avg(sales over all days)
 *      Если данных по этому дню недели мало (< 2) — factor = 1.0 (без поправки).
 *   3. forecast[d] = baseline × wdFactor[d.dayOfWeek]
 *
 * Это не «AI» в ML-смысле, а детерминированный baseline, целевой ориентир
 * для BIZ-05 (MAPE ≤ 15%). Когда накопится больше данных и появится 2-ой
 * клиент — можно заменить на регрессию / Prophet (review trigger).
 */

import { toIsoDate } from './dishSales.js';
import { DAY_MS } from './time.js';

/**
 * Считает дневной forecast на N дней вперёд для конкретного блюда.
 * Возвращает массив объектов:
 *   [{ date, dayOfWeek, baseline, wdFactor, forecast }, ...]
 *
 * @param {Array} sales — dish_sale records (venue-filtered)
 * @param {string} dishId
 * @param {{ lookbackDays?: 28, horizonDays?: 7 }} opts
 */
export function forecastDishDaily(sales, dishId, opts = {}) {
  const lookback = opts.lookbackDays ?? 28;
  const horizon  = opts.horizonDays  ?? 7;

  // Окно: [today − lookback, today − 1]
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd   = new Date(today.getTime() - DAY_MS);
  const windowStart = new Date(today.getTime() - lookback * DAY_MS);
  const startIso = toIsoDate(windowStart);
  const endIso   = toIsoDate(windowEnd);

  // Daily totals за окно: dayIso → sum count
  const dailyTotals = new Map();
  for (const s of sales) {
    if (s.dishId !== dishId) continue;
    if (s.date < startIso || s.date > endIso) continue;
    dailyTotals.set(s.date, (dailyTotals.get(s.date) || 0) + (Number(s.count) || 0));
  }

  // Если совсем нет данных — возвращаем нули с factors=null (UI покажет «недостаточно данных»).
  if (dailyTotals.size === 0) {
    const result = [];
    for (let i = 1; i <= horizon; i++) {
      const d = new Date(today.getTime() + i * DAY_MS);
      result.push({
        date: toIsoDate(d),
        dayOfWeek: d.getDay(),
        baseline: 0,
        wdFactor: 1,
        forecast: 0,
        hasData: false,
      });
    }
    return result;
  }

  // Baseline: среднее по всем дням окна (включая нулевые — где не было продаж).
  // Считаем количество дней в окне, не только тех где были продажи.
  const totalDays = lookback;
  const totalSales = [...dailyTotals.values()].reduce((a, b) => a + b, 0);
  const baseline = totalSales / totalDays;

  // Weekday pattern: для каждого dayOfWeek собираем продажи (с нулями для дней без записей)
  const buckets = [[], [], [], [], [], [], []]; // 0..6
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(windowEnd.getTime() - i * DAY_MS);
    const iso = toIsoDate(d);
    const count = dailyTotals.get(iso) || 0;
    buckets[d.getDay()].push(count);
  }
  const wdAverages = buckets.map(b =>
    b.length > 0 ? b.reduce((a, c) => a + c, 0) / b.length : 0
  );
  // wdFactor[d] = wdAverages[d] / baseline. Защита от деления на 0 и от
  // слишком мало sample size (<2 точек по дню недели → factor = 1).
  const wdFactor = wdAverages.map((avg, d) =>
    (baseline > 0 && buckets[d].length >= 2) ? avg / baseline : 1
  );

  const result = [];
  for (let i = 1; i <= horizon; i++) {
    const d = new Date(today.getTime() + i * DAY_MS);
    const dow = d.getDay();
    const forecast = baseline * wdFactor[dow];
    result.push({
      date: toIsoDate(d),
      dayOfWeek: dow,
      baseline,
      wdFactor: wdFactor[dow],
      forecast: Math.max(0, forecast),
      hasData: true,
    });
  }
  return result;
}

/**
 * Forecast потребления продукта (ингредиента) на горизонт.
 * = Σ over всех активных блюд с этим продуктом в рецепте:
 *     ingredient.quantity × forecastDishDaily(dish).total
 *
 * Возвращает:
 *   { dailyConsumption: [...], totalConsumption, contributingDishes: [{dish, qty}] }
 */
export function forecastProductConsumption(records, productId, opts = {}) {
  const horizon = opts.horizonDays ?? 7;
  const dishes = records.filter(r => r.type === 'dish' && r.active !== false);
  const sales  = records.filter(r => r.type === 'dish_sale');

  const dailyConsumption = new Array(horizon).fill(0);
  const contributingDishes = [];

  for (const dish of dishes) {
    if (!Array.isArray(dish.ingredients)) continue;
    const ingredient = dish.ingredients.find(i => i.productId === productId);
    if (!ingredient || !ingredient.quantity) continue;

    const forecast = forecastDishDaily(sales, dish.id, { ...opts, horizonDays: horizon });
    let dishTotal = 0;
    for (let i = 0; i < horizon; i++) {
      const consumption = forecast[i].forecast * Number(ingredient.quantity);
      dailyConsumption[i] += consumption;
      dishTotal += consumption;
    }
    if (dishTotal > 0) {
      contributingDishes.push({
        dishId: dish.id,
        dishName: dish.name,
        ingredientQty: Number(ingredient.quantity),
        forecastedConsumption: dishTotal,
      });
    }
  }

  return {
    dailyConsumption,
    totalConsumption: dailyConsumption.reduce((a, b) => a + b, 0),
    contributingDishes: contributingDishes.sort((a, b) => b.forecastedConsumption - a.forecastedConsumption),
  };
}

/**
 * MAPE (mean absolute percentage error) — для самотестирования модели.
 * Вход: массив { actual, forecast }. Возвращает 0..∞ (%), null если нет данных.
 */
export function computeMAPE(pairs) {
  const valid = pairs.filter(p => Number.isFinite(p.actual) && p.actual > 0 && Number.isFinite(p.forecast));
  if (valid.length === 0) return null;
  const sum = valid.reduce((s, p) => s + Math.abs((p.actual - p.forecast) / p.actual), 0);
  return (sum / valid.length) * 100;
}
