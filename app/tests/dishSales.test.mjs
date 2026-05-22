import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toIsoDate,
  findSaleRecord,
  salesInPeriod,
  salesMapByDish,
} from '../client/src/utils/dishSales.js';

const sales = [
  { id: 's1', dishId: 'd1', date: '2026-05-20', count: 5 },
  { id: 's2', dishId: 'd1', date: '2026-05-21', count: 7 },
  { id: 's3', dishId: 'd2', date: '2026-05-21', count: 3 },
  { id: 's4', dishId: 'd1', date: '2026-05-22', count: 10 },
  { id: 's5', dishId: 'd3', date: '2026-05-15', count: 2 }, // outside default range
];

describe('toIsoDate', () => {
  test('formats Date to YYYY-MM-DD in local time', () => {
    const r = toIsoDate(new Date(2026, 4, 5)); // May 5, 2026 local
    assert.equal(r, '2026-05-05');
  });

  test('accepts ISO string', () => {
    assert.equal(toIsoDate('2026-05-22T15:00:00'), '2026-05-22');
  });
});

describe('findSaleRecord', () => {
  test('returns matching record', () => {
    const r = findSaleRecord(sales, 'd1', '2026-05-21');
    assert.equal(r.id, 's2');
    assert.equal(r.count, 7);
  });

  test('returns null when no match', () => {
    assert.equal(findSaleRecord(sales, 'd1', '2026-01-01'), null);
    assert.equal(findSaleRecord(sales, 'd999', '2026-05-21'), null);
  });
});

describe('salesInPeriod', () => {
  test('sums count for dish across period', () => {
    // d1 на 20, 21, 22 мая = 5+7+10 = 22
    assert.equal(salesInPeriod(sales, 'd1', '2026-05-20', '2026-05-22'), 22);
  });

  test('respects period bounds (inclusive)', () => {
    assert.equal(salesInPeriod(sales, 'd1', '2026-05-21', '2026-05-21'), 7);
  });

  test('returns 0 when dish has no sales in period', () => {
    assert.equal(salesInPeriod(sales, 'd2', '2026-05-15', '2026-05-15'), 0);
    assert.equal(salesInPeriod(sales, 'unknown', '2026-05-20', '2026-05-22'), 0);
  });

  test('handles records with bad count gracefully', () => {
    const bad = [{ dishId: 'd1', date: '2026-05-20', count: 'oops' }];
    assert.equal(salesInPeriod(bad, 'd1', '2026-05-20', '2026-05-20'), 0);
  });
});

describe('salesMapByDish', () => {
  test('returns map of dishId → total in period', () => {
    const m = salesMapByDish(sales, '2026-05-20', '2026-05-22');
    assert.equal(m.get('d1'), 22);
    assert.equal(m.get('d2'), 3);
    assert.equal(m.get('d3'), undefined); // outside period
  });

  test('empty period → empty map', () => {
    const m = salesMapByDish(sales, '2026-01-01', '2026-01-31');
    assert.equal(m.size, 0);
  });
});
