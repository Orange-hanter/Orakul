/*
 * F03 / US-02 «Факт vs Норма» по списанию ингредиентов.
 *
 * Для каждого продукта-ингредиента считаем:
 *   theoretical  — сумма (ingredient.quantity × dish_sale.count) по всем продажам
 *                  блюд, в рецепт которых входит продукт. Что должно было быть
 *                  списано по нормам, если продажи равны введённым.
 *   actual       — сумма |stock_entry.delta| за период, где
 *                    kind === 'writeoff' ИЛИ (kind === 'inventory' И delta < 0)
 *                  Что реально вышло со склада.
 *   diff         — actual − theoretical
 *   diffPct      — diff / theoretical × 100 (или null если theoretical=0)
 *
 * Классификация:
 *   ok      — |diffPct| ≤ 10%        — норма в пределах допустимого
 *   over    — diffPct > 10%           — переЛИШНИЙ расход (потеря)
 *   under   — diffPct < −10%          — НЕДОсписано (продажи без расхода ингредиентов?)
 *   no-data — theoretical = 0 ИЛИ actual = 0 — нет основы для сравнения
 *
 * Контракт чистой функции:
 *   computeWriteoffControl(records, period) → array sorted by abs(diff) desc
 */

const DAY_MS = 86_400_000;

function inPeriod(ts, period) {
  if (!ts) return false;
  return ts >= period.start.getTime() && ts <= period.end.getTime();
}

function isoInPeriod(iso, period) {
  if (!iso) return false;
  const startIso = period.start.toISOString().slice(0, 10);
  const endIso   = period.end.toISOString().slice(0, 10);
  return iso >= startIso && iso <= endIso;
}

export function classifyDiff(theoretical, actual) {
  if (theoretical === 0 && actual === 0) return 'no-data';
  if (theoretical === 0) return 'no-data';   // нечего сравнивать
  const diffPct = (actual - theoretical) / theoretical * 100;
  if (diffPct > 10)  return 'over';
  if (diffPct < -10) return 'under';
  return 'ok';
}

/**
 * @param {Array} records — venue-filtered записи (приходит из ctx)
 * @param {{ start: Date, end: Date }} period
 * @returns массив строк: { productId, productName, unit, theoretical, actual, diff, diffPct, status }
 */
export function computeWriteoffControl(records, period) {
  const dishes  = records.filter(r => r.type === 'dish' && r.active !== false);
  const sales   = records.filter(r => r.type === 'dish_sale');
  const entries = records.filter(r => r.type === 'stock_entry');
  const products = records.filter(r => r.type === 'product');
  const productById = new Map(products.map(p => [p.id, p]));

  // 1. Карта productId → theoretical consumption за период
  const theoMap = new Map(); // productId → number
  for (const dish of dishes) {
    if (!Array.isArray(dish.ingredients) || dish.ingredients.length === 0) continue;
    // Сколько порций этого блюда продано за период
    const portions = sales
      .filter(s => s.dishId === dish.id && isoInPeriod(s.date, period))
      .reduce((sum, s) => sum + (Number(s.count) || 0), 0);
    if (portions === 0) continue;
    for (const ing of dish.ingredients) {
      if (!ing.productId || !ing.quantity) continue;
      const contribution = portions * Number(ing.quantity);
      theoMap.set(ing.productId, (theoMap.get(ing.productId) || 0) + contribution);
    }
  }

  // 2. Карта productId → actual outflow за период
  const actualMap = new Map();
  for (const e of entries) {
    if (!inPeriod(e.createdAt, period)) continue;
    if (e.delta == null) continue;
    // Учитываем явные списания и отрицательные инвентаризации
    const isOutflow = e.kind === 'writeoff' || (e.kind === 'inventory' && e.delta < 0);
    if (!isOutflow) continue;
    const out = Math.abs(Number(e.delta) || 0);
    actualMap.set(e.productId, (actualMap.get(e.productId) || 0) + out);
  }

  // 3. Собираем итоговый массив для всех продуктов, у которых хоть где-то есть данные
  const allProductIds = new Set([...theoMap.keys(), ...actualMap.keys()]);
  const rows = [];
  for (const pid of allProductIds) {
    const product = productById.get(pid);
    if (!product) continue; // продукт удалён
    const theoretical = theoMap.get(pid) || 0;
    const actual      = actualMap.get(pid) || 0;
    const diff        = actual - theoretical;
    const diffPct     = theoretical > 0 ? (diff / theoretical * 100) : null;
    const status      = classifyDiff(theoretical, actual);
    rows.push({
      productId: pid,
      productName: product.name,
      unit: product.unit || 'шт',
      theoretical,
      actual,
      diff,
      diffPct,
      status,
    });
  }

  // Сортировка: сначала проблемы (over → under), потом ok, в конце no-data.
  // Внутри группы — по |diff| desc.
  const order = { over: 0, under: 1, ok: 2, 'no-data': 3 };
  rows.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return Math.abs(b.diff) - Math.abs(a.diff);
  });

  return rows;
}

/**
 * Сводная статистика по результату — для KPI/badge.
 */
export function summarizeWriteoffControl(rows) {
  const counts = { over: 0, under: 0, ok: 0, 'no-data': 0 };
  for (const r of rows) counts[r.status]++;
  return counts;
}
