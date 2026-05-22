/*
 * P&L математика — чистые функции, не зависят от React.
 * Выделены из FinanceTab.jsx, чтобы покрыть unit-тестами без JSX-парсера.
 */

import { DAY_MS } from './time.js';

/**
 * Доля помесячной суммы расхода, попадающая в период (start..end).
 * Возвращает 0, если периоды не пересекаются.
 * 30 дней принимается за месяц (для коротких/длинных месяцев погрешность ±5%).
 */
export function fixedExpenseInPeriod(expense, start, end) {
  const expStart = expense.startDate ? new Date(expense.startDate) : new Date(0);
  const expEnd   = expense.endDate   ? new Date(expense.endDate)   : new Date('2099-12-31');
  const periodStart = start > expStart ? start : expStart;
  const periodEnd   = end   < expEnd   ? end   : expEnd;
  if (periodEnd < periodStart) return 0;
  // Округляем вниз до целых дней + 1 (включительно start и end).
  // Без floor: end в 23:59:59 даёт лишний день (для мая 1→31 получалось 32).
  const days = Math.floor((periodEnd.getTime() - periodStart.getTime()) / DAY_MS) + 1;
  return (Number(expense.amount) || 0) * (days / 30);
}

/**
 * Считает P&L для набора записей за период.
 * Не имеет внешних зависимостей; принимает уже-отфильтрованные records
 * (например, по venueId) либо пустой набор.
 *
 * @param {Array} records — все записи венью (revenue_entry / order / fixed_expense)
 * @param {{ start: Date, end: Date }} period
 * @returns объект с метриками: revenue, variableCosts, fixedTotal, fixedByCategory[],
 *          grossProfit, ebitda, foodCostPct, grossMarginPct, ebitdaPct
 */
export function computeVenuePnL(records, period) {
  const start = period.start.getTime();
  const end   = period.end.getTime();

  const revenue = records
    .filter(r => r.type === 'revenue_entry')
    .filter(r => {
      const d = new Date(r.date).getTime();
      return d >= start && d <= end;
    })
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const variableCosts = records
    .filter(r => r.type === 'order' && r.status === 'received')
    .filter(o => {
      const ts = o.receivedAt || o.updatedAt || o.createdAt;
      return ts >= start && ts <= end;
    })
    .reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);

  const fixedByCategoryMap = {};
  records.filter(r => r.type === 'fixed_expense').forEach(e => {
    const amount = fixedExpenseInPeriod(e, period.start, period.end);
    if (amount <= 0) return;
    const catId = e.category || 'other';
    if (!fixedByCategoryMap[catId]) fixedByCategoryMap[catId] = { id: catId, total: 0 };
    fixedByCategoryMap[catId].total += amount;
  });
  const fixedByCategory = Object.values(fixedByCategoryMap).sort((a, b) => b.total - a.total);
  const fixedTotal = fixedByCategory.reduce((s, c) => s + c.total, 0);

  const grossProfit    = revenue - variableCosts;
  const ebitda         = grossProfit - fixedTotal;
  const foodCostPct    = revenue > 0 ? (variableCosts / revenue) * 100 : null;
  const grossMarginPct = revenue > 0 ? (grossProfit   / revenue) * 100 : null;
  const ebitdaPct      = revenue > 0 ? (ebitda        / revenue) * 100 : null;

  return {
    revenue, variableCosts, fixedTotal, fixedByCategory,
    grossProfit, ebitda,
    foodCostPct, grossMarginPct, ebitdaPct,
  };
}

/**
 * Цветовая индикация Food Cost %.
 * ≤32% — зелёный, 32–38% — янтарный, >38% — красный.
 * Возвращает null если значение неопределено.
 */
export function foodCostColor(pct) {
  if (pct === null || pct === undefined) return null;
  if (pct > 38) return 'var(--danger)';
  if (pct > 32) return '#b45309';
  return 'var(--success)';
}

/**
 * Цветовая индикация EBITDA (sign).
 */
export function ebitdaColor(v) {
  if (v > 0) return 'var(--success)';
  if (v < 0) return 'var(--danger)';
  return null;
}
