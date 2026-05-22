/*
 * ABC-анализ меню (spec 10 §6.2).
 *
 * Классификация активных блюд по двум осям:
 *   - volume — продано порций за период
 *   - margin — маржа за порцию в BYN (sellPrice − cost)
 *
 * Медианы по обеим осям задают 4 квадранта:
 *
 *   A «Звёзды»          — high volume + high margin   — поддерживать
 *   B «Рабочие лошадки» — high volume + low margin    — оптимизировать
 *   C «Загадки»         — low volume + high margin    — продвигать
 *   D «Собаки»          — low volume + low margin     — рассмотреть вывод
 *
 * Блюда без рецепта / без продаж не получают margin / volume и попадают
 * в quadrant: null (показываются отдельной группой «Не классифицированы»).
 */

import { computeDishEconomics } from './dishCost.js';
import { salesMapByDish } from './dishSales.js';

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const ABC_LABELS = {
  A: { id: 'A', label: '⭐ Звёзды',          hint: 'поддерживать',          color: 'var(--success)' },
  B: { id: 'B', label: '🐎 Рабочие лошадки', hint: 'оптимизировать',        color: '#b45309' },
  C: { id: 'C', label: '❓ Загадки',         hint: 'продвигать',            color: '#1d4ed8' },
  D: { id: 'D', label: '🐶 Собаки',          hint: 'рассмотреть вывод',     color: 'var(--danger)' },
  X: { id: 'X', label: '∅ Не классифицированы', hint: 'нет данных по продажам или рецепту', color: 'var(--neutral)' },
};

/**
 * Вернёт { entries, medianVolume, medianMargin }, где entries — массив:
 *   { dish, volume, margin, quadrant, totalMargin }
 *
 * @param {Array} dishes — активные блюда
 * @param {Array} sales — все dish_sale (или уже отфильтрованные по venue)
 * @param {Array} supplierItems
 * @param {Array} suppliers
 * @param {{ start, end }} period — Date или ISO-строки
 */
export function computeABC(dishes, sales, supplierItems, suppliers, period) {
  const toIso = d => d instanceof Date ? d.toISOString().slice(0, 10) : d;
  const startIso = toIso(period.start);
  const endIso   = toIso(period.end);

  const volMap = salesMapByDish(sales, startIso, endIso);

  const enriched = dishes
    .filter(d => d.active !== false)
    .map(d => {
      const econ   = computeDishEconomics(d, supplierItems, suppliers);
      const volume = volMap.get(d.id) || 0;
      const margin = econ.margin; // null если нет recipe или sellPrice
      const totalMargin = (margin !== null && volume > 0) ? margin * volume : null;
      return { dish: d, volume, margin, totalMargin, econ };
    });

  // Медианы считаем только по тем, у кого есть данные.
  // Это исключает «не классифицируемые» из baseline и предотвращает смещение
  // медианы в ноль при многих пустых блюдах.
  const validForMedian = enriched.filter(e => e.margin !== null && e.volume > 0);
  const medianVolume = median(validForMedian.map(e => e.volume));
  const medianMargin = median(validForMedian.map(e => e.margin));

  for (const e of enriched) {
    if (e.margin === null || e.volume === 0 || medianVolume === null || medianMargin === null) {
      e.quadrant = 'X';
      continue;
    }
    const highVol = e.volume > medianVolume;
    const highMar = e.margin > medianMargin;
    e.quadrant = highVol && highMar ? 'A'
              : highVol && !highMar ? 'B'
              : !highVol && highMar ? 'C'
              : 'D';
  }

  return { entries: enriched, medianVolume, medianMargin };
}

/**
 * Группировка результата по квадранту → массив { quadrant, label, entries }.
 * Сортировка квадрантов: A → B → C → D → X. Внутри — по totalMargin desc.
 */
export function groupByQuadrant(result) {
  const groups = {};
  for (const e of result.entries) {
    (groups[e.quadrant] ||= []).push(e);
  }
  return ['A', 'B', 'C', 'D', 'X']
    .filter(q => groups[q]?.length)
    .map(q => ({
      quadrant: q,
      meta:     ABC_LABELS[q],
      entries:  groups[q].sort((a, b) => (b.totalMargin ?? -Infinity) - (a.totalMargin ?? -Infinity)),
    }));
}
