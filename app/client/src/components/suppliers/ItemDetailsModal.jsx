import Modal from '../Modal.jsx';
import { fmtPrice, fmtDate } from '../../utils/format.js';

function trendPct(curr, prev) {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function TrendBadge({ pct }) {
  if (pct === null || pct === undefined) return <span className="badge badge-neutral">—</span>;
  if (Math.abs(pct) < 0.5) return <span className="badge badge-neutral">— 0%</span>;
  const cls = pct > 0 ? 'badge-negative' : 'badge-positive';
  const arrow = pct > 0 ? '▲' : '▼';
  return <span className={`badge ${cls}`}>{arrow} {Math.abs(pct).toFixed(1)}%</span>;
}

export default function ItemDetailsModal({ item, supplier, supplierMap, history, analogs, onClose, onEdit, onDelete }) {
  const sortedHistory = [...history].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Modal title={item.itemName} onClose={onClose}>
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--neutral)' }}>
        Поставщик: <strong>{supplier?.name || '—'}</strong>
      </div>

      <div className="form-row" style={{ marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Цена</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtPrice(item.price, item.currency)}</div>
          <div style={{ fontSize: 13, color: 'var(--neutral)' }}>за {item.unit}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Мин. партия</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{item.minQty ?? '—'} {item.minQty ? item.unit : ''}</div>
          <div style={{ fontSize: 13, color: 'var(--neutral)' }}>доставка {item.deliveryDays ?? '—'} дн.</div>
        </div>
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        История цен
      </h3>
      {sortedHistory.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 20 }}>Истории пока нет.</div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {sortedHistory.map(h => {
            const pct = trendPct(h.price, h.prevPrice);
            return (
              <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtPrice(h.price, item.currency)}</div>
                  <div style={{ fontSize: 12, color: 'var(--neutral)' }}>{fmtDate(h.createdAt)}</div>
                </div>
                <TrendBadge pct={pct} />
              </div>
            );
          })}
        </div>
      )}

      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Аналоги у других поставщиков
      </h3>
      {analogs.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 20 }}>
          {item.productId
            ? 'Других поставщиков на эту позицию пока нет.'
            : 'Похожих позиций не нашлось. Привяжите к товару склада, чтобы расширить поиск.'}
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {analogs.map(a => {
            const diff = trendPct(a.price, item.price);
            const matchBadge = a._matchExact
              ? <span className="badge badge-positive" style={{ fontSize: 10 }}>🎯 точное</span>
              : <span className="badge badge-neutral"  style={{ fontSize: 10 }}>~ {Math.round(a._matchSimilarity * 100)}%</span>;
            return (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{supplierMap.get(a.supplierId)?.name || '—'}</span>
                    {matchBadge}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--neutral)' }}>
                    {a.itemName} · {fmtPrice(a.price, a.currency)} / {a.unit}
                  </div>
                </div>
                <TrendBadge pct={diff} />
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button className="btn btn-ghost"  style={{ flex: 1 }} onClick={onEdit}>Редактировать</button>
        <button className="btn btn-danger" style={{ flex: 1 }} onClick={onDelete}>Удалить</button>
      </div>
    </Modal>
  );
}

export { TrendBadge, trendPct };
