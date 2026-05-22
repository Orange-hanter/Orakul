import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWriteoffControl,
  summarizeWriteoffControl,
  classifyDiff,
} from '../client/src/utils/writeoffControl.js';

const period = {
  start: new Date('2026-05-01T00:00:00Z'),
  end:   new Date('2026-05-31T23:59:59Z'),
};

const products = [
  { id: 'p_meat',  type: 'product', name: 'Курица',  unit: 'кг' },
  { id: 'p_flour', type: 'product', name: 'Мука',    unit: 'кг' },
  { id: 'p_milk',  type: 'product', name: 'Молоко',  unit: 'л' },
];

const dishes = [
  { id: 'd_burger', type: 'dish', active: true, name: 'Бургер',
    ingredients: [
      { productId: 'p_meat',  quantity: 0.2 },
      { productId: 'p_flour', quantity: 0.1 },
    ] },
  { id: 'd_pancake', type: 'dish', active: true, name: 'Блин',
    ingredients: [
      { productId: 'p_flour', quantity: 0.05 },
      { productId: 'p_milk',  quantity: 0.1 },
    ] },
];

describe('classifyDiff', () => {
  test('ok within 10%', () => {
    assert.equal(classifyDiff(100, 105), 'ok');
    assert.equal(classifyDiff(100, 95), 'ok');
    assert.equal(classifyDiff(100, 110), 'ok'); // exactly 10% is still ok
  });

  test('over > 10%', () => {
    assert.equal(classifyDiff(100, 115), 'over');
    assert.equal(classifyDiff(100, 200), 'over');
  });

  test('under < -10%', () => {
    assert.equal(classifyDiff(100, 85), 'under');
    assert.equal(classifyDiff(100, 0), 'under');
  });

  test('no theoretical → no-data', () => {
    assert.equal(classifyDiff(0, 5), 'no-data');
    assert.equal(classifyDiff(0, 0), 'no-data');
  });
});

describe('computeWriteoffControl — basic', () => {
  test('empty records → empty array', () => {
    const r = computeWriteoffControl([], period);
    assert.deepEqual(r, []);
  });

  test('only dishes (no sales, no stock) → empty', () => {
    const r = computeWriteoffControl([...products, ...dishes], period);
    assert.deepEqual(r, []);
  });
});

describe('computeWriteoffControl — happy path', () => {
  // 10 бургеров продано → 10*0.2=2кг курицы (norm), 10*0.1=1кг муки
  // 5 блинов продано → 5*0.05=0.25кг муки, 5*0.1=0.5л молока
  // Итого по нормам: курица=2, мука=1.25, молоко=0.5
  const sales = [
    { id: 's1', type: 'dish_sale', dishId: 'd_burger',  date: '2026-05-15', count: 10 },
    { id: 's2', type: 'dish_sale', dishId: 'd_pancake', date: '2026-05-16', count: 5 },
  ];
  // Фактические списания:
  //  курица 3кг (norm=2, +50% → over)
  //  мука 1.3кг (norm=1.25, +4% → ok)
  //  молоко 0.4л (norm=0.5, -20% → under)
  const ts = new Date('2026-05-20').getTime();
  const stockEntries = [
    { id: 'e1', type: 'stock_entry', productId: 'p_meat',  kind: 'writeoff', delta: -3,   createdAt: ts, resulting: 0 },
    { id: 'e2', type: 'stock_entry', productId: 'p_flour', kind: 'writeoff', delta: -1.3, createdAt: ts, resulting: 0 },
    { id: 'e3', type: 'stock_entry', productId: 'p_milk',  kind: 'writeoff', delta: -0.4, createdAt: ts, resulting: 0 },
  ];
  const records = [...products, ...dishes, ...sales, ...stockEntries];

  test('classifies each product correctly', () => {
    const rows = computeWriteoffControl(records, period);
    const byId = Object.fromEntries(rows.map(r => [r.productId, r.status]));
    assert.equal(byId.p_meat, 'over');
    assert.equal(byId.p_flour, 'ok');
    assert.equal(byId.p_milk, 'under');
  });

  test('theoretical equals norm × portions sold', () => {
    const rows = computeWriteoffControl(records, period);
    const meat = rows.find(r => r.productId === 'p_meat');
    // 10 бургеров × 0.2 кг
    assert.equal(meat.theoretical, 2);
    const flour = rows.find(r => r.productId === 'p_flour');
    // 10×0.1 + 5×0.05 = 1 + 0.25 = 1.25
    assert.ok(Math.abs(flour.theoretical - 1.25) < 0.001);
  });

  test('actual equals sum of |delta| for writeoff/negative-inventory', () => {
    const rows = computeWriteoffControl(records, period);
    const meat = rows.find(r => r.productId === 'p_meat');
    assert.equal(meat.actual, 3);
  });

  test('diffPct computed correctly', () => {
    const rows = computeWriteoffControl(records, period);
    const meat = rows.find(r => r.productId === 'p_meat');
    assert.equal(Math.round(meat.diffPct), 50); // +50%
    const milk = rows.find(r => r.productId === 'p_milk');
    assert.equal(Math.round(milk.diffPct), -20);
  });

  test('sorted: over → under → ok → no-data, then by |diff| desc', () => {
    const rows = computeWriteoffControl(records, period);
    assert.equal(rows[0].status, 'over');
    assert.equal(rows[1].status, 'under');
    assert.equal(rows[2].status, 'ok');
  });
});

