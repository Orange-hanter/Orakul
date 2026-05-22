import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectProductAnomaly, detectAllAnomalies } from '../client/src/utils/anomaly.js';

const DAY_MS = 86_400_000;

function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tsAtNoon(daysAgo) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime() - daysAgo * DAY_MS;
}

const product = { id: 'p_meat', type: 'product', name: 'Курица', unit: 'кг' };

function writeoff(productId, daysAgo, qty) {
  return {
    type: 'stock_entry',
    productId,
    kind: 'writeoff',
    delta: -qty,
    createdAt: tsAtNoon(daysAgo),
  };
}

describe('detectProductAnomaly', () => {
  test('returns null when product is missing', () => {
    const r = detectProductAnomaly([], 'missing');
    assert.equal(r, null);
  });

  test('returns null when fewer than minDaysWithData samples in window', () => {
    const records = [product];
    for (let i = 1; i <= 5; i++) records.push(writeoff('p_meat', i, 1));
    records.push(writeoff('p_meat', 0, 10));
    const r = detectProductAnomaly(records, 'p_meat');
    assert.equal(r, null);
  });

  test('returns null when today has zero writeoff', () => {
    const records = [product];
    for (let i = 1; i <= 14; i++) records.push(writeoff('p_meat', i, 1));
    const r = detectProductAnomaly(records, 'p_meat');
    assert.equal(r, null);
  });

  test('flags severity=critical when today is far above mean', () => {
    const records = [product];
    // 14 дней по ~1 кг ± немного дисперсии
    const history = [1.0, 1.1, 0.9, 1.0, 1.2, 0.8, 1.0, 1.1, 0.9, 1.0, 1.1, 0.9, 1.0, 1.0];
    for (let i = 0; i < history.length; i++) records.push(writeoff('p_meat', i + 1, history[i]));
    records.push(writeoff('p_meat', 0, 10)); // сегодня — резкий скачок
    const r = detectProductAnomaly(records, 'p_meat');
    assert.ok(r);
    assert.equal(r.severity, 'critical');
    assert.ok(r.sigmas > 3);
    assert.equal(r.todayWriteoff, 10);
  });

  test('flags severity=high when today is moderately above mean (2σ..3σ)', () => {
    const records = [product];
    // Используем большую дисперсию, чтобы today попало в [2σ, 3σ)
    const history = [1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3]; // mean=2, σ≈1.04
    for (let i = 0; i < history.length; i++) records.push(writeoff('p_meat', i + 1, history[i]));
    records.push(writeoff('p_meat', 0, 4.3)); // 4.3 → ≈(4.3-2)/1.04 ≈ 2.2σ
    const r = detectProductAnomaly(records, 'p_meat');
    assert.ok(r);
    assert.equal(r.severity, 'high');
    assert.ok(r.sigmas >= 2 && r.sigmas < 3);
  });

  test('returns normal severity when today is within 2σ', () => {
    const records = [product];
    const history = Array(14).fill(1);
    for (let i = 0; i < history.length; i++) records.push(writeoff('p_meat', i + 1, history[i]));
    records.push(writeoff('p_meat', 0, 1.2)); // ~ near mean (stdDev=0 path)
    const r = detectProductAnomaly(records, 'p_meat');
    assert.ok(r);
    assert.equal(r.severity, 'normal');
  });

  test('zero-stdDev fallback uses ratio threshold', () => {
    // Все 14 дней ровно по 1 кг. Сегодня 3 кг → ratio=3 → critical
    const records = [product];
    for (let i = 1; i <= 14; i++) records.push(writeoff('p_meat', i, 1));
    records.push(writeoff('p_meat', 0, 3));
    const r = detectProductAnomaly(records, 'p_meat');
    assert.ok(r);
    assert.equal(r.stdDev, 0);
    assert.equal(r.severity, 'critical');
  });

  test('ignores stock_entry of kind != writeoff (receipt, inventory)', () => {
    const records = [product];
    for (let i = 1; i <= 14; i++) records.push(writeoff('p_meat', i, 1));
    records.push({ type: 'stock_entry', productId: 'p_meat', kind: 'receipt', delta: 100, createdAt: tsAtNoon(0) });
    records.push({ type: 'stock_entry', productId: 'p_meat', kind: 'inventory', delta: -5, createdAt: tsAtNoon(0) });
    const r = detectProductAnomaly(records, 'p_meat');
    // today writeoff=0 — игнорируем receipt + inventory → null
    assert.equal(r, null);
  });

  test('isolates products — writeoffs of other products do not influence', () => {
    const other = { id: 'p_cheese', type: 'product', name: 'Сыр', unit: 'кг' };
    const records = [product, other];
    for (let i = 1; i <= 14; i++) records.push(writeoff('p_meat', i, 1));
    for (let i = 1; i <= 14; i++) records.push(writeoff('p_cheese', i, 50));
    records.push(writeoff('p_meat', 0, 5));
    const r = detectProductAnomaly(records, 'p_meat');
    assert.ok(r);
    assert.ok(r.mean < 2); // не загрязнено сырным средним
    assert.equal(r.severity, 'critical');
  });

  test('aggregates multiple writeoff entries for the same day', () => {
    const records = [product];
    for (let i = 1; i <= 14; i++) {
      records.push(writeoff('p_meat', i, 0.5));
      records.push(writeoff('p_meat', i, 0.5));
    }
    records.push(writeoff('p_meat', 0, 4));
    const r = detectProductAnomaly(records, 'p_meat');
    assert.ok(r);
    assert.ok(Math.abs(r.mean - 1.0) < 0.001);
  });
});

describe('detectAllAnomalies', () => {
  test('returns only flagged products sorted by sigmas desc', () => {
    const p1 = { id: 'p1', type: 'product', name: 'P1', unit: 'кг' };
    const p2 = { id: 'p2', type: 'product', name: 'P2', unit: 'кг' };
    const p3 = { id: 'p3', type: 'product', name: 'P3', unit: 'кг' };
    const records = [p1, p2, p3];
    // p1: спокойный — today близко к mean
    for (let i = 1; i <= 14; i++) records.push(writeoff('p1', i, 1));
    records.push(writeoff('p1', 0, 1.1));
    // p2: high — today=4 при mean≈2
    for (let i = 1; i <= 7; i++) records.push(writeoff('p2', i, 1));
    for (let i = 8; i <= 14; i++) records.push(writeoff('p2', i, 3));
    records.push(writeoff('p2', 0, 4.3));
    // p3: critical — today=15 при mean≈1 (stdDev=0 path)
    for (let i = 1; i <= 14; i++) records.push(writeoff('p3', i, 1));
    records.push(writeoff('p3', 0, 15));

    const all = detectAllAnomalies(records);
    assert.equal(all.length, 2);
    assert.equal(all[0].productId, 'p3'); // больше sigmas
    assert.equal(all[1].productId, 'p2');
  });

  test('returns empty array when no products have writeoffs', () => {
    const records = [
      { id: 'p1', type: 'product', name: 'P1', unit: 'кг' },
    ];
    assert.deepEqual(detectAllAnomalies(records), []);
  });
});
