import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentStockForProduct,
  cheapestSupplierForProduct,
  recommendForProduct,
  buildAllRecommendations,
  computeARAR,
} from '../client/src/utils/recommendations.js';

function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function buildSales(dishId, dailyCounts) {
  const sales = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < dailyCounts.length; i++) {
    const d = new Date(today.getTime() - (dailyCounts.length - i) * 86_400_000);
    sales.push({ type: 'dish_sale', dishId, date: localIso(d), count: dailyCounts[i] });
  }
  return sales;
}

const product = { id: 'p_meat', type: 'product', name: 'Курица', unit: 'кг' };
const supplier1 = { id: 's1', type: 'supplier', name: 'Поставщик А', status: 'active' };
const supplier2 = { id: 's2', type: 'supplier', name: 'Поставщик Б', status: 'active' };
const supplierPaused = { id: 's3', type: 'supplier', name: 'Пауз', status: 'paused' };

describe('currentStockForProduct', () => {
  test('returns 0 when no entries', () => {
    assert.equal(currentStockForProduct([product], 'p_meat'), 0);
  });

  test('returns most recent resulting', () => {
    const records = [
      product,
      { type: 'stock_entry', productId: 'p_meat', resulting: 10, createdAt: 1000 },
      { type: 'stock_entry', productId: 'p_meat', resulting: 5,  createdAt: 2000 },
      { type: 'stock_entry', productId: 'p_meat', resulting: 8,  createdAt: 1500 },
    ];
    assert.equal(currentStockForProduct(records, 'p_meat'), 5);
  });
});

describe('cheapestSupplierForProduct', () => {
  const items = [
    { type: 'supplier_item', supplierId: 's1', productId: 'p_meat', price: 10, deliveryDays: 2, minQty: 5 },
    { type: 'supplier_item', supplierId: 's2', productId: 'p_meat', price: 8,  deliveryDays: 3, minQty: 10 },
    { type: 'supplier_item', supplierId: 's3', productId: 'p_meat', price: 5,  deliveryDays: 1, minQty: 1 }, // paused, ignored
  ];

  test('picks lowest-price active supplier', () => {
    const r = cheapestSupplierForProduct([supplier1, supplier2, supplierPaused, ...items], 'p_meat');
    assert.equal(r.supplier.id, 's2');
    assert.equal(r.price, 8);
    assert.equal(r.leadTimeDays, 3);
    assert.equal(r.minQty, 10);
  });

  test('returns null if no active supplier', () => {
    const r = cheapestSupplierForProduct([supplierPaused, items[2]], 'p_meat');
    assert.equal(r, null);
  });
});

describe('recommendForProduct — happy path', () => {
  const dishes = [
    { type: 'dish', id: 'd_burger', active: true, name: 'Burger',
      ingredients: [{ productId: 'p_meat', quantity: 0.2 }] },
  ];
  const sales = buildSales('d_burger', Array(28).fill(10)); // 10 burgers/day → 2 kg/day consumption
  const supplierItem = { type: 'supplier_item', supplierId: 's1', productId: 'p_meat', price: 10, deliveryDays: 2, minQty: 0 };
  const baseRecords = [product, supplier1, supplierItem, ...dishes, ...sales];

  test('recommends when stock too low for lead time + safety', () => {
    // lead=2, safety=1, horizon=3 → consumption ~6 kg
    // currentStock=1 → needed ~5 kg
    const records = [...baseRecords, { type: 'stock_entry', productId: 'p_meat', resulting: 1, createdAt: Date.now() }];
    const r = recommendForProduct(records, 'p_meat');
    assert.ok(r);
    assert.ok(r.rawNeeded > 4 && r.rawNeeded < 6);
    assert.ok(r.suggestedQty >= r.rawNeeded);
    assert.equal(r.factors.leadTimeDays, 2);
    assert.equal(r.factors.safetyDays, 1);
    assert.equal(r.factors.cheapestSupplier.supplier.id, 's1');
    assert.equal(r.factors.contributingDishes.length, 1);
  });

  test('returns null when stock is sufficient', () => {
    const records = [...baseRecords, { type: 'stock_entry', productId: 'p_meat', resulting: 100, createdAt: Date.now() }];
    const r = recommendForProduct(records, 'p_meat');
    assert.equal(r, null);
  });

  test('returns null when no forecast (no recipe / no sales)', () => {
    const records = [product, supplier1, supplierItem];
    const r = recommendForProduct(records, 'p_meat');
    assert.equal(r, null);
  });

  test('uses minQty rounding when supplier requires bulk', () => {
    const recordsWithBulk = baseRecords.map(r => r.type === 'supplier_item'
      ? { ...r, minQty: 5 } : r);
    const records = [...recordsWithBulk, { type: 'stock_entry', productId: 'p_meat', resulting: 0, createdAt: Date.now() }];
    const r = recommendForProduct(records, 'p_meat');
    // suggestedQty должно быть кратно 5
    assert.equal(r.suggestedQty % 5, 0);
    assert.ok(r.suggestedQty >= r.rawNeeded);
  });

  test('factors contain dailyForecast for explainability', () => {
    const records = [...baseRecords, { type: 'stock_entry', productId: 'p_meat', resulting: 0, createdAt: Date.now() }];
    const r = recommendForProduct(records, 'p_meat');
    assert.equal(r.factors.dailyForecast.length, r.factors.horizonDays);
    r.factors.dailyForecast.forEach(d => assert.ok(d > 0));
  });
});

