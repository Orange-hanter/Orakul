import { useState, useMemo } from 'react';
import Modal from '../Modal.jsx';
import { nplural, plural } from '../../utils/plural.js';

const CURRENCY = 'BYN';

const STATUS = {
  draft:     { label: 'Черновик',  icon: '📝', cls: 'badge-pending'   },
  submitted: { label: 'Отправлена', icon: '📤', cls: 'badge-in_progress' },
  received:  { label: 'Принята',   icon: '✅', cls: 'badge-positive'  },
  cancelled: { label: 'Отменена',  icon: '✕',  cls: 'badge-cancelled' },
};

function fmtPrice(n, currency = CURRENCY) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${Number(n).toFixed(2)} ${currency}`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtIsoDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ── Wizard ───────────────────────────────────────────────────────────────────

function OrderWizard({ suppliers, itemsBySupplier, onClose, onSave }) {
  const [step,       setStep]       = useState(1);
  const [supplierId, setSupplierId] = useState(null);
  const [quantities, setQuantities] = useState({}); // { itemId: number }
  const [desiredDate, setDesiredDate] = useState(todayIso());
  const [note,       setNote]       = useState('');
  const [saving,     setSaving]     = useState(false);

  const supplier = suppliers.find(s => s.id === supplierId);
  const items    = supplier ? (itemsBySupplier.get(supplier.id) || []) : [];

  const selectedItems = items
    .map(it => ({ ...it, quantity: Number(quantities[it.id] || 0) }))
    .filter(it => it.quantity > 0);

  const totalAmount = selectedItems.reduce((s, it) => s + it.quantity * it.price, 0);

  const canNext =
    (step === 1 && !!supplierId) ||
    (step === 2 && selectedItems.length > 0) ||
    (step === 3 && !!desiredDate);

  async function submit() {
    if (selectedItems.length === 0) return;
    setSaving(true);
    try {
      await onSave({
        type:           'order',
        supplierId:     supplier.id,
        supplierName:   supplier.name,
        status:         'draft',
        items:          selectedItems.map(it => ({
          itemId:    it.id,
          itemName:  it.itemName,
          unit:      it.unit,
          quantity:  it.quantity,
          unitPrice: it.price,
          currency:  it.currency || CURRENCY,
          total:     it.quantity * it.price,
        })),
        totalAmount,
        currency:       CURRENCY,
        desiredDate,
        note:           note.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const title = `Шаг ${step} из 3 — ${
    step === 1 ? 'Поставщик' : step === 2 ? 'Позиции' : 'Обзор и условия'
  }`;

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSave={step === 3 ? submit : () => canNext && setStep(step + 1)}
      saveLabel={step === 3 ? 'Создать заявку' : 'Далее →'}
      saving={saving}
      disabled={step !== 3 && !canNext}
    >
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {[1, 2, 3].map(n => (
          <div key={n} style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: n <= step ? 'var(--accent)' : '#e2e8f0',
          }} />
        ))}
      </div>

      {step === 1 && (
        <div>
          {suppliers.length === 0 ? (
            <div className="empty"><div className="empty-icon">🏪</div><p>Сначала добавьте поставщиков</p></div>
          ) : suppliers.map(s => (
            <label
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                marginBottom: 8,
                border: `1.5px solid ${supplierId === s.id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 8,
                cursor: 'pointer',
                background: supplierId === s.id ? '#eff6ff' : '#fff',
              }}
            >
              <input
                type="radio"
                name="supplier"
                checked={supplierId === s.id}
                onChange={() => { setSupplierId(s.id); setQuantities({}); }}
                style={{ width: 20, height: 20 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--neutral)' }}>
                  {nplural((itemsBySupplier.get(s.id) || []).length, ['позиция', 'позиции', 'позиций'])}
                  {s.tags?.length ? ` · ${s.tags.join(', ')}` : ''}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      {step === 2 && (
        <div>
          {items.length === 0 ? (
            <div className="empty"><div className="empty-icon">📦</div><p>У поставщика нет позиций</p></div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 12 }}>
                Поставщик: <strong>{supplier.name}</strong>
              </div>
              {items
                .slice()
                .sort((a, b) => a.itemName.localeCompare(b.itemName, 'ru'))
                .map(it => {
                  const qty = quantities[it.id] || '';
                  return (
                    <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{it.itemName}</div>
                        <div style={{ fontSize: 12, color: 'var(--neutral)' }}>
                          {fmtPrice(it.price, it.currency)} / {it.unit}
                          {it.minQty ? ` · мин. ${it.minQty} ${it.unit}` : ''}
                        </div>
                      </div>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        value={qty}
                        onChange={e => setQuantities({ ...quantities, [it.id]: e.target.value })}
                        placeholder="0"
                        style={{ width: 90, height: 40, fontSize: 14, textAlign: 'right' }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--neutral)', width: 28 }}>{it.unit}</span>
                    </div>
                  );
                })}
              {selectedItems.length > 0 && (
                <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{nplural(selectedItems.length, ['позиция', 'позиции', 'позиций'])}</span>
                  <strong>{fmtPrice(totalAmount)}</strong>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--neutral)', marginBottom: 4 }}>Поставщик</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{supplier.name}</div>
            {selectedItems.map(it => (
              <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                <span>{it.itemName} × {it.quantity} {it.unit}</span>
                <span>{fmtPrice(it.quantity * it.price)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0', fontWeight: 700 }}>
              <span>Итого</span>
              <span>{fmtPrice(totalAmount)}</span>
            </div>
          </div>

          <div className="form-group">
            <label>Желаемая дата доставки</label>
            <input type="date" value={desiredDate} onChange={e => setDesiredDate(e.target.value)} min={todayIso()} />
          </div>
          <div className="form-group">
            <label>Заметка для поставщика</label>
            <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Опционально" />
          </div>
        </div>
      )}

      {step > 1 && (
        <button
          className="btn btn-ghost btn-block"
          style={{ marginTop: 12 }}
          onClick={() => setStep(step - 1)}
        >
          ← Назад
        </button>
      )}
    </Modal>
  );
}

// ── Order detail modal ───────────────────────────────────────────────────────

function OrderDetail({ order, onClose, onStatusChange, onDelete }) {
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

// ── Main tab ─────────────────────────────────────────────────────────────────

export default function OrdersTab({ records, onCreate, onUpdate, onDelete, showToast }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [openOrderId, setOpenOrderId] = useState(null);
  const [filter,     setFilter]     = useState('active'); // 'active' | 'all'

  const orders = useMemo(
    () => records
      .filter(r => r.type === 'order')
      .sort((a, b) => b.createdAt - a.createdAt),
    [records]
  );

  const suppliers = useMemo(
    () => records
      .filter(r => r.type === 'supplier' && r.status !== 'paused')
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [records]
  );

  const itemsBySupplier = useMemo(() => {
    const m = new Map();
    records.filter(r => r.type === 'supplier_item').forEach(it => {
      if (!m.has(it.supplierId)) m.set(it.supplierId, []);
      m.get(it.supplierId).push(it);
    });
    return m;
  }, [records]);

  const visible = filter === 'active'
    ? orders.filter(o => o.status === 'draft' || o.status === 'submitted')
    : orders;

  const openOrder = openOrderId ? orders.find(o => o.id === openOrderId) : null;

  async function createOrder(data) {
    await onCreate(data);
    showToast('Заявка создана');
  }

  async function changeStatus(orderId, newStatus) {
    const patch = { status: newStatus };
    if (newStatus === 'received') patch.receivedAt = Date.now();
    await onUpdate(orderId, patch);
    showToast(`Статус: ${STATUS[newStatus].label.toLowerCase()}`);
  }

  async function removeOrder(orderId) {
    if (!confirm('Удалить заявку из истории?')) return;
    await onDelete(orderId);
    setOpenOrderId(null);
    showToast('Заявка удалена');
  }

  return (
    <>
      <div style={{ padding: '12px 16px', display: 'flex', gap: 8, borderBottom: '1px solid #e2e8f0' }}>
        <button
          className={`btn ${filter === 'active' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ flex: 1, height: 36, fontSize: 13 }}
          onClick={() => setFilter('active')}
        >
          Активные ({orders.filter(o => o.status === 'draft' || o.status === 'submitted').length})
        </button>
        <button
          className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ flex: 1, height: 36, fontSize: 13 }}
          onClick={() => setFilter('all')}
        >
          Все ({orders.length})
        </button>
      </div>

      <div style={{ padding: 16, paddingBottom: 100 }}>
        {visible.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📝</div>
            <p>Заявок пока нет</p>
            <small>Создайте первую через «+»</small>
          </div>
        ) : (
          visible.map(o => {
            const meta = STATUS[o.status] || STATUS.draft;
            return (
              <div key={o.id} className="card" onClick={() => setOpenOrderId(o.id)} style={{ cursor: 'pointer' }}>
                <div className="card-header">
                  <div>
                    <div className="card-title">{o.number || 'без номера'}</div>
                    <div style={{ fontSize: 13, color: 'var(--neutral)', marginTop: 2 }}>{o.supplierName}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtPrice(o.totalAmount, o.currency)}</div>
                    <div style={{ fontSize: 12, color: 'var(--neutral)' }}>{(o.items || []).length} поз.</div>
                  </div>
                </div>
                <div className="card-footer">
                  <span className={`badge ${meta.cls}`}>{meta.icon} {meta.label}</span>
                  <span className="badge badge-neutral">📅 {fmtIsoDate(o.desiredDate)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <button
        className="fab"
        onClick={() => setWizardOpen(true)}
        aria-label="Создать заявку"
        disabled={suppliers.length === 0}
        title={suppliers.length === 0 ? 'Сначала добавьте активных поставщиков' : ''}
      >
        +
      </button>

      {wizardOpen && (
        <OrderWizard
          suppliers={suppliers}
          itemsBySupplier={itemsBySupplier}
          onClose={() => setWizardOpen(false)}
          onSave={createOrder}
        />
      )}

      {openOrder && (
        <OrderDetail
          order={openOrder}
          onClose={() => setOpenOrderId(null)}
          onStatusChange={(s) => changeStatus(openOrder.id, s)}
          onDelete={() => removeOrder(openOrder.id)}
        />
      )}
    </>
  );
}
