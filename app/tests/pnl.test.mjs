/*
 * Unit-тесты P&L математики.
 * Запуск: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeVenuePnL,
  fixedExpenseInPeriod,
  foodCostColor,
  ebitdaColor,
} from '../client/src/utils/pnl.js';

const period = {
  start: new Date('2026-05-01T00:00:00Z'),
  end:   new Date('2026-05-31T23:59:59Z'),
};

describe('fixedExpenseInPeriod', () => {
  test('full month (30 days) returns the monthly amount', () => {
    const e = { amount: 3000, startDate: '2026-01-01', endDate: null };
    const r = fixedExpenseInPeriod(e, new Date('2026-05-01'), new Date('2026-05-30'));
    assert.equal(Math.round(r), 3000);
  });

  test('half month → ~half', () => {
    const e = { amount: 3000, startDate: '2026-01-01', endDate: null };
    const r = fixedExpenseInPeriod(e, new Date('2026-05-01'), new Date('2026-05-15'));
    assert.ok(r > 1400 && r < 1600, `expected ~1500, got ${r}`);
  });

  test('returns 0 if period before expense start', () => {
    const e = { amount: 3000, startDate: '2026-06-01', endDate: null };
    const r = fixedExpenseInPeriod(e, new Date('2026-05-01'), new Date('2026-05-30'));
    assert.equal(r, 0);
  });

  test('returns 0 if expense ended before period', () => {
    const e = { amount: 3000, startDate: '2026-01-01', endDate: '2026-04-30' };
    const r = fixedExpenseInPeriod(e, new Date('2026-05-01'), new Date('2026-05-30'));
    assert.equal(r, 0);
  });

  test('partial overlap calculated correctly', () => {
    // Расход стартовал 15 мая, период 1–30 мая → активные дни 15–30 = 16 дней
    const e = { amount: 3000, startDate: '2026-05-15', endDate: null };
    const r = fixedExpenseInPeriod(e, new Date('2026-05-01'), new Date('2026-05-30'));
    assert.ok(r > 1500 && r < 1700, `expected ~1600 (16 days), got ${r}`);
  });
});

describe('computeVenuePnL', () => {
  test('empty records → zero everything, null percentages', () => {
    const r = computeVenuePnL([], period);
    assert.equal(r.revenue, 0);
    assert.equal(r.variableCosts, 0);
    assert.equal(r.fixedTotal, 0);
    assert.equal(r.grossProfit, 0);
    assert.equal(r.ebitda, 0);
    assert.equal(r.foodCostPct, null);
    assert.equal(r.grossMarginPct, null);
    assert.equal(r.ebitdaPct, null);
    assert.deepEqual(r.fixedByCategory, []);
  });

  test('revenue summed correctly across multiple entries', () => {
    const records = [
      { type: 'revenue_entry', date: '2026-05-10', amount: 100 },
      { type: 'revenue_entry', date: '2026-05-15', amount: 250 },
      { type: 'revenue_entry', date: '2026-05-20', amount: 50 },
    ];
    const r = computeVenuePnL(records, period);
    assert.equal(r.revenue, 400);
  });

  test('revenue outside period excluded', () => {
    const records = [
      { type: 'revenue_entry', date: '2026-04-15', amount: 999 }, // before
      { type: 'revenue_entry', date: '2026-05-15', amount: 100 }, // in
      { type: 'revenue_entry', date: '2026-06-15', amount: 999 }, // after
    ];
    const r = computeVenuePnL(records, period);
    assert.equal(r.revenue, 100);
  });

  test('only orders with status=received count as variable cost', () => {
    const ts = new Date('2026-05-15').getTime();
    const records = [
      { type: 'order', status: 'draft',     totalAmount: 500, receivedAt: ts },
      { type: 'order', status: 'received',  totalAmount: 100, receivedAt: ts },
      { type: 'order', status: 'cancelled', totalAmount: 200, receivedAt: ts },
      { type: 'order', status: 'received',  totalAmount: 50,  receivedAt: ts },
    ];
    const r = computeVenuePnL(records, period);
    assert.equal(r.variableCosts, 150);
  });

  test('order received outside period excluded', () => {
    const records = [
      { type: 'order', status: 'received', totalAmount: 100, receivedAt: new Date('2026-04-15').getTime() },
      { type: 'order', status: 'received', totalAmount: 200, receivedAt: new Date('2026-05-15').getTime() },
    ];
    const r = computeVenuePnL(records, period);
    assert.equal(r.variableCosts, 200);
  });

  test('food cost % calculated correctly', () => {
    const ts = new Date('2026-05-15').getTime();
    const records = [
      { type: 'revenue_entry', date: '2026-05-10', amount: 1000 },
      { type: 'order', status: 'received', totalAmount: 300, receivedAt: ts },
    ];
    const r = computeVenuePnL(records, period);
    assert.equal(r.foodCostPct, 30);
  });

  test('EBITDA = revenue − variableCosts − fixedTotal', () => {
    // Берём апрель (30 дней) для точного совпадения с базой расчёта,
    // чтобы не уходить в погрешность 31/30 ≈ 3% для мая/июля и т.д.
    const aprPeriod = {
      start: new Date('2026-04-01T00:00:00Z'),
      end:   new Date('2026-04-30T23:59:59Z'),
    };
    const ts = new Date('2026-04-15').getTime();
    const records = [
      { type: 'revenue_entry', date: '2026-04-10', amount: 5000 },
      { type: 'order', status: 'received', totalAmount: 1500, receivedAt: ts },
      { type: 'fixed_expense', amount: 1500, startDate: '2026-01-01', endDate: null, category: 'rent' },
    ];
    const r = computeVenuePnL(records, aprPeriod);
    assert.equal(r.revenue, 5000);
    assert.equal(r.variableCosts, 1500);
    assert.equal(r.grossProfit, 3500);
    assert.equal(Math.round(r.fixedTotal), 1500);
    assert.equal(Math.round(r.ebitda), 2000);
  });

  test('31-day month adds ~3% to fixed expense (calendar-aware base)', () => {
    // Май = 31 день, при базе 30 → 1500 * 31/30 = 1550.
    // Зафиксировано в spec/known limitation (FinanceTab.jsx tooltip).
    const records = [
      { type: 'fixed_expense', amount: 1500, startDate: '2026-01-01', endDate: null, category: 'rent' },
    ];
    const r = computeVenuePnL(records, period);
    assert.equal(Math.round(r.fixedTotal), 1550);
  });

  test('fixedByCategory grouped and sorted by total desc', () => {
    const records = [
      { type: 'fixed_expense', amount: 1000, startDate: '2026-01-01', endDate: null, category: 'utilities' },
      { type: 'fixed_expense', amount: 3000, startDate: '2026-01-01', endDate: null, category: 'rent' },
      { type: 'fixed_expense', amount: 2000, startDate: '2026-01-01', endDate: null, category: 'payroll' },
    ];
    const r = computeVenuePnL(records, period);
    const cats = r.fixedByCategory.map(c => c.id);
    assert.deepEqual(cats, ['rent', 'payroll', 'utilities']);
  });

  test('handles zero revenue without divide-by-zero', () => {
    const records = [
      { type: 'order', status: 'received', totalAmount: 500, receivedAt: new Date('2026-05-15').getTime() },
    ];
    const r = computeVenuePnL(records, period);
    assert.equal(r.revenue, 0);
    assert.equal(r.foodCostPct, null);
    assert.equal(r.ebitdaPct, null);
  });
});

describe('foodCostColor', () => {
  test('≤32% → green', () => {
    assert.equal(foodCostColor(25), 'var(--success)');
    assert.equal(foodCostColor(32), 'var(--success)');
  });

  test('32–38% → amber', () => {
    assert.equal(foodCostColor(35), '#b45309');
  });

  test('>38% → red', () => {
    assert.equal(foodCostColor(45), 'var(--danger)');
  });

  test('null/undefined → null', () => {
    assert.equal(foodCostColor(null), null);
    assert.equal(foodCostColor(undefined), null);
  });
});

describe('ebitdaColor', () => {
  test('positive → green', () => {
    assert.equal(ebitdaColor(100), 'var(--success)');
  });

  test('negative → red', () => {
    assert.equal(ebitdaColor(-50), 'var(--danger)');
  });

  test('zero → null (neutral)', () => {
    assert.equal(ebitdaColor(0), null);
  });
});
