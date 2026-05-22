import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { simulatePriceChange, recentVolume, priceForTargetFC } from '../client/src/utils/whatIf.js';

function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function buildSales(dishId, dailyCounts) {
  const sales = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < dailyCounts.length; i++) {
    const d = new Date(today.getTime() - (dailyCounts.length - 1 - i) * 86_400_000);
    sales.push({ type: 'dish_sale', dishId, date: localIso(d), count: dailyCounts[i] });
  }
  return sales;
}

const product = { id: 'p_meat', type: 'product', name: 'Курица', unit: 'кг' };
const supplier = { id: 's1', type: 'supplier', name: 'A', status: 'active' };
const supplierItem = { type: 'supplier_item', supplierId: 's1', productId: 'p_meat', price: 10 };

const dish = {
  id: 'd_burger', type: 'dish', name: 'Burger', active: true,
  sellPrice: 20,
  ingredients: [{ productId: 'p_meat', quantity: 0.5 }], // cost = 0.5 × 10 = 5 BYN
};

describe('recentVolume', () => {
  test('sums dish_sale count over last N days', () => {
    const sales = buildSales('d_burger', [1, 2, 3, 4, 5, 6, 7]); // 7 days
    assert.equal(recentVolume(sales, 'd_burger', 7), 28);
  });

  test('returns 0 for unknown dish', () => {
    const sales = buildSales('d_burger', [10, 10]);
    assert.equal(recentVolume(sales, 'd_unknown', 7), 0);
  });
});

describe('simulatePriceChange', () => {
  const supplierItems = [supplierItem];
  const suppliers = [supplier];

  test('happy path — price up improves margin & weekly delta', () => {
    const sales = buildSales('d_burger', [10, 10, 10, 10, 10, 10, 10]); // 70/week
    const r = simulatePriceChange(dish, 25, supplierItems, suppliers, sales);
    assert.ok(r.feasible);
    assert.equal(r.cost, 5);
    assert.equal(r.currentMargin, 15);
    assert.equal(r.newMargin, 20);
    assert.equal(r.marginDelta, 5);
    assert.equal(r.volumeRecent, 70);
    assert.equal(r.weeklyMarginDelta, 350); // 5 × 70
    assert.ok(r.newFC < r.currentFC);
  });

  test('price down — newFC > currentFC, marginDelta negative', () => {
    const sales = buildSales('d_burger', [5, 5, 5, 5, 5, 5, 5]);
    const r = simulatePriceChange(dish, 15, supplierItems, suppliers, sales);
    assert.equal(r.newMargin, 10);
    assert.equal(r.marginDelta, -5);
    assert.equal(r.weeklyMarginDelta, -175); // -5 × 35
    assert.ok(r.newFC > r.currentFC);
  });

  test('warns when newMargin negative', () => {
    const r = simulatePriceChange(dish, 4, [supplierItem], [supplier], []);
    assert.ok(r.feasible);
    assert.equal(r.newMargin, -1);
    assert.ok(r.warnings.some(w => /отрицательная/.test(w)));
  });

  test('warns on high FC > 40%', () => {
    const r = simulatePriceChange(dish, 10, [supplierItem], [supplier], []); // FC = 50%
    assert.ok(r.warnings.some(w => /Food Cost/.test(w)));
  });

  test('infeasible when cost cannot be computed (no supplier)', () => {
    const r = simulatePriceChange(dish, 25, [], [], []);
    assert.equal(r.feasible, false);
    assert.equal(r.cost, null);
    assert.ok(r.warnings.some(w => /Нет себестоимости/.test(w)));
  });

  test('infeasible when newSellPrice <= 0', () => {
    const r = simulatePriceChange(dish, 0, [supplierItem], [supplier], []);
    assert.equal(r.feasible, false);
  });

  test('handles dish without current sellPrice — currentMargin null but newMargin computed', () => {
    const dishNoPrice = { ...dish, sellPrice: null };
    const r = simulatePriceChange(dishNoPrice, 25, [supplierItem], [supplier], []);
    assert.ok(r.feasible);
    assert.equal(r.currentMargin, null);
    assert.equal(r.currentFC, null);
    assert.equal(r.newMargin, 20);
    // marginDelta измеряется от 0 в этом случае
    assert.equal(r.marginDelta, 20);
  });

  test('volume window is respected (default 7d)', () => {
    const sales = buildSales('d_burger', [100, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5]); // 14 days
    const r = simulatePriceChange(dish, 25, [supplierItem], [supplier], sales, { volumeDays: 7 });
    assert.equal(r.volumeRecent, 35); // только последние 7 дней
  });
});

describe('priceForTargetFC', () => {
  test('returns cost / (target / 100)', () => {
    assert.equal(priceForTargetFC(5, 25), 20);
    assert.equal(priceForTargetFC(8, 40), 20);
  });

  test('returns null for invalid inputs', () => {
    assert.equal(priceForTargetFC(0, 30), null);
    assert.equal(priceForTargetFC(5, 0), null);
    assert.equal(priceForTargetFC(5, 120), null);
    assert.equal(priceForTargetFC(NaN, 30), null);
  });
});
