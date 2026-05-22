import { useState } from 'react';
import Modal from '../Modal.jsx';
import { CURRENCY } from '../../utils/format.js';

export default function ItemForm({ initial, supplier, products, onClose, onSave }) {
  const [productId, setProductId] = useState(initial?.productId || '');
  const [itemName,  setItemName]  = useState(initial?.itemName  || '');
  const [unit,      setUnit]      = useState(initial?.unit      || 'кг');
  const [price,     setPrice]     = useState(initial?.price ?? '');
  const [minQty,    setMinQty]    = useState(initial?.minQty ?? '');
  const [deliveryDays, setDeliveryDays] = useState(initial?.deliveryDays ?? '');
  const [saving,    setSaving]    = useState(false);

  function pickProduct(pid) {
    setProductId(pid);
    if (pid) {
      const p = products.find(x => x.id === pid);
      if (p) {
        if (!itemName.trim()) setItemName(p.name);
        if (p.unit) setUnit(p.unit);
      }
    }
  }

  async function submit() {
    if (!itemName.trim() || price === '' || Number.isNaN(Number(price))) return;
    setSaving(true);
    try {
      await onSave({
        type:         'supplier_item',
        supplierId:   supplier.id,
        productId:    productId || null,
        itemName:     itemName.trim(),
        unit:         unit.trim() || 'шт',
        price:        Number(price),
        currency:     CURRENCY,
        minQty:       minQty       === '' ? null : Number(minQty),
        deliveryDays: deliveryDays === '' ? null : Number(deliveryDays),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initial ? 'Редактировать позицию' : 'Новая позиция'}
      onClose={onClose}
      onSave={submit}
      saving={saving}
    >
      <div className="form-group">
        <label>Привязка к товару склада (для поиска аналогов)</label>
        <select value={productId} onChange={e => pickProduct(e.target.value)}>
          <option value="">— Без привязки (свободный ввод) —</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Название у поставщика</label>
        <input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Мука пшеничная в/с ГОСТ" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Цена</label>
          <input type="number" step="0.01" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="1.20" />
        </div>
        <div className="form-group">
          <label>Единица</label>
          <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="кг" />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Мин. партия</label>
          <input type="number" step="0.1" inputMode="decimal" value={minQty} onChange={e => setMinQty(e.target.value)} placeholder="5" />
        </div>
        <div className="form-group">
          <label>Срок доставки (дней)</label>
          <input type="number" step="1" inputMode="numeric" value={deliveryDays} onChange={e => setDeliveryDays(e.target.value)} placeholder="2" />
        </div>
      </div>
    </Modal>
  );
}