describe('computeWriteoffControl — edge cases', () => {
  test('inventory with negative delta counted as outflow', () => {
    const sales = [{ id: 's1', type: 'dish_sale', dishId: 'd_burger', date: '2026-05-15', count: 5 }];
    const entries = [
      // 1кг по факт-vs-инвентаризации (delta -1)
      { id: 'e1', type: 'stock_entry', productId: 'p_meat', kind: 'inventory', delta: -1, createdAt: new Date('2026-05-20').getTime() },
      // и явный writeoff на 0.5
      { id: 'e2', type: 'stock_entry', productId: 'p_meat', kind: 'writeoff',  delta: -0.5, createdAt: new Date('2026-05-21').getTime() },
    ];
    const r = computeWriteoffControl([...products, ...dishes, ...sales, ...entries], period);
    const meat = r.find(x => x.productId === 'p_meat');
    assert.equal(meat.actual, 1.5);
  });

  test('positive inventory delta NOT counted as outflow', () => {
    const sales = [{ id: 's1', type: 'dish_sale', dishId: 'd_burger', date: '2026-05-15', count: 5 }];
    const entries = [
      // Приход на 2кг — НЕ outflow
      { id: 'e1', type: 'stock_entry', productId: 'p_meat', kind: 'inventory', delta: +2, createdAt: new Date('2026-05-20').getTime() },
    ];
    const r = computeWriteoffControl([...products, ...dishes, ...sales, ...entries], period);
    const meat = r.find(x => x.productId === 'p_meat');
    assert.equal(meat.actual, 0);
  });

  test('inactive dishes do not contribute to theoretical', () => {
    const inactive = [
      ...dishes.slice(0, 1),
      { ...dishes[1], active: false },
    ];
    const sales = [
      { id: 's1', type: 'dish_sale', dishId: 'd_pancake', date: '2026-05-15', count: 10 },
    ];
    const r = computeWriteoffControl([...products, ...inactive, ...sales], period);
    // блин неактивен → мука не должна быть в theoretical
    const flour = r.find(x => x.productId === 'p_flour');
    assert.equal(flour, undefined);
  });

  test('sales outside period excluded', () => {
    const sales = [
      { id: 's1', type: 'dish_sale', dishId: 'd_burger', date: '2026-04-15', count: 100 }, // прошлый месяц
    ];
    const r = computeWriteoffControl([...products, ...dishes, ...sales], period);
    assert.deepEqual(r, []);
  });

  test('product removed from store → row excluded', () => {
    const sales = [{ id: 's1', type: 'dish_sale', dishId: 'd_burger', date: '2026-05-15', count: 5 }];
    const entries = [
      { id: 'e1', type: 'stock_entry', productId: 'p_meat', kind: 'writeoff', delta: -1, createdAt: new Date('2026-05-20').getTime() },
    ];
    // products БЕЗ p_meat (как будто удалили)
    const r = computeWriteoffControl([products[1], products[2], ...dishes, ...sales, ...entries], period);
    assert.equal(r.find(x => x.productId === 'p_meat'), undefined);
  });
});

describe('summarizeWriteoffControl', () => {
  test('counts by status', () => {
    const rows = [
      { status: 'over' }, { status: 'over' },
      { status: 'ok' },
      { status: 'under' },
      { status: 'no-data' }, { status: 'no-data' }, { status: 'no-data' },
    ];
    assert.deepEqual(summarizeWriteoffControl(rows), { over: 2, under: 1, ok: 1, 'no-data': 3 });
  });
});
