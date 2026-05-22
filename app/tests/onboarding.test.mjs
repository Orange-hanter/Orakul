import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildChecklist, onboardingProgress } from '../client/src/utils/onboarding.js';

describe('buildChecklist — 4 onboarding steps', () => {
  test('empty store: only "venue" potentially done via migration', () => {
    const items = buildChecklist([]);
    assert.equal(items.length, 4);
    assert.equal(items.every(i => !i.done), true);
  });

  test('venue + supplier with item + dish with recipe & price + sale', () => {
    const records = [
      { type: 'venue', id: 'v1', name: 'Точка 1' },
      { type: 'supplier', id: 's1', name: 'X' },
      { type: 'supplier_item', supplierId: 's1', price: 5 },
      { type: 'dish', name: 'D', sellPrice: 10, ingredients: [{ productId: 'p1', quantity: 1 }] },
      { type: 'dish_sale', dishId: 'd', date: '2026-05-22', count: 3 },
    ];
    const items = buildChecklist(records);
    assert.equal(items.every(i => i.done), true);
  });

  test('partial: venue + supplier but no dishes → 2/4', () => {
    const records = [
      { type: 'venue', id: 'v1' },
      { type: 'supplier', id: 's1' },
      { type: 'supplier_item', supplierId: 's1', price: 5 },
    ];
    const items = buildChecklist(records);
    const done = items.filter(i => i.done).map(i => i.id);
    assert.deepEqual(done, ['venue', 'supplier']);
  });

  test('dish without sellPrice → dish step not done', () => {
    const records = [
      { type: 'venue', id: 'v1' },
      { type: 'dish', name: 'D', ingredients: [{ productId: 'p1', quantity: 1 }] },
    ];
    const items = buildChecklist(records);
    const dishStep = items.find(i => i.id === 'dish');
    assert.equal(dishStep.done, false);
  });

  test('dish without recipe → dish step not done', () => {
    const records = [
      { type: 'venue', id: 'v1' },
      { type: 'dish', name: 'D', sellPrice: 5 },
    ];
    const items = buildChecklist(records);
    const dishStep = items.find(i => i.id === 'dish');
    assert.equal(dishStep.done, false);
  });

  test('supplier without items → supplier step not done', () => {
    const records = [
      { type: 'venue', id: 'v1' },
      { type: 'supplier', id: 's1' },
    ];
    const items = buildChecklist(records);
    const supplierStep = items.find(i => i.id === 'supplier');
    assert.equal(supplierStep.done, false);
  });
});
