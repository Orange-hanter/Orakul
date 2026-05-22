import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  forecastDishDaily,
  forecastProductConsumption,
  computeMAPE,
} from '../client/src/utils/forecast.js';

// Util: построить N продаж за прошлые дни относительно сегодня.
// Возвращает массив dish_sale записей с date в формате YYYY-MM-DD (LOCAL time —
// должен совпадать с toIsoDate в forecast.js, чтобы match-итись по строкам).
function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function buildSales(dishId, dailyCounts) {
  const sales = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const N = dailyCounts.length;
  for (let i = 0; i < N; i++) {
    const daysAgo = N - i;
    const d = new Date(today.getTime() - daysAgo * 86_400_000);
    sales.push({ type: 'dish_sale', dishId, date: localIso(d), count: dailyCounts[i] });
  }
  return sales;
}

describe('forecastDishDaily — baseline math', () => {
  test('no data → forecasts zeros with hasData=false', () => {
    const r = forecastDishDaily([], 'd1', { horizonDays: 7 });
    assert.equal(r.length, 7);
    assert.equal(r.every(x => x.forecast === 0), true);
    assert.equal(r.every(x => x.hasData === false), true);
  });

  test('constant daily sales → flat baseline equal to that value', () => {
    // 28 дней по 10 порций
    const sales = buildSales('d1', Array(28).fill(10));
    const r = forecastDishDaily(sales, 'd1', { lookbackDays: 28, horizonDays: 7 });
    assert.equal(r.length, 7);
    // baseline = sum/totalDays = 28*10/28 = 10
    assert.equal(Math.round(r[0].baseline), 10);
    // wdFactor должен быть 1 для всех дней (равномерное распределение)
    r.forEach(x => assert.ok(Math.abs(x.wdFactor - 1) < 0.01));
    r.forEach(x => assert.ok(Math.abs(x.forecast - 10) < 0.01));
  });

  test('zero sales on some days lowers baseline proportionally', () => {
    // 7 продаж в неделю по 7 → baseline = 7*7/28 = 1.75
    const counts = [];
    for (let i = 0; i < 28; i++) counts.push(i % 4 === 0 ? 7 : 0);
    const sales = buildSales('d1', counts);
    const r = forecastDishDaily(sales, 'd1', { lookbackDays: 28, horizonDays: 1 });
    assert.ok(Math.abs(r[0].baseline - 1.75) < 0.01);
  });

  test('weekday seasonality: high weekends, low weekdays', () => {
    // 28 дней; Sat (6) и Sun (0) — 20, остальные — 5
    const counts = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 28; i >= 1; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const dow = d.getDay();
      counts.push(dow === 0 || dow === 6 ? 20 : 5);
    }
    const sales = buildSales('d1', counts);
    const r = forecastDishDaily(sales, 'd1', { lookbackDays: 28, horizonDays: 7 });
    // baseline = average ≈ (4*5 + 2*20 + 5*?) / 28... Считать точно сложно, но
    // wd factor для weekend должен быть > 1, для weekday < 1
    const weekendForecasts = r.filter(x => x.dayOfWeek === 0 || x.dayOfWeek === 6);
    const weekdayForecasts = r.filter(x => x.dayOfWeek > 0 && x.dayOfWeek < 6);
    if (weekendForecasts.length && weekdayForecasts.length) {
      const avgWeekend = weekendForecasts.reduce((a, b) => a + b.forecast, 0) / weekendForecasts.length;
      const avgWeekday = weekdayForecasts.reduce((a, b) => a + b.forecast, 0) / weekdayForecasts.length;
      assert.ok(avgWeekend > avgWeekday * 1.5, `weekend forecast (${avgWeekend}) should be at least 1.5× weekday (${avgWeekday})`);
    }
  });

  test('ignores sales outside lookback window', () => {
    // 5 продаж 1 день назад + 100 продаж 60 дней назад (выпадают)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sales = [
      { type: 'dish_sale', dishId: 'd1', date: localIso(new Date(today.getTime() - 1 * 86_400_000)),  count: 5 },
      { type: 'dish_sale', dishId: 'd1', date: localIso(new Date(today.getTime() - 60 * 86_400_000)), count: 100 },
    ];
    const r = forecastDishDaily(sales, 'd1', { lookbackDays: 28, horizonDays: 1 });
    // baseline = 5 / 28 = 0.18 (не 100)
    assert.ok(r[0].baseline < 1, `baseline should not be inflated by 60-day-old data: ${r[0].baseline}`);
  });

  test('only considers given dishId', () => {
    const sales = [
      ...buildSales('d1', Array(28).fill(10)),
      ...buildSales('d2', Array(28).fill(99)),
    ];
    const r1 = forecastDishDaily(sales, 'd1', { lookbackDays: 28, horizonDays: 1 });
    assert.equal(Math.round(r1[0].baseline), 10);
    const r2 = forecastDishDaily(sales, 'd2', { lookbackDays: 28, horizonDays: 1 });
    assert.equal(Math.round(r2[0].baseline), 99);
  });
});

