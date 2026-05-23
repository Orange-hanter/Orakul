// Shared time constants and date helpers.
//
// IMPORTANT: всё ISO-форматирование — по ЛОКАЛЬНОЙ дате (не UTC).
// Иначе при работе ночью по UTC «сегодня» в Минске уезжает на «завтра» в данных,
// и `dish_sale` за вечер попадает в следующий день. См. оригинальный
// `utils/dishSales.js::toIsoDate` — он был сделан правильно, но другие места
// (FinanceTab, OrdersTab, integrations) использовали `toISOString().slice(0,10)`,
// который даёт UTC.

export const DAY_MS = 86_400_000;

export function toIsoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function todayIso() {
  return toIsoDate(new Date());
}

export function daysBetween(ts) {
  return Math.floor((Date.now() - ts) / DAY_MS);
}
