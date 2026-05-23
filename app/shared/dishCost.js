/*
 * Себестоимость блюда на основе рецептуры (dish.ingredients[]) и текущих
 * цен поставщиков (supplier_item). Чистые функции, без зависимостей от React.
 *
 * Логика «самой дешёвой цены»:
 *   - Для каждого ингредиента находим все supplier_item с этим productId.
 *   - Исключаем позиции от приостановленных поставщиков (status='paused').
 *   - Берём минимум по цене. Если активных поставщиков нет — null.
 *
 * Для R3 здесь же можно будет учитывать min_qty, рейтинг поставщика, срок
 * доставки. Сейчас простейшая стратегия «дешевле = лучше».
 */

/**
 * @param {string} productId
 * @param {Array} supplierItems
 * @param {Array} suppliers
 * @returns {number|null} минимальная цена или null если нет активных поставщиков
 */
export function cheapestPriceForProduct(productId, supplierItems, suppliers) {
  if (!productId) return null;
  const supplierMap = new Map(suppliers.map(s => [s.id, s]));
  const prices = supplierItems
    .filter(i => i.productId === productId)
    .filter(i => supplierMap.get(i.supplierId)?.status !== 'paused')
    .map(i => Number(i.price))
    .filter(p => Number.isFinite(p) && p >= 0);
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

/**
 * Считает себестоимость одной порции блюда.
 * Возвращает { cost, missing, lineItems }:
 *   cost      — сумма; null если у блюда нет рецепта или все ингредиенты missing
 *   missing   — productId-ы, для которых не нашлось активного поставщика
 *   lineItems — построчная разбивка для UI-drilldown
 */
export function computeDishCost(dish, supplierItems, suppliers) {
  if (!dish || !Array.isArray(dish.ingredients) || dish.ingredients.length === 0) {
    return { cost: null, missing: [], lineItems: [] };
  }
  const lineItems = [];
  const missing = [];
  let total = 0;
  for (const ing of dish.ingredients) {
    if (!ing.productId || !ing.quantity || ing.quantity <= 0) continue;
    const price = cheapestPriceForProduct(ing.productId, supplierItems, suppliers);
    if (price === null) {
      missing.push(ing.productId);
      continue;
    }
    const lineTotal = ing.quantity * price;
    total += lineTotal;
    lineItems.push({
      productId: ing.productId,
      qty:       ing.quantity,
      unitPrice: price,
      total:     lineTotal,
    });
  }
  return {
    cost:     lineItems.length > 0 ? total : null,
    missing,
    lineItems,
  };
}

/**
 * Расширенная экономика блюда — себестоимость + маржа + Food Cost %.
 * sellPrice берётся из dish.sellPrice (опциональное поле).
 * Если sellPrice не задан или cost не посчитан — margin/foodCostPct = null.
 */
export function computeDishEconomics(dish, supplierItems, suppliers) {
  const { cost, missing, lineItems } = computeDishCost(dish, supplierItems, suppliers);
  const sellPrice = Number(dish?.sellPrice);
  const hasSellPrice = Number.isFinite(sellPrice) && sellPrice > 0;
  if (cost === null || !hasSellPrice) {
    return {
      cost,
      sellPrice: hasSellPrice ? sellPrice : null,
      margin: null,
      foodCostPct: null,
      missing,
      lineItems,
    };
  }
  return {
    cost,
    sellPrice,
    margin:      sellPrice - cost,
    foodCostPct: (cost / sellPrice) * 100,
    missing,
    lineItems,
  };
}
