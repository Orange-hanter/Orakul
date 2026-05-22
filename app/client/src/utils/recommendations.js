/*
 * AI02 + AI03 — рекомендации заказов поставщикам с объяснимостью.
 *
 * Логика:
 *   needed = forecast(consumption за lead_time + safety_buffer) − currentStock
 *   if needed > 0 → создаём рекомендацию
 *
 * Каждая рекомендация несёт блок «factors» для US-08 (Always Explain):
 *   - dailyForecast    — прогноз потребления по дням (для UI-графика)
 *   - currentStock     — последний resulting из stock_entry
 *   - leadTimeDays     — берётся из supplier_item.deliveryDays (или дефолт 2)
 *   - safetyDays       — буфер сверх lead time (дефолт 1 день)
 *   - cheapestSupplier — id+name+price выбранного поставщика
 *   - contributingDishes — какие блюда «съедят» этот ингредиент
 *
 * Принцип PRD §3 «Recommend, don't act» — мы только показываем, никаких
 * авто-заказов. Пользователь жмёт 👍/👎/✎ → запишем в record для ARAR.
 */

import { forecastProductConsumption } from './forecast.js';

const DEFAULT_LEAD_TIME = 2;
const DEFAULT_SAFETY    = 1;

/** Текущий остаток продукта = resulting из самой свежей stock_entry. */
export function currentStockForProduct(records, productId) {
  const entries = records
    .filter(r => r.type === 'stock_entry' && r.productId === productId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (entries.length === 0) return 0;
  return Number(entries[0].resulting) || 0;
}

/** Самый дешёвый активный поставщик для продукта + lead-time. */
export function cheapestSupplierForProduct(records, productId) {
  const suppliers = new Map(
    records.filter(r => r.type === 'supplier').map(s => [s.id, s])
  );
  const items = records
    .filter(r => r.type === 'supplier_item' && r.productId === productId)
    .filter(i => suppliers.get(i.supplierId)?.status !== 'paused')
    .filter(i => Number.isFinite(Number(i.price)));
  if (items.length === 0) return null;
  const cheapest = items.reduce((a, b) => (Number(a.price) <= Number(b.price) ? a : b));
  const supplier = suppliers.get(cheapest.supplierId);
  return {
    item: cheapest,
    supplier,
    price: Number(cheapest.price),
    unit: cheapest.unit,
    leadTimeDays: Number(cheapest.deliveryDays) || DEFAULT_LEAD_TIME,
    minQty: Number(cheapest.minQty) || 0,
  };
}

/**
 * Рекомендация по одному продукту.
 * Возвращает null если рецепта нет / прогноз нулевой / запасов достаточно.
 *
 * Контракт возвращаемого объекта:
 *   {
 *     productId, productName, unit,
 *     suggestedQty,    // округлённая
 *     rawNeeded,       // exact
 *     currentStock,
 *     factors: {
 *       dailyForecast, totalConsumption, leadTimeDays, safetyDays,
 *       cheapestSupplier, contributingDishes,
 *     }
 *   }
 */
export function recommendForProduct(records, productId, opts = {}) {
  const safetyDays = opts.safetyDays ?? DEFAULT_SAFETY;

  const product = records.find(r => r.type === 'product' && r.id === productId);
  if (!product) return null;

  const supplier = cheapestSupplierForProduct(records, productId);
  const leadTimeDays = supplier?.leadTimeDays ?? DEFAULT_LEAD_TIME;
  const horizonDays  = leadTimeDays + safetyDays;

  const forecast = forecastProductConsumption(records, productId, { horizonDays });
  if (forecast.totalConsumption === 0) return null;

  const currentStock = currentStockForProduct(records, productId);
  const rawNeeded = forecast.totalConsumption - currentStock;
  if (rawNeeded <= 0) return null;

  // Округление: если есть минимальная партия — кратное; иначе вверх до 0.1
  let suggestedQty;
  if (supplier?.minQty > 0) {
    suggestedQty = Math.ceil(rawNeeded / supplier.minQty) * supplier.minQty;
  } else {
    suggestedQty = Math.ceil(rawNeeded * 10) / 10;
  }

  return {
    productId,
    productName: product.name,
    unit: product.unit || (supplier?.unit || 'шт'),
    suggestedQty,
    rawNeeded,
    currentStock,
    factors: {
      dailyForecast:        forecast.dailyConsumption,
      totalConsumption:     forecast.totalConsumption,
      leadTimeDays,
      safetyDays,
      horizonDays,
      cheapestSupplier:     supplier,
      contributingDishes:   forecast.contributingDishes,
    },
  };
}

/**
 * Все рекомендации по всем продуктам, отсортированы по «срочности»:
 *   - сначала те где currentStock = 0 (already out)
 *   - потом по relative gap (needed / currentStock)
 *   - потом по абсолютной нехватке
 */
export function buildAllRecommendations(records, opts = {}) {
  const products = records.filter(r => r.type === 'product');
  const recs = [];
  for (const p of products) {
    const r = recommendForProduct(records, p.id, opts);
    if (r) recs.push(r);
  }
  recs.sort((a, b) => {
    const ag = a.currentStock === 0 ? 1 : 0;
    const bg = b.currentStock === 0 ? 1 : 0;
    if (ag !== bg) return bg - ag;
    return b.rawNeeded - a.rawNeeded;
  });
  return recs;
}

/**
 * ARAR-метрика по записям action.
 * Источник: type === 'recommendation_action' { recId, action: accepted|adjusted|rejected, comment }
 */
export function computeARAR(actions) {
  if (!actions || actions.length === 0) return { arar: null, total: 0, accepted: 0, adjusted: 0, rejected: 0 };
  const counts = { accepted: 0, adjusted: 0, rejected: 0 };
  for (const a of actions) {
    if (counts[a.action] !== undefined) counts[a.action]++;
  }
  const total = counts.accepted + counts.adjusted + counts.rejected;
  if (total === 0) return { arar: null, total: 0, ...counts };
  const arar = (counts.accepted + counts.adjusted) / total * 100;
  return { arar, total, ...counts };
}
