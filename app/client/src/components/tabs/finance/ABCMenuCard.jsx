import { useMemo } from 'react';
import { computeABC, groupByQuadrant, ABC_LABELS } from '../../../utils/abcMenu.js';

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${Math.round(Number(n)).toLocaleString('ru')} BYN`;
}

/*
 * ABC-карточка для меню. Принимает dishes/sales/supplierItems/suppliers/period
 * и рендерит 4 (+1 X) квадранта со списками блюд.
 */
export default function ABCMenuCard({ dishes, sales, supplierItems, suppliers, period }) {
  const result = useMemo(
    () => computeABC(dishes, sales, supplierItems, suppliers, period),
    [dishes, sales, supplierItems, suppliers, period]
  );

  const groups = useMemo(() => groupByQuadrant(result), [result]);
  const hasClassified = groups.some(g => g.quadrant !== 'X');

  if (groups.length === 0) {
    return null;
  }

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)', marginTop: 16 }}>
      <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        ABC-анализ меню
      </h3>

      {!hasClassified && (
        <div style={{ fontSize: 13, color: 'var(--neutral)', padding: '12px 0' }}>
          Введите продажи дня (вкладка «Меню» → «📋 Продажи дня») и проставьте цены продажи блюдам, чтобы получить классификацию.
        </div>
      )}

      {hasClassified && (
        <div style={{ fontSize: 12, color: 'var(--neutral)', marginBottom: 12 }}>
          Медианы: {Math.round(result.medianVolume)} порц · {fmtMoney(result.medianMargin)} маржа/порция. Делят меню на 4 квадранта.
        </div>
      )}

      {groups.map(group => (
        <div key={group.quadrant} style={{ marginBottom: 12 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            padding: '6px 0', borderBottom: '1.5px solid #e2e8f0', marginBottom: 4,
          }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, color: group.meta.color }}>{group.meta.label}</span>
              <span style={{ fontSize: 12, color: 'var(--neutral)', marginLeft: 6 }}>· {group.meta.hint}</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--neutral)' }}>{group.entries.length}</span>
          </div>
          {group.entries.map(e => (
            <div key={e.dish.id} style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              padding: '4px 0', fontSize: 13,
            }}>
              <div style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{e.dish.name}</div>
              <div style={{ fontSize: 12, color: 'var(--neutral)', minWidth: 80, textAlign: 'right' }}>
                {e.volume} порц
              </div>
              <div style={{ fontSize: 12, color: 'var(--neutral)', minWidth: 90, textAlign: 'right' }}>
                {e.margin !== null ? `${fmtMoney(e.margin)}/порц` : '— / порц'}
              </div>
              <div style={{ minWidth: 90, textAlign: 'right', fontWeight: 600, color: e.totalMargin !== null ? group.meta.color : 'var(--neutral)' }}>
                {e.totalMargin !== null ? fmtMoney(e.totalMargin) : '—'}
              </div>
            </div>
          ))}
        </div>
      ))}

      <div style={{ marginTop: 12, padding: 10, background: '#fef9c3', borderRadius: 8, fontSize: 11, color: '#854d0e' }}>
        💡 Классификация по медианам продаж и маржи за период. Звёзды держат основной доход, Собаки — кандидаты на вывод.
      </div>
    </div>
  );
}
