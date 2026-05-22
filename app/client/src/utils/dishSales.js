/*
 * Агрегация продаж блюд (record type: 'dish_sale').
 *
 * Хранение: одна запись на (dishId, date, venueId) с count = N порций.
 * При повторном вводе для тех же ключей — UPDATE существующей записи,
 * не INSERT новой (см. upsertDishSale в DishSalesModal).
 *
 * Этот модуль — чистые читающие функции. Запись идёт через api.records.
 */

// toIsoDate переехал в utils/time.js — единый источник истины.
// Re-export сохраняем для обратной совместимости с существующими импортами.
export { toIsoDate } from './time.js';

/**
 * Найти запись dish_sale для (dishId, date). Дата сравнивается как строка.
 * Возвращает запись или null.
 */
export function findSaleRecord(sales, dishId, date) {
  return sales.find(s => s.dishId === dishId && s.date === date) || null;
}

/**
 * Подсчитать суммарные продажи блюда за период (start..end inclusive).
 * @param {Array} sales — все dish_sale записи (уже отфильтрованы по venue)
 * @param {string} dishId
 * @param {string} startDate — YYYY-MM-DD
 * @param {string} endDate — YYYY-MM-DD
 * @returns {number} сумма count
 */
export function salesInPeriod(sales, dishId, startDate, endDate) {
  return sales
    .filter(s => s.dishId === dishId)
    .filter(s => s.date >= startDate && s.date <= endDate)
    .reduce((sum, s) => sum + (Number(s.count) || 0), 0);
}

/**
 * Карта dishId → суммарное количество за период.
 * Удобно для одного прохода по продажам, когда нужны цифры для всех блюд сразу.
 */
export function salesMapByDish(sales, startDate, endDate) {
  const m = new Map();
  for (const s of sales) {
    if (s.date < startDate || s.date > endDate) continue;
    m.set(s.dishId, (m.get(s.dishId) || 0) + (Number(s.count) || 0));
  }
  return m;
}

/**
 * Дневной паттерн (по dayOfWeek 0..6, 0=Sun) для блюда.
 * Возвращает массив из 7 средних count по дню недели.
 * Используется в Sprint 2 для weekday-seasonality в forecast.
 */
export function weekdayPattern(sales, dishId, lookbackDays = 28) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffIso = toIsoDate(cutoff);

  const buckets = [[], [], [], [], [], [], []]; // 0..6 = Sun..Sat
  for (const s of sales) {
    if (s.dishId !== dishId) continue;
    if (s.date < cutoffIso) continue;
    const wd = new Date(s.date).getDay();
    buckets[wd].push(Number(s.count) || 0);
  }
  return buckets.map(b => b.length ? b.reduce((a, c) => a + c, 0) / b.length : 0);
}
