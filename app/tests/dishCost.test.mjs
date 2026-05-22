/*
 * Unit-тесты себестоимости блюд из рецептуры + цен поставщиков.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  cheapestPriceForProduct,
  computeDishCost,
  computeDishEconomics,
} from '../client/src/utils/dishCost.js';

const suppliers = [
  { id: 's1', name: 'Active 1',  status: 'active' },
  { id: 's2', name: 'Active 2',  status: 'active' },
  { id: 's3', name: 'Paused',    status: 'paused' },
];

const supplierItems = [
  { id: 'i1', supplierId: 's1', productId: 'p_flour',  price: 1.20 },
  { id: 'i2', supplierId: 's2', productId: 'p_flour',  price: 1.05 }, // cheapest
  { id: 'i3', supplierId: 's3', productId: 'p_flour',  price: 0.50 }, // paused
  { id: 'i4', supplierId: 's1', productId: 'p_butter', price: 8.50 },
  { id: 'i5', supplierId: 's2', productId: 'p_milk',   price: 2.10 },
];

describe('cheapestPriceForProduct', () => {
  test('returns lowest price from active suppliers', () => {
    assert.equal(cheapestPriceForProduct('p_flour', supplierItems, suppliers), 1.05);
  });

  test('ignores paused suppliers even if cheaper', () => {
    // s3 has flour at 0.50 but is paused → s2 at 1.05 wins
    const r = cheapestPriceForProduct('p_flour', supplierItems, suppliers);
    assert.equal(r, 1.05);
  });

  test('returns null when no supplier carries product', () => {
    assert.equal(cheapestPriceForProduct('p_unknown', supplierItems, suppliers), null);
  });

  test('returns null when product carried only by paused supplier', () => {
    const items = [{ id: 'x', supplierId: 's3', productId: 'p_x', price: 1 }];
    assert.equal(cheapestPriceForProduct('p_x', items, suppliers), null);
  });

  test('handles null productId gracefully', () => {
    assert.equal(cheapestPriceForProduct(null, supplierItems, suppliers), null);
  });

  test('single-source product returns that price', () => {
    assert.equal(cheapestPriceForProduct('p_butter', supplierItems, suppliers), 8.50);
  });
});

describe('computeDishCost', () => {
  test('dish without ingredients returns cost=null', () => {
    const r = computeDishCost({ ingredients: [] }, supplierItems, suppliers);
    assert.equal(r.cost, null);
    assert.deepEqual(r.lineItems, []);
    assert.deepEqual(r.missing, []);
  });

  test('null dish returns cost=null', () => {
    const r = computeDishCost(null, supplierItems, suppliers);
    assert.equal(r.cost, null);
  });

  test('sums recipe by cheapest supplier prices', () => {
    const dish = {
      ingredients: [
        { productId: 'p_flour',  quantity: 0.5 },  // 0.5 × 1.05 = 0.525
        { productId: 'p_butter', quantity: 0.1 },  // 0.1 × 8.50 = 0.85
        { productId: 'p_milk',   quantity: 0.25 }, // 0.25 × 2.10 = 0.525
      ],
    };
    const r = computeDishCost(dish, supplierItems, suppliers);
    assert.ok(Math.abs(r.cost - 1.9) < 0.01, `expected 1.90, got ${r.cost}`);
    assert.equal(r.lineItems.length, 3);
    assert.deepEqual(r.missing, []);
  });

  test('skips zero or invalid quantities', () => {
    const dish = {
      ingredients: [
        { productId: 'p_flour', quantity: 0.5 },
        { productId: 'p_butter', quantity: 0 },     // skip
        { productId: 'p_milk', quantity: -1 },      // skip
      ],
    };
    const r = computeDishCost(dish, supplierItems, suppliers);
    assert.equal(r.lineItems.length, 1);
  });

  test('records missing productIds without crashing', () => {
    const dish = {
      ingredients: [
        { productId: 'p_flour', quantity: 0.5 },
        { productId: 'p_yeast', quantity: 0.01 },   // no supplier
      ],
    };
    const r = computeDishCost(dish, supplierItems, suppliers);
    assert.equal(r.lineItems.length, 1);
    assert.deepEqual(r.missing, ['p_yeast']);
    // cost only includes available items
    assert.ok(Math.abs(r.cost - 0.525) < 0.01);
  });

  test('all ingredients missing → cost=null', () => {
    const dish = {
      ingredients: [{ productId: 'p_unknown', quantity: 1 }],
    };
    const r = computeDishCost(dish, supplierItems, suppliers);
    assert.equal(r.cost, null);
    assert.equal(r.missing.length, 1);
  });
});

describe('computeDishEconomics', () => {
  const dish = {
    sellPrice: 5.00,
    ingredients: [
      { productId: 'p_flour',  quantity: 0.5 },   // 0.525
      { productId: 'p_butter', quantity: 0.1 },   // 0.85
      { productId: 'p_milk',   quantity: 0.25 },  // 0.525
    ],
  };

  test('computes margin and food cost % when sellPrice present', () => {
    const r = computeDishEconomics(dish, supplierItems, suppliers);
    assert.ok(Math.abs(r.cost - 1.9) < 0.01);
    assert.equal(r.sellPrice, 5.00);
    assert.ok(Math.abs(r.margin - 3.1) < 0.01);
    assert.ok(Math.abs(r.foodCostPct - 38.0) < 0.5);
  });

  test('sellPrice=0 → margin null (treated as not set)', () => {
    const r = computeDishEconomics({ ...dish, sellPrice: 0 }, supplierItems, suppliers);
    assert.equal(r.margin, null);
    assert.equal(r.foodCostPct, null);
    assert.equal(r.sellPrice, null);
  });

  test('no sellPrice → margin null but cost still computed', () => {
    const { sellPrice, ...withoutPrice } = dish;
    const r = computeDishEconomics(withoutPrice, supplierItems, suppliers);
    assert.ok(r.cost > 0);
    assert.equal(r.margin, null);
    assert.equal(r.foodCostPct, null);
  });

  test('empty recipe → everything null', () => {
    const r = computeDishEconomics({ sellPrice: 5, ingredients: [] }, supplierItems, suppliers);
    assert.equal(r.cost, null);
    assert.equal(r.margin, null);
  });

  test('negative margin (cost > sellPrice) handled', () => {
    const r = computeDishEconomics({ ...dish, sellPrice: 1.5 }, supplierItems, suppliers);
    assert.ok(r.margin < 0, 'margin should be negative for underpriced dish');
    assert.ok(r.foodCostPct > 100, 'food cost % should exceed 100% when underpriced');
  });
});
