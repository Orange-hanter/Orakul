import { useState, useMemo } from 'react';
import { nplural } from '../../utils/plural.js';
import { fmtPrice, fmtIsoDate } from '../../utils/format.js';
import RecommendationsView from '../RecommendationsView.jsx';
import OrderWizard from '../orders/OrderWizard.jsx';
import OrderDetail, { STATUS } from '../orders/OrderDetail.jsx';

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
      <RecommendationsView records={records} onCreate={onCreate} showToast={showToast} />

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
