import Modal from '../Modal.jsx';
import { fmtPrice, fmtDate, fmtIsoDate } from '../../utils/format.js';

export const STATUS = {
  draft:     { label: 'Черновик',  icon: '📝', cls: 'badge-pending'     },
  submitted: { label: 'Отправлена', icon: '📤', cls: 'badge-in_progress' },
  received:  { label: 'Принята',   icon: '✅', cls: 'badge-positive'    },
  cancelled: { label: 'Отменена',  icon: '✕',  cls: 'badge-cancelled'   },
};

export default function OrderDetail({ order, onClose, onStatusChange, onDelete }) {
  const meta = STATUS[order.status] || STATUS.draft;

  return (
    <Modal title={order.number || 'Заявка'} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span className={`badge ${meta.cls}`}>{meta.icon} {meta.label}</span>
        <span style={{ fontSize: 12, color: 'var(--neutral)' }}>создана {fmtDate(order.createdAt)}</span>
      </div>

      <div style={{ marginBottom: 16, fontSize: 14 }}>
        <div style={{ marginBottom: 4 }}><strong>{order.supplierName}</strong></div>
        <div style={{ color: 'var(--neutral)', fontSize: 13 }}>
          Желаемая дата: {fmtIsoDate(order.desiredDate)}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        {(order.items || []).map((it, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{it.itemName}</div>
              <div style={{ fontSize: 12, color: 'var(--neutral)' }}>
                {it.quantity} {it.unit} × {fmtPrice(it.unitPrice, it.currency)}
              </div>
            </div>
            <div style={{ fontWeight: 600 }}>{fmtPrice(it.total, it.currency)}</div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', fontSize: 16, fontWeight: 700 }}>
          <span>Итого</span>
          <span>{fmtPrice(order.totalAmount, order.currency)}</span>
        </div>
      </div>

      {order.note && (
        <div style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8, fontSize: 13 }}>
          <div style={{ fontSize: 11, color: 'var(--neutral)', textTransform: 'uppercase', marginBottom: 4 }}>Заметка</div>
          {order.note}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {order.status === 'draft' && (
          <>
            <button className="btn btn-primary btn-block" onClick={() => onStatusChange('submitted')}>📤 Отметить отправленной</button>
            <button className="btn btn-ghost btn-block"   onClick={() => onStatusChange('cancelled')}>Отменить</button>
          </>
        )}
        {order.status === 'submitted' && (
          <>
            <button className="btn btn-primary btn-block" onClick={() => onStatusChange('received')}>✅ Поставка принята</button>
            <button className="btn btn-ghost btn-block"   onClick={() => onStatusChange('cancelled')}>Отменить</button>
          </>
        )}
        {(order.status === 'received' || order.status === 'cancelled') && (
          <button className="btn btn-danger btn-block" onClick={onDelete}>Удалить из истории</button>
        )}
      </div>
    </Modal>
  );
}
