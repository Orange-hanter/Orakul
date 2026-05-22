/*
 * Русские правила склонения числительных.
 *
 *   plural(1, ['позиция', 'позиции', 'позиций'])  → 'позиция'
 *   plural(2, ['позиция', 'позиции', 'позиций'])  → 'позиции'
 *   plural(5, ['позиция', 'позиции', 'позиций'])  → 'позиций'
 *
 *   nplural(N, forms)  → возвращает "N форма" (e.g. "5 позиций")
 */

export function plural(n, [one, few, many]) {
  const abs = Math.abs(Math.trunc(n));
  const m10  = abs % 10;
  const m100 = abs % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export function nplural(n, forms) {
  return `${n} ${plural(n, forms)}`;
}
