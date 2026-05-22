import { useState, useMemo } from 'react';
import { buildAllRecommendations, computeARAR } from '../utils/recommendations.js';
import { toIsoDate } from '../utils/dishSales.js';
import { DAY_MS } from '../utils/time.js';
import { nplural } from '../utils/plural.js';

/*
 * AI02 + AI03 + AI04 — карточка рекомендаций заказа.
 *
 * AI02: список «что заказать» из buildAllRecommendations
 * AI03: каждая рекомендация expandable — раскрывается блок «Почему»
 * AI04: 3 кнопки 👍/✎/👎 → создают record 'recommendation_action'
 *       → ARAR (NSM-01) собирается из этих записей
 *
 * Принцип PRD §3 «Recommend, don't act» — мы НИЧЕГО не заказываем
 * автоматически, только показываем и фиксируем выбор.
 */

const DAYS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function fmtQty(n, unit) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const rounded = Math.abs(n) < 10 ? Number(n).toFixed(2) : Math.round(n);
  return `${rounded} ${unit}`;
}

function WhyBlock({ rec }) {
  const f = rec.factors;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1);

  return (
    <div style={{
      padding: 12, marginTop: 8,
      background: '#f8fafc', borderRadius: 8, fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--primary)' }}>
        💡 Почему {rec.suggestedQty} {rec.unit}?
      </div>

      <div style={{ color: 'var(--neutral)', marginBottom: 8 }}>
        Прогноз потребления на {nplural(f.horizonDays, ['день', 'дня', 'дней'])}{' '}
        (lead time {f.leadTimeDays} + safety {f.safetyDays}):
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${f.dailyForecast.length}, 1fr)`,
        gap: 4, marginBottom: 8,
      }}>
        {f.dailyForecast.map((v, i) => {
          const d = new Date(startDate.getTime() + i * DAY_MS);
          return (
            <div key={i} style={{ textAlign: 'center', fontSize: 11 }}>
              <div style={{ color: 'var(--neutral)' }}>{DAYS_RU[d.getDay()]}</div>
              <div style={{ fontWeight: 600 }}>{v.toFixed(1)}</div>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 4 }}>
        Расчёт: <strong>{fmtQty(f.totalConsumption, rec.unit)}</strong> прогноз − <strong>{fmtQty(rec.currentStock, rec.unit)}</strong> на складе = <strong>{fmtQty(rec.rawNeeded, rec.unit)}</strong> нехватка
      </div>

      {f.cheapestSupplier && (
        <div style={{ marginBottom: 4 }}>
          Поставщик: <strong>{f.cheapestSupplier.supplier?.name}</strong>{' '}
          по {f.cheapestSupplier.price.toFixed(2)} BYN/{rec.unit}
          {f.cheapestSupplier.minQty > 0 && ` · мин. ${f.cheapestSupplier.minQty} ${rec.unit}`}
        </div>
      )}

      {f.contributingDishes.length > 0 && (
        <div>
          <div style={{ color: 'var(--neutral)', marginTop: 4 }}>Будет израсходовано на блюда:</div>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {f.contributingDishes.slice(0, 5).map(d => (
              <li key={d.dishId}>
                {d.dishName}: {fmtQty(d.forecastedConsumption, rec.unit)}
              </li>
            ))}
            {f.contributingDishes.length > 5 && <li>…и ещё {f.contributingDishes.length - 5}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function RecommendationRow({ rec, todayAction, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  // ARAR feedback
  if (todayAction) {
    const meta = {
      accepted:  { icon: '✓', color: 'var(--success)', label: 'Принято' },
      adjusted:  { icon: '✎', color: 'var(--accent)',  label: `Скорректировано: ${todayAction.actualQty} ${rec.unit}` },
      rejected:  { icon: '✕', color: 'var(--neutral)', label: 'Пропущено' },
    }[todayAction.action];
    return (
      <div style={{
        padding: 12, marginBottom: 8,
        background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
        opacity: 0.7,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <strong>{rec.productName}</strong>
            <span style={{ color: 'var(--neutral)', marginLeft: 8 }}>
              {rec.suggestedQty} {rec.unit}
            </span>
          </div>
          <span style={{ color: meta.color, fontSize: 13, fontWeight: 600 }}>
            {meta.icon} {meta.label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: 12, marginBottom: 8,
      background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{rec.productName}</div>
          <div style={{ fontSize: 12, color: 'var(--neutral)', marginTop: 2 }}>
            на складе {fmtQty(rec.currentStock, rec.unit)} · нужно ~{fmtQty(rec.rawNeeded, rec.unit)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>
            {rec.suggestedQty}
          </div>
          <div style={{ fontSize: 11, color: 'var(--neutral)' }}>{rec.unit}</div>
        </div>
      </div>

      <button
        className="btn btn-ghost btn-block"
        style={{ height: 32, fontSize: 12, marginTop: 8, justifyContent: 'flex-start' }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '▼' : '▶'} Почему столько?
      </button>

      {expanded && <WhyBlock rec={rec} />}

      {adjusting ? (
        <div style={{ marginTop: 8 }}>
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label>Количество</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={adjustQty}
                onChange={e => setAdjustQty(e.target.value)}
                placeholder={String(rec.suggestedQty)}
                autoFocus
              />
            </div>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label>Заметка</label>
              <input
                value={adjustNote}
                onChange={e => setAdjustNote(e.target.value)}
                placeholder="опционально"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost"   style={{ flex: 1, height: 36, fontSize: 13 }} onClick={() => setAdjusting(false)}>Отмена</button>
            <button className="btn btn-primary" style={{ flex: 1, height: 36, fontSize: 13 }}
                    onClick={() => onAction('adjusted', { actualQty: Number(adjustQty) || rec.suggestedQty, comment: adjustNote })}>
              Подтвердить
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" style={{ flex: 1, height: 36, fontSize: 13 }} onClick={() => onAction('accepted')}>
            👍 Принять
          </button>
          <button className="btn btn-ghost" style={{ height: 36, fontSize: 13, padding: '0 12px' }} onClick={() => setAdjusting(true)}>
            ✎
          </button>
          <button className="btn btn-ghost" style={{ height: 36, fontSize: 13, padding: '0 12px' }} onClick={() => onAction('rejected')}>
            👎
          </button>
        </div>
      )}
    </div>
  );
}

export default function RecommendationsView({ records, onCreate, showToast }) {
  const today = toIsoDate(new Date());

  const recommendations = useMemo(() => buildAllRecommendations(records), [records]);

  // Действия пользователя сегодня
  const todayActions = useMemo(
    () => records.filter(r => r.type === 'recommendation_action' && r.recDate === today),
    [records, today]
  );
  const arar = useMemo(() => computeARAR(todayActions), [todayActions]);

  async function recordAction(rec, action, extra = {}) {
    try {
      await onCreate({
        type:         'recommendation_action',
        productId:    rec.productId,
        productName:  rec.productName,
        recDate:      today,
        action,
        suggestedQty: rec.suggestedQty,
        actualQty:    extra.actualQty ?? rec.suggestedQty,
        comment:      extra.comment || '',
      });
      const label = action === 'accepted' ? 'принято' : action === 'adjusted' ? 'скорректировано' : 'пропущено';
      showToast(`${rec.productName} — ${label}`);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  if (recommendations.length === 0 && todayActions.length === 0) {
    return null;
  }

  return (
    <div style={{ padding: 16, paddingBottom: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>
          🤖 Рекомендации заказа
        </h3>
        {arar.total > 0 && (
          <span style={{ fontSize: 12, color: 'var(--neutral)' }}>
            ARAR {arar.arar?.toFixed(0)}% · {arar.total} {nplural(arar.total, ['действие', 'действия', 'действий'])}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--neutral)', marginBottom: 12 }}>
        Прогноз на основе продаж за последние 28 дней. Принимайте, корректируйте или пропускайте — каждое действие учится в ARAR.
      </div>

      {recommendations.map(rec => (
        <RecommendationRow
          key={rec.productId}
          rec={rec}
          todayAction={todayActions.find(a => a.productId === rec.productId)}
          onAction={(action, extra) => recordAction(rec, action, extra)}
        />
      ))}

      {recommendations.length === 0 && (
        <div style={{ padding: 16, fontSize: 13, color: 'var(--neutral)', textAlign: 'center' }}>
          На данный момент рекомендаций нет — запасов хватает.
        </div>
      )}
    </div>
  );
}
