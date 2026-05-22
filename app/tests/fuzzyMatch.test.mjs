/*
 * Unit-тесты fuzzy-матчинга. Используют встроенный node:test (Node 18+).
 * Запуск:  npm test  (из директории app/)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeName,
  stem,
  tokenize,
  similarity,
  findAnalogs,
} from '../client/src/utils/fuzzyMatch.js';

describe('normalizeName', () => {
  test('lowercase + strips punctuation', () => {
    assert.equal(normalizeName('Мука В/С!'), 'мука в с');
  });

  test('removes digits and decimals', () => {
    assert.equal(normalizeName('Мука 25 кг 1.5'), 'мука кг');
  });

  test('ё → е for stability', () => {
    assert.equal(normalizeName('Свёкла'), 'свекла');
  });

  test('collapses whitespace', () => {
    assert.equal(normalizeName('Мука    в/с'), 'мука в с');
  });

  test('handles null/undefined gracefully', () => {
    assert.equal(normalizeName(null), '');
    assert.equal(normalizeName(undefined), '');
  });
});

describe('stem', () => {
  test('preserves root of short words (мука → мук, not м)', () => {
    assert.equal(stem('мука'), 'мук');
  });

  test('strips adjective endings (пшеничная → пшеничн)', () => {
    assert.equal(stem('пшеничная'), 'пшеничн');
  });

  test('strips multiple endings (масло → масл)', () => {
    assert.equal(stem('масло'), 'масл');
  });

  test('does not strip endings shorter than 4 chars', () => {
    // "сыр" — 3 chars, no suffix to strip
    assert.equal(stem('сыр'), 'сыр');
  });
});

describe('tokenize', () => {
  test('returns significant stems only', () => {
    const t = tokenize('Мука пшеничная в/с 25 кг');
    assert.deepEqual(t, ['мук', 'пшеничн']);
  });

  test('strips unit words (кг, л, шт)', () => {
    const t = tokenize('Молоко 1 л');
    assert.deepEqual(t, ['молок']);
  });

  test('preserves token order (first = root)', () => {
    const t = tokenize('Сыр моцарелла');
    assert.equal(t[0], 'сыр');
  });
});

describe('similarity', () => {
  test('identical names → 1.0', () => {
    const s = similarity('Кофе арабика', 'Кофе арабика');
    assert.equal(s, 1.0);
  });

  test('completely different → 0', () => {
    const s = similarity('Помидоры розовые', 'Огурцы гладкие');
    assert.equal(s, 0);
  });

  test('same root + extra detail → mid (with root bonus)', () => {
    // «Мука» (1 значимый токен) vs «Мука пшеничная высш сорт» (4 токенов)
    // Jaccard: 1/4 = 0.25, бонус +0.2 за совпадение корня = 0.45
    const s = similarity('Мука', 'Мука пшеничная высш. сорт');
    assert.ok(s >= 0.4 && s <= 0.55, `expected ~0.45, got ${s}`);
  });

  test('reordered words still match (грудка куриная ↔ куриная грудка)', () => {
    const s = similarity('Грудка куриная охл.', 'Куриная грудка');
    assert.ok(s >= 0.5, `expected ≥0.5 for same words reordered, got ${s}`);
  });

  test('empty/missing input → 0', () => {
    assert.equal(similarity('', 'Мука'), 0);
    assert.equal(similarity(null, 'Мука'), 0);
  });

  test('symmetric: similarity(a,b) == similarity(b,a)', () => {
    const a = similarity('Масло слив. 82.5%', 'Сливочное масло');
    const b = similarity('Сливочное масло', 'Масло слив. 82.5%');
    assert.equal(a, b);
  });
});

describe('findAnalogs', () => {
  const itemA = { id: 'a', supplierId: 'sup1', productId: 'p1', itemName: 'Мука в/с',         unit: 'кг', price: 1.20 };
  const itemB = { id: 'b', supplierId: 'sup2', productId: 'p1', itemName: 'Мука в/с',         unit: 'кг', price: 1.05 };
  const itemC = { id: 'c', supplierId: 'sup3', productId: null, itemName: 'Мука пшеничная',   unit: 'кг', price: 1.10 };
  const itemD = { id: 'd', supplierId: 'sup4', productId: 'p2', itemName: 'Помидоры розовые', unit: 'кг', price: 5.40 };
  const itemE = { id: 'e', supplierId: 'sup5', productId: 'p1', itemName: 'Мука в/с',         unit: 'шт', price: 0.50 }; // wrong unit

  test('exact match (same productId) ranked first with similarity 1.0', () => {
    const r = findAnalogs(itemA, [itemB, itemC, itemD]);
    assert.equal(r[0].item.id, 'b');
    assert.equal(r[0].exact, true);
    assert.equal(r[0].similarity, 1.0);
  });

  test('skips same-supplier items', () => {
    const sameSupplier = { ...itemB, supplierId: 'sup1' };
    const r = findAnalogs(itemA, [sameSupplier]);
    assert.equal(r.length, 0);
  });

  test('skips items with different unit by default', () => {
    const r = findAnalogs(itemA, [itemE]);
    assert.equal(r.length, 0, 'wrong-unit candidate should be filtered');
  });

  test('cross-unit allowed when sameUnit=false', () => {
    const r = findAnalogs(itemA, [itemE], { sameUnit: false });
    assert.equal(r.length, 1);
  });

  test('filters by threshold', () => {
    // itemD (Помидоры) is totally different from itemA (Мука) — score 0
    const r = findAnalogs(itemA, [itemD]);
    assert.equal(r.length, 0);
  });

  test('fuzzy match without productId still finds candidate', () => {
    const r = findAnalogs(itemA, [itemC]);
    assert.equal(r.length, 1);
    assert.equal(r[0].item.id, 'c');
    assert.equal(r[0].exact, false);
    assert.ok(r[0].similarity >= 0.3, 'fuzzy score should clear threshold');
  });

  test('exact matches sorted before fuzzy regardless of similarity', () => {
    const r = findAnalogs(itemA, [itemB, itemC]);
    assert.equal(r[0].item.id, 'b'); // exact
    assert.equal(r[1].item.id, 'c'); // fuzzy
  });
});
