/*
 * Stock status — единый сигнал «заканчивается / закончился» для UI склада
 * и точки входа в заказ от склада (см. docs/08-technical/12-order-from-stock-spec.md).
 *
 * Источники сигнала (приоритет сверху вниз):
 *   1. stock = 0                                    → 'out'
 *   2. product.reorderPoint && stock < reorderPoint → 'low-manual'
 *   3. forecast > stock (recommendForProduct)       → 'low-forecast'
 *   4. иначе                                        → 'ok'
 *
 * recommendForProduct возвращает null, если у продукта нет продаж/рецепта
 * или forecast меньше остатка — тогда мы не показываем low-forecast.
 * Это значит, что для расходников без рецепта (упаковка, химия) единственный
 * способ получить сигнал — ручной reorderPoint.
 */
import { currentStockForProduct, recommendForProduct } from './recommendations.js';

export function stockStatusForProduct(records, productId) {
  const product = records.find(r => r.type === 'product' && r.id === productId);
  if (!product) return null;

  const stock = currentStockForProduct(records, productId);
  const rec   = recommendForProduct(records, productId);

  let status;
  if (stock <= 0)                                                       status = 'out';
  else if (product.reorderPoint != null && stock < product.reorderPoint) status = 'low-manual';
  else if (rec !== null)                                                 status = 'low-forecast';
  else                                                                   status = 'ok';

  return {
    status,
    stock,
    reorderPoint:     product.reorderPoint ?? null,
    suggestedQty:     rec?.suggestedQty    ?? null,
    cheapestSupplier: rec?.factors.cheapestSupplier ?? null,
    factors:          rec?.factors ?? null,
  };
}

/**
 * Текст для tooltip — почему товар попал в low/out.
 */
export function explainStockStatus(s, unit) {
  if (!s) return '';
  if (s.status === 'out') return 'Остаток нулевой';
  if (s.status === 'low-manual') {
    return `Остаток ${s.stock} ${unit} ниже порога ${s.reorderPoint} ${unit}`;
  }
  if (s.status === 'low-forecast' && s.factors) {
    const horizon = s.factors.horizonDays;
    const total   = s.factors.totalConsumption.toFixed(1);
    return `Прогноз: ~${total} ${unit} на ${horizon} дн., остаток ${s.stock} ${unit}`;
  }
  return '';
}

/**
 * Карта productId → status — удобно строить один раз в useMemo для всей вкладки.
 */
export function buildStockStatusMap(records, products) {
  const map = new Map();
  for (const p of products) {
    map.set(p.id, stockStatusForProduct(records, p.id));
  }
  return map;
}
