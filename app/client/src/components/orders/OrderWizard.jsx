import { useState } from 'react';
import Modal from '../Modal.jsx';
import { nplural } from '../../utils/plural.js';
import { CURRENCY, fmtPrice } from '../../utils/format.js';
import { todayIso } from '../../utils/time.js';

export default function OrderWizard({ suppliers, itemsBySupplier, onClose, onSave }) {
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
