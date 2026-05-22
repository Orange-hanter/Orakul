import { useMemo } from 'react';
import { computeWriteoffControl, summarizeWriteoffControl } from '../../../utils/writeoffControl.js';
import { nplural } from '../../../utils/plural.js';

function fmtQty(n, unit) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const rounded = Math.abs(n) < 10 ? Number(n).toFixed(2) : Math.round(n);
  return `${rounded} ${unit}`;
}

function fmtDiff(n, unit) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const abs = Math.abs(n);
  const rounded = abs < 10 ? abs.toFixed(2) : Math.round(abs);
  return `${sign}${rounded} ${unit}`;
}

function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Math.round(n)}%`;
}

const STATUS_META = {
  over:      { icon: '🔴', color: 'var(--danger)',  label: 'Перерасход' },
  under:     { icon: '🟡', color: '#b45309',        label: 'Недосписано' },
  ok:        { icon: '🟢', color: 'var(--success)', label: 'В норме'   },
  'no-data': { icon: '⚪', color: 'var(--neutral)', label: 'Нет данных' },
};

/*
 * Карточка «Факт vs Норма» — закрывает US-02 P0.
 * Берёт сегодняшние/недельные продажи блюд × нормы рецептов и сравнивает
 * с фактическим списанием (stock_entry). Сортирует от худших проблем вверх.
 */
export default function WriteoffControlCard({ records, period }) {
  const rows = useMemo(
    () => computeWriteoffControl(records, period),
    [records, period]
  );

  const summary = useMemo(() => summarizeWriteoffControl(rows), [rows]);

  if (rows.length === 0) {
    return null;
  }

  // Скрываем no-data строки по умолчанию — обычно их много и они не информативны.
  const informative = rows.filter(r => r.status !== 'no-data');
  const hasProblems = summary.over > 0 || summary.under > 0;

  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 12, padding: 16,
      border: '1px solid var(--border)', marginTop: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Факт vs Норма
        </h3>
        <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
          {summary.over > 0  && <span className="badge badge-negative">{nplural(summary.over, ['перерасход', 'перерасхода', 'перерасходов'])}</span>}
          {summary.under > 0 && <span className="badge badge-pending">{nplural(summary.under, ['недосписан', 'недосписана', 'недосписано'])}</span>}
          {summary.ok > 0    && <span className="badge badge-positive">{nplural(summary.ok, ['в норме', 'в норме', 'в норме'])}</span>}
        </div>
      </div>

      {informative.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--neutral)', padding: '12px 0' }}>
          Ни один продукт ещё не имеет данных и о продажах, и о фактическом списании за период.
        </div>
      )}

      {informative.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--neutral)', marginBottom: 8 }}>
            Сравнение того, сколько ингредиента должно было быть списано по рецепту (норма) с фактическим списанием на складе. Отклонение более ±10% — повод проверить рецептуру / контроль качества / возможные потери.
          </div>

          <div style={{ borderTop: '1px solid #e2e8f0' }}>
            {informative.map(r => {
              const meta = STATUS_META[r.status];
              return (
                <div key={r.productId} style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13,
                }}>
                  <span style={{ width: 18 }} title={meta.label}>{meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{r.productName}</div>
                  <div style={{ width: 90,  textAlign: 'right', color: 'var(--neutral)' }}>
                    норма {fmtQty(r.theoretical, r.unit)}
                  </div>
                  <div style={{ width: 90, textAlign: 'right', color: 'var(--neutral)' }}>
                    факт {fmtQty(r.actual, r.unit)}
                  </div>
                  <div style={{ width: 110, textAlign: 'right', color: meta.color, fontWeight: 600 }}>
                    {fmtDiff(r.diff, r.unit)} ({fmtPct(r.diffPct)})
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ marginTop: 12, padding: 10, background: '#fef9c3', borderRadius: 8, fontSize: 11, color: '#854d0e' }}>
        💡 Норма = Σ (продано порций × норма по рецепту). Факт = списания со склада за тот же период.
        {hasProblems ? ' Проверьте крупные отклонения — они могут указывать на потери, ошибки учёта или устаревшие рецепты.' : ' Расхождений в пределах допустимого нет.'}
      </div>
    </div>
  );
}
