import { useState } from 'react';
import { foodCostColor, ebitdaColor } from '../../../utils/pnl.js';

function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${Math.round(Number(n)).toLocaleString('ru')} BYN`;
}

function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

const SORT_OPTIONS = [
  { id: 'name',        label: 'По названию (А→Я)',    dir:  1, key: x => x.venue.name },
  { id: 'revenue',     label: 'По выручке ↓',          dir: -1, key: x => x.pnl.revenue },
  { id: 'foodCostPct', label: 'По Food Cost % ↓',      dir: -1, key: x => x.pnl.foodCostPct ?? -Infinity },
  { id: 'ebitda',      label: 'По EBITDA ↓',           dir: -1, key: x => x.pnl.ebitda },
  { id: 'ebitdaPct',   label: 'По EBITDA % ↓',         dir: -1, key: x => x.pnl.ebitdaPct ?? -Infinity },
];

export default function CompareView({ pnlByVenue, totals }) {
  const [sortId, setSortId] = useState('name');

  if (pnlByVenue.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">🏪</div>
        <p>Нет точек для сравнения</p>
        <small>Добавьте вторую точку в селекторе сверху</small>
      </div>
    );
  }

  const sortOption = SORT_OPTIONS.find(s => s.id === sortId) || SORT_OPTIONS[0];
  const sorted = [...pnlByVenue].sort((a, b) => {
    const ka = sortOption.key(a);
    const kb = sortOption.key(b);
    if (typeof ka === 'string') return ka.localeCompare(kb, 'ru') * sortOption.dir;
    return ((ka || 0) - (kb || 0)) * sortOption.dir;
  });

  const worstFoodCost = Math.max(...sorted
    .map(x => x.pnl.foodCostPct)
    .filter(v => v !== null && Number.isFinite(v))
  );

  const negativeEbitda = sorted.filter(x => x.pnl.ebitda < 0);

  // Метрики строк таблицы
  const metrics = [
    { key: 'revenue',        label: 'Выручка',         fmt: v => fmtMoney(v) },
    { key: 'variableCosts',  label: 'Себестоимость',   fmt: v => fmtMoney(v) },
    { key: 'foodCostPct',    label: 'Food Cost %',     fmt: v => fmtPct(v), color: foodCostColor },
    { key: 'grossProfit',    label: 'Валовая прибыль', fmt: v => fmtMoney(v), color: ebitdaColor },
    { key: 'grossMarginPct', label: 'Валовая маржа %', fmt: v => fmtPct(v) },
    { key: 'fixedTotal',     label: 'Постоянные',      fmt: v => fmtMoney(v) },
    { key: 'ebitda',         label: 'EBITDA',          fmt: v => fmtMoney(v), color: ebitdaColor, bold: true },
    { key: 'ebitdaPct',      label: 'EBITDA %',        fmt: v => fmtPct(v),  color: ebitdaColor, bold: true },
  ];

  // boxShadow для sticky первой колонки: тонкая граница + «занавес» при скролле
  const stickyShadow = '2px 0 0 -1px var(--border), 8px 0 8px -8px rgba(15,23,42,0.12)';

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
          Сортировка
        </span>
        <select
          value={sortId}
          onChange={e => setSortId(e.target.value)}
          style={{ flex: 1, maxWidth: 240, height: 36, fontSize: 13 }}
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 100 + sorted.length * 120 + 110 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, zIndex: 2, background: '#f8fafc', padding: '10px 12px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 130, boxShadow: stickyShadow }}>
                Метрика
              </th>
              {sorted.map(x => (
                <th key={x.venue.id} style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, minWidth: 110, background: '#f8fafc' }}>
                  {x.venue.name}
                </th>
              ))}
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, background: '#eff6ff', minWidth: 110 }}>
                Σ Сеть
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => (
              <tr key={m.key} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff', padding: '8px 12px', fontWeight: m.bold ? 700 : 500, color: m.bold ? 'var(--primary)' : '#374151', boxShadow: stickyShadow }}>
                  {m.label}
                </td>
                {sorted.map(x => {
                  const value = x.pnl[m.key];
                  const color = m.color ? m.color(value) : null;
                  return (
                    <td key={x.venue.id} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: m.bold ? 700 : 500, color: color || (m.bold ? 'var(--primary)' : '#374151') }}>
                      {m.fmt(value)}
                    </td>
                  );
                })}
                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, background: '#eff6ff', color: m.color ? m.color(totals?.[m.key]) || 'var(--primary)' : 'var(--primary)' }}>
                  {m.fmt(totals?.[m.key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(worstFoodCost > 38 || negativeEbitda.length > 0) && (
        <div style={{ marginTop: 16 }}>
          {sorted
            .filter(x => x.pnl.foodCostPct !== null && x.pnl.foodCostPct > 38)
            .map(x => (
              <div key={`fc-${x.venue.id}`} style={{ padding: 12, background: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#b91c1c', marginBottom: 8 }}>
                🔴 <strong>{x.venue.name}</strong>: Food Cost {fmtPct(x.pnl.foodCostPct)} — выше нормы (порог 38%)
              </div>
            ))}
          {negativeEbitda.map(x => (
            <div key={`eb-${x.venue.id}`} style={{ padding: 12, background: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#b91c1c', marginBottom: 8 }}>
              🔴 <strong>{x.venue.name}</strong>: EBITDA отрицательная ({fmtMoney(x.pnl.ebitda)})
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, padding: 12, background: '#fef9c3', borderRadius: 8, fontSize: 12, color: '#854d0e' }}>
        💡 Σ Сеть — суммы по точкам; проценты пересчитаны от сетевой выручки (взвешенное среднее). Прокрутите таблицу горизонтально, если точек много.
      </div>
    </>
  );
}