describe('forecastProductConsumption', () => {
  test('sums dish forecasts weighted by recipe quantity', () => {
    // Блюдо «бургер» использует 0.2 кг мяса; стабильно 10 продаж/день →
    // потребление = 0.2 × 10 = 2 кг/день × 7 = 14 кг/неделя
    const dishes = [{ type: 'dish', id: 'burger', active: true, name: 'Burger',
                     ingredients: [{ productId: 'p_meat', quantity: 0.2 }] }];
    const sales = buildSales('burger', Array(28).fill(10));
    const r = forecastProductConsumption([...dishes, ...sales], 'p_meat', { lookbackDays: 28, horizonDays: 7 });
    assert.ok(Math.abs(r.totalConsumption - 14) < 0.1, `expected ~14, got ${r.totalConsumption}`);
    assert.equal(r.contributingDishes.length, 1);
    assert.equal(r.contributingDishes[0].dishId, 'burger');
  });

  test('aggregates multiple dishes contributing same product', () => {
    const dishes = [
      { type: 'dish', id: 'burger', active: true, name: 'Burger',
        ingredients: [{ productId: 'p_meat', quantity: 0.2 }] },
      { type: 'dish', id: 'pasta', active: true, name: 'Pasta',
        ingredients: [{ productId: 'p_meat', quantity: 0.1 }] },
    ];
    const sales = [
      ...buildSales('burger', Array(28).fill(10)), // 0.2 × 10 = 2 kg/day
      ...buildSales('pasta',  Array(28).fill(5)),  // 0.1 × 5 = 0.5 kg/day
    ];
    const r = forecastProductConsumption([...dishes, ...sales], 'p_meat', { horizonDays: 7 });
    // 2.5 kg/day × 7 = 17.5 kg
    assert.ok(Math.abs(r.totalConsumption - 17.5) < 0.5);
    assert.equal(r.contributingDishes.length, 2);
    assert.equal(r.contributingDishes[0].dishId, 'burger'); // больше contribution
  });

  test('ignores inactive dishes', () => {
    const dishes = [
      { type: 'dish', id: 'burger', active: false, name: 'Burger',
        ingredients: [{ productId: 'p_meat', quantity: 0.2 }] },
    ];
    const sales = buildSales('burger', Array(28).fill(10));
    const r = forecastProductConsumption([...dishes, ...sales], 'p_meat', { horizonDays: 7 });
    assert.equal(r.totalConsumption, 0);
    assert.equal(r.contributingDishes.length, 0);
  });

  test('ignores dishes without this product', () => {
    const dishes = [{ type: 'dish', id: 'salad', active: true, name: 'Salad',
                     ingredients: [{ productId: 'p_lettuce', quantity: 0.1 }] }];
    const sales = buildSales('salad', Array(28).fill(20));
    const r = forecastProductConsumption([...dishes, ...sales], 'p_meat', { horizonDays: 7 });
    assert.equal(r.totalConsumption, 0);
  });
});

describe('computeMAPE', () => {
  test('returns null on empty input', () => {
    assert.equal(computeMAPE([]), null);
  });

  test('perfect forecast → 0%', () => {
    assert.equal(computeMAPE([{ actual: 10, forecast: 10 }]), 0);
  });

  test('20% off → 20% MAPE', () => {
    const m = computeMAPE([{ actual: 10, forecast: 12 }]);
    assert.equal(m, 20);
  });

  test('ignores zero-actual pairs (would divide by zero)', () => {
    const m = computeMAPE([{ actual: 0, forecast: 5 }, { actual: 10, forecast: 10 }]);
    assert.equal(m, 0); // только корректная пара участвует
  });
});
