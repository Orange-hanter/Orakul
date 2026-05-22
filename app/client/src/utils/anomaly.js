/*
 * AI05 — Anomaly detection v1 для списаний.
 *
 * Задача (US-02 на уровне продукта): «списание сегодня сильно выше обычного
 * для этого продукта — поднять флаг». Реализация — простая z-score статистика
 * по дневным списаниям за окно 14 дней.
 *
 *   meanDaily      = avg(daily writeoff за 14 дней до сегодня)
 *   stdDevDaily    = sample std (n−1)
 *   todayWriteoff  = сумма |delta| с kind='writeoff' за сегодня (локальная дата)
 *   sigmas         = (today − mean) / stdDev
 *
 * Порог: sigmas ≥ 2 → 'high' аномалия, ≥ 3 → 'critical'.
 * Минимум данных: ≥ 7 дней с ненулевыми списаниями в окне (иначе stdDev нестабилен,
 * возвращаем null). Это анти-флаппинг — пока нет истории, не кричим.
 *
 * Чистая функция, тестируется отдельно. UI/Telegram строятся поверх.
 */

import { toIsoDate } from './dishSales.js';

const DAY_MS = 86_400_000;

function dailyWriteoffMap(entries, productId, windowDaysIso) {
  const map = new Map(); // dateIso → sum
  for (const e of entries) {
    if (e.productId !== productId) continue;
    if (e.kind !== 'writeoff') continue;
    if (e.delta == null) continue;
    const ts = e.createdAt || e.updatedAt || 0;
    if (!ts) continue;
    const iso = toIsoDate(new Date(ts));
    if (!windowDaysIso.has(iso)) continue;
    const out = Math.abs(Number(e.delta) || 0);
    if (out === 0) continue;
    map.set(iso, (map.get(iso) || 0) + out);
  }
  return map;
}

/**
 * Вычислить аномалии списаний для одного продукта.
 * @param {Array} records — venue-filtered records
 * @param {string} productId
 * @param {{ lookbackDays?: 14, today?: Date, minDaysWithData?: 7 }} opts
 * @returns {null | {
 *   productId, productName, unit,
 *   todayWriteoff, mean, stdDev, sigmas,
 *   severity: 'normal'|'high'|'critical',
 *   sampleSize,
 * }}
 */
export function detectProductAnomaly(records, productId, opts = {}) {
  const lookback = opts.lookbackDays ?? 14;
  const minDays  = opts.minDaysWithData ?? 7;
  const today    = opts.today instanceof Date ? new Date(opts.today) : new Date();
  today.setHours(0, 0, 0, 0);

  const product = records.find(r => r.type === 'product' && r.id === productId);
  if (!product) return null;

  const entries = records.filter(r => r.type === 'stock_entry');

  // Окно: lookback дней ДО сегодня (today исключаем — это сравниваемая точка).
  const windowIsos = new Set();
  for (let i = 1; i <= lookback; i++) {
    windowIsos.add(toIsoDate(new Date(today.getTime() - i * DAY_MS)));
  }
  const todayIso = toIsoDate(today);

  const daily = dailyWriteoffMap(entries, productId, windowIsos);

  // Сегодняшнее списание — отдельная агрегация, today не в windowIsos.
  let todayWriteoff = 0;
  for (const e of entries) {
    if (e.productId !== productId) continue;
    if (e.kind !== 'writeoff') continue;
    if (e.delta == null) continue;
    const ts = e.createdAt || e.updatedAt || 0;
    if (!ts) continue;
    if (toIsoDate(new Date(ts)) !== todayIso) continue;
    todayWriteoff += Math.abs(Number(e.delta) || 0);
  }

  const samples = [...daily.values()];
  if (samples.length < minDays) return null;
  if (todayWriteoff === 0) return null;

  const mean = samples.reduce((a, c) => a + c, 0) / samples.length;
  // sample std (n−1 в знаменателе для несмещённой оценки)
  const variance = samples.reduce((acc, x) => acc + (x - mean) ** 2, 0) /
                   Math.max(1, samples.length - 1);
  const stdDev = Math.sqrt(variance);

  // Защита: если stdDev=0 (все дни одинаковы), формально любое отклонение → ∞ sigmas.
  // Тогда считаем sigmas через относительный рост: today/mean ≥ 2 → high, ≥ 3 → critical.
  let sigmas;
  if (stdDev === 0) {
    sigmas = mean > 0 ? (todayWriteoff / mean) : 0;
  } else {
    sigmas = (todayWriteoff - mean) / stdDev;
  }

  let severity = 'normal';
  if (sigmas >= 3) severity = 'critical';
  else if (sigmas >= 2) severity = 'high';

  return {
    productId,
    productName: product.name,
    unit: product.unit || 'шт',
    todayWriteoff,
    mean,
    stdDev,
    sigmas,
    severity,
    sampleSize: samples.length,
  };
}

/**
 * Найти аномалии по всем продуктам сразу.
 * Возвращает только severity ∈ {'high','critical'}, отсортированные по sigmas desc.
 */
export function detectAllAnomalies(records, opts = {}) {
  const products = records.filter(r => r.type === 'product');
  const result = [];
  for (const p of products) {
    const a = detectProductAnomaly(records, p.id, opts);
    if (a && a.severity !== 'normal') result.push(a);
  }
  result.sort((a, b) => b.sigmas - a.sigmas);
  return result;
}