describe('buildAllRecommendations', () => {
  test('sorts by urgency: stock=0 first, then by needed desc', () => {
    const products = [
      { type: 'product', id: 'p1', name: 'P1', unit: 'кг' },
      { type: 'product', id: 'p2', name: 'P2', unit: 'кг' },
      { type: 'product', id: 'p3', name: 'P3', unit: 'кг' },
    ];
    const dishes = [
      { type: 'dish', id: 'd1', active: true, name: 'D1',
        ingredients: [{ productId: 'p1', quantity: 0.5 }, { productId: 'p2', quantity: 1 }, { productId: 'p3', quantity: 2 }] },
    ];
    const sales = buildSales('d1', Array(28).fill(5)); // 5/day
    const supplierItems = [
      { type: 'supplier_item', supplierId: 's1', productId: 'p1', price: 1, deliveryDays: 2 },
      { type: 'supplier_item', supplierId: 's1', productId: 'p2', price: 1, deliveryDays: 2 },
      { type: 'supplier_item', supplierId: 's1', productId: 'p3', price: 1, deliveryDays: 2 },
    ];
    const stockEntries = [
      // p1: stock 100 (enough)
      { type: 'stock_entry', productId: 'p1', resulting: 100, createdAt: Date.now() },
      // p2: stock 0 (urgent)
      { type: 'stock_entry', productId: 'p2', resulting: 0, createdAt: Date.now() },
      // p3: stock 5 (need a lot, 5/day × 0.5 × 30 days)
      { type: 'stock_entry', productId: 'p3', resulting: 5, createdAt: Date.now() },
    ];
    const records = [...products, supplier1, ...supplierItems, ...dishes, ...sales, ...stockEntries];
    const recs = buildAllRecommendations(records);
    // p1 stock достаточно → нет в списке
    assert.equal(recs.find(r => r.productId === 'p1'), undefined);
    // p2 stock=0 — должен быть первым
    assert.equal(recs[0].productId, 'p2');
  });
});

describe('computeARAR', () => {
  test('returns null arar on empty', () => {
    assert.equal(computeARAR([]).arar, null);
  });

  test('100% acceptance → 100% ARAR', () => {
    const r = computeARAR([
      { action: 'accepted' }, { action: 'accepted' }, { action: 'accepted' },
    ]);
    assert.equal(r.arar, 100);
  });

  test('mixed accepted + adjusted counted as accepted, rejected lowers', () => {
    const r = computeARAR([
      { action: 'accepted' }, { action: 'adjusted' },
      { action: 'rejected' }, { action: 'rejected' },
    ]);
    // 2/4 = 50%
    assert.equal(r.arar, 50);
    assert.equal(r.accepted, 1);
    assert.equal(r.adjusted, 1);
    assert.equal(r.rejected, 2);
  });

  test('ignores unknown action types', () => {
    const r = computeARAR([
      { action: 'accepted' }, { action: 'unknown' }, { action: 'rejected' },
    ]);
    assert.equal(r.total, 2);
    assert.equal(r.arar, 50);
  });
});
