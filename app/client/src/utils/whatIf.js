/*
 * AI06 / US-06 — Сценарное моделирование «что если» для блюда.
 *
 * Пользовательский сценарий: «если я подниму цену на пиццу с 22 до 24 BYN,
 * что будет с маржой и с недельной прибылью при текущем объёме продаж?».
 *
 * Вход:
 *   - dish с рецептом + текущим sellPrice
 *   - newSellPrice (или scenario.priceDeltaPct)
 *   - sales (dish_sale records) — для оценки объёма
 *
 * Логика:
 *   - cost остаётся прежним (рецепт + текущие цены поставщиков)
 *   - currentMargin = current sellPrice − cost
 *   - newMargin     = newSellPrice − cost
 *   - volume7d      = сумма count за последние 7 дней
 *   - deltaPerWeek  = (newMargin − currentMargin) × volume7d
 *
 * Допущение: эластичность спроса = 0 (объём не меняется). Это сознательно
 * простая модель — менеджер сам решит, реалистична ли его цена. В будущем
 * можно добавить эластичность по категории (paste/burger чувствительнее
 * к цене, чем coffee/wine).
 */

import { computeDishEconomics } from './dishCost.js';
import { toIsoDate, salesInPeriod } from './dishSales.js';
import { DAY_MS } from './time.js';

/**
 * Объём продаж блюда за последние N дней (по умолчанию 7).
 */
export function recentVolume(sales, dishId, days = 7) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startIso = toIsoDate(new Date(today.getTime() - (days - 1) * DAY_MS));
  const endIso   = toIsoDate(today);
  return salesInPeriod(sales, dishId, startIso, endIso);
}

/**
 * Симуляция изменения цены блюда.
 *
 * @param {Object} dish — запись блюда (с ingredients[] и sellPrice)
 * @param {number} newSellPrice — новая цена в BYN
 * @param {Array}  supplierItems
 * @param {Array}  suppliers
 * @param {Array}  sales — dish_sale records (venue-filtered)
 * @param {{ volumeDays?: 7 }} opts
 * @returns {{
 *   cost, currentSellPrice, newSellPrice,
 *   currentMargin, newMargin, marginDelta,
 *   currentFC, newFC, fcDelta,
 *   volumeRecent, volumeDays,
 *   weeklyMarginDelta, // суммарный сдвиг недельной маржи
 *   feasible: boolean, // false если cost null или newSellPrice <= 0
 *   warnings: string[],
 * } | null}
 */
export function simulatePriceChange(dish, newSellPrice, supplierItems, suppliers, sales, opts = {}) {
  if (!dish) return null;
  const days = opts.volumeDays ?? 7;

  const econ = computeDishEconomics(dish, supplierItems, suppliers);
  const warnings = [];

  const currentSellPrice = Number(dish.sellPrice);
  const validNewPrice = Number.isFinite(newSellPrice) && newSellPrice > 0;
  const validCurrentPrice = Number.isFinite(currentSellPrice) && currentSellPrice > 0;
  const feasible = econ.cost !== null && validNewPrice;

  if (econ.cost === null) warnings.push('Нет себестоимости — не все ингредиенты с активным поставщиком');
  if (!validCurrentPrice)  warnings.push('У блюда не задана текущая цена — Δ маржи показывается от 0');
  if (!validNewPrice)      warnings.push('Введите положительную цену для симуляции');

  if (!feasible) {
    return {
      cost: econ.cost,
      currentSellPrice: validCurrentPrice ? currentSellPrice : null,
      newSellPrice:     validNewPrice ? newSellPrice : null,
      currentMargin: null, newMargin: null, marginDelta: null,
      currentFC: null, newFC: null, fcDelta: null,
      volumeRecent: recentVolume(sales, dish.id, days),
      volumeDays: days,
      weeklyMarginDelta: null,
      feasible: false,
      warnings,
    };
  }

  const cost          = econ.cost;
  const currentMargin = validCurrentPrice ? (currentSellPrice - cost) : 0;
  const newMargin     = newSellPrice - cost;
  const marginDelta   = newMargin - currentMargin;
  const currentFC     = validCurrentPrice ? (cost / currentSellPrice * 100) : null;
  const newFC         = cost / newSellPrice * 100;
  const fcDelta       = currentFC !== null ? (newFC - currentFC) : null;
  const volume        = recentVolume(sales, dish.id, days);
  const weeklyMarginDelta = marginDelta * volume;

  if (newMargin < 0) warnings.push('Новая маржа отрицательная — будет убыток на каждой порции');
  if (newFC > 40)    warnings.push(`Новый Food Cost ${newFC.toFixed(0)}% — выше типового порога 40%`);

  return {
    cost,
    currentSellPrice: validCurrentPrice ? currentSellPrice : null,
    newSellPrice,
    currentMargin: validCurrentPrice ? currentMargin : null,
    newMargin,
    marginDelta,
    currentFC,
    newFC,
    fcDelta,
    volumeRecent: volume,
    volumeDays: days,
    weeklyMarginDelta,
    feasible: true,
    warnings,
  };
}

/**
 * Рекомендация цены: при заданном целевом Food Cost % считаем,
 * какая цена даёт ровно этот FC.
 *   targetSellPrice = cost / (targetFcPct / 100)
 * Возвращает null если cost не известен или targetFcPct невалиден.
 */
export function priceForTargetFC(cost, targetFcPct) {
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (!Number.isFinite(targetFcPct) || targetFcPct <= 0 || targetFcPct >= 100) return null;
  return cost / (targetFcPct / 100);
}
