// Centralised UI formatters. All tabs/components должны импортировать отсюда,
// иначе разъезжаются стандарты округления и плейсхолдеры «—».

export const CURRENCY = 'BYN';

export function fmtPrice(n, currency = CURRENCY) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(2)} ${currency}`;
}

// «Денежная» округлённая форма — для KPI и P&L, без копеек.
export function fmtMoney(n, currency = CURRENCY) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${Math.round(Number(n)).toLocaleString('ru')} ${currency}`;
}

// Сырые числа с двумя знаками — без валюты (для себестоимости в карточках блюд).
export function fmtNumber2(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
}

export function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(1)}%`;
}

// Полная дата (день, месяц, год).
export function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Короткая дата без года (для исторических записей в пределах сезона).
export function fmtDateShort(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

// «5 авг, 14:32» — для журналов операций.
export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const day = d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
  return `${day}, ${h}:${m}`;
}

// ISO yyyy-mm-dd → «5 авг» (используется в карточках заявок).
export function fmtIsoDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}
