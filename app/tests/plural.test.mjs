import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { plural, nplural } from '../client/src/utils/plural.js';

const FORMS = ['позиция', 'позиции', 'позиций'];

describe('plural — Russian number agreement', () => {
  test('1 → singular nominative', () => {
    assert.equal(plural(1, FORMS), 'позиция');
    assert.equal(plural(21, FORMS), 'позиция');
    assert.equal(plural(101, FORMS), 'позиция');
  });

  test('2-4 → singular genitive', () => {
    assert.equal(plural(2, FORMS), 'позиции');
    assert.equal(plural(3, FORMS), 'позиции');
    assert.equal(plural(4, FORMS), 'позиции');
    assert.equal(plural(22, FORMS), 'позиции');
    assert.equal(plural(103, FORMS), 'позиции');
  });

  test('5+ → plural genitive', () => {
    assert.equal(plural(5, FORMS), 'позиций');
    assert.equal(plural(10, FORMS), 'позиций');
    assert.equal(plural(25, FORMS), 'позиций');
    assert.equal(plural(100, FORMS), 'позиций');
  });

  test('11-14 exception (always plural genitive)', () => {
    assert.equal(plural(11, FORMS), 'позиций');
    assert.equal(plural(12, FORMS), 'позиций');
    assert.equal(plural(13, FORMS), 'позиций');
    assert.equal(plural(14, FORMS), 'позиций');
    assert.equal(plural(111, FORMS), 'позиций');
    assert.equal(plural(114, FORMS), 'позиций');
  });

  test('0 → plural genitive', () => {
    assert.equal(plural(0, FORMS), 'позиций');
  });

  test('handles negative numbers', () => {
    assert.equal(plural(-1, FORMS), 'позиция');
    assert.equal(plural(-5, FORMS), 'позиций');
  });

  test('truncates fractional', () => {
    assert.equal(plural(1.5, FORMS), 'позиция');
    assert.equal(plural(2.9, FORMS), 'позиции');
  });
});

describe('nplural — number + form', () => {
  test('combines number and form', () => {
    assert.equal(nplural(1, FORMS), '1 позиция');
    assert.equal(nplural(3, FORMS), '3 позиции');
    assert.equal(nplural(7, FORMS), '7 позиций');
  });
});
