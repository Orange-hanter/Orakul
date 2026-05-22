import { useState, useMemo } from 'react';
import Modal from '../Modal.jsx';
import ImportPriceListModal from '../ImportPriceListModal.jsx';

const CURRENCY = 'BYN';

function fmtPrice(n, currency = CURRENCY) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${Number(n).toFixed(2)} ${currency}`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' });
}

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

// ── Supplier form ────────────────────────────────────────────────────────────

function SupplierForm({ initial, onClose, onSave }) {
  const [name,    setName]    = useState(initial?.name    || '');
  const [contact, setContact] = useState(initial?.contact || '');
  const [tags,    setTags]    = useState((initial?.tags || []).join(', '));
  const [status,  setStatus]  = useState(initial?.status  || 'active');
  const [note,    setNote]    = useState(initial?.note    || '');
  const [saving,  setSaving]  = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        type:    'supplier',
        name:    name.trim(),
        contact: contact.trim(),
        tags:    tags.split(',').map(t => t.trim()).filter(Boolean),
        status,
        note:    note.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initial ? 'Редактировать поставщика' : 'Новый поставщик'}
      onClose={onClose}
      onSave={submit}
      saving={saving}
    >
      <div className="form-group">
        <label>Название</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="ООО АгроПоставка" autoFocus />
      </div>
      <div className="form-group">
        <label>Контакт</label>
        <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Иван Петров, +375 29 123 45 67" />
      </div>
      <div className="form-group">
        <label>Категории (через запятую)</label>
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="мясо, молочка, бакалея" />
      </div>
      <div className="form-group">
        <label>Статус</label>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="active">Активен</option>
          <option value="paused">Приостановлен</option>
        </select>
      </div>
      <div className="form-group">
        <label>Заметка</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} />
      </div>
    </Modal>
  );
}

// ── Supplier item form ───────────────────────────────────────────────────────

function ItemForm({ initial, supplier, products, onClose, onSave }) {
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

// ── Item details modal (history + analogs) ──────────────────────────────────

function ItemDetailsModal({ item, supplier, supplierMap, history, analogs, onClose, onEdit, onDelete }) {
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
      {!item.productId ? (
        <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 20 }}>
          Поиск аналогов недоступен — позиция не привязана к товару склада.
        </div>
      ) : analogs.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 20 }}>
          Других поставщиков на эту позицию пока нет.
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {analogs.map(a => {
            const diff = trendPct(a.price, item.price);
            return (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{supplierMap.get(a.supplierId)?.name || '—'}</div>
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
        <button className="btn btn-ghost" onClick={onEdit}>Редактировать</button>
        <button className="btn btn-danger" onClick={onDelete}>Удалить</button>
      </div>
    </Modal>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────────

export default function SuppliersTab({ records, onCreate, onUpdate, onDelete, showToast }) {
  const [selectedSupplierId, setSelectedSupplierId] = useState(null);
  const [supplierForm,       setSupplierForm]       = useState(null); // {initial: supplier|null}
  const [itemForm,           setItemForm]           = useState(null); // {initial: item|null, supplier}
  const [openItemId,         setOpenItemId]         = useState(null);
  const [search,             setSearch]             = useState('');
  const [importOpen,         setImportOpen]         = useState(false);

  const suppliers = useMemo(
    () => records.filter(r => r.type === 'supplier').sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [records]
  );

  const products = useMemo(
    () => records.filter(r => r.type === 'product').sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [records]
  );

  const items = useMemo(
    () => records.filter(r => r.type === 'supplier_item'),
    [records]
  );

  const history = useMemo(
    () => records.filter(r => r.type === 'supplier_price_history'),
    [records]
  );

  const supplierMap = useMemo(() => {
    const m = new Map();
    suppliers.forEach(s => m.set(s.id, s));
    return m;
  }, [suppliers]);

  const itemsBySupplier = useMemo(() => {
    const m = new Map();
    items.forEach(it => {
      if (!m.has(it.supplierId)) m.set(it.supplierId, []);
      m.get(it.supplierId).push(it);
    });
    return m;
  }, [items]);

  const selectedSupplier = selectedSupplierId ? supplierMap.get(selectedSupplierId) : null;
  const selectedItems    = selectedSupplier ? (itemsBySupplier.get(selectedSupplier.id) || []) : [];
  const openItem         = openItemId ? items.find(i => i.id === openItemId) : null;

  const filteredSuppliers = useMemo(() => {
    if (!search.trim()) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }, [suppliers, search]);

  function itemAnalogs(item) {
    if (!item.productId) return [];
    return items
      .filter(i => i.id !== item.id && i.productId === item.productId)
      .filter(i => supplierMap.get(i.supplierId)?.status !== 'paused')
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  }

  function itemHistory(itemId) {
    return history.filter(h => h.itemId === itemId);
  }

  function itemTrend(item) {
    const h = itemHistory(item.id).sort((a, b) => b.createdAt - a.createdAt);
    if (h.length < 2) return null;
    return trendPct(h[0].price, h[1].price);
  }

  async function saveSupplier(data) {
    if (supplierForm?.initial) {
      await onUpdate(supplierForm.initial.id, data);
      showToast('Поставщик обновлён');
    } else {
      const created = await onCreate(data);
      showToast('Поставщик добавлен');
      if (created?.id) setSelectedSupplierId(created.id);
    }
  }

  async function saveItem(data) {
    if (itemForm?.initial) {
      await onUpdate(itemForm.initial.id, data);
      showToast('Позиция обновлена');
    } else {
      await onCreate(data);
      showToast('Позиция добавлена');
    }
  }

  async function removeSupplier(s) {
    if (!confirm(`Удалить поставщика «${s.name}» вместе со всеми позициями и историей цен?`)) return;
    await onDelete(s.id);
    setSelectedSupplierId(null);
    showToast('Поставщик удалён');
  }

  async function removeItem(it) {
    if (!confirm(`Удалить позицию «${it.itemName}»?`)) return;
    await onDelete(it.id);
    setOpenItemId(null);
    showToast('Позиция удалена');
  }

  // ── Render — supplier detail view ──────────────────────────────────────────

  if (selectedSupplier) {
    return (
      <>
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #e2e8f0' }}>
          <button className="btn btn-ghost" style={{ padding: '6px 12px' }} onClick={() => setSelectedSupplierId(null)}>← Назад</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedSupplier.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--neutral)' }}>
              {selectedItems.length} {selectedItems.length === 1 ? 'позиция' : 'позиций'} ·{' '}
              {selectedSupplier.status === 'paused' ? '⏸ Приостановлен' : '✅ Активен'}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            style={{ padding: '6px 12px' }}
            onClick={() => setImportOpen(true)}
            title="Импорт прайс-листа"
          >
            📥
          </button>
          <button className="btn btn-ghost" style={{ padding: '6px 12px' }} onClick={() => setSupplierForm({ initial: selectedSupplier })}>
            ✎
          </button>
        </div>

        <div style={{ padding: 16, paddingBottom: 100 }}>
          {selectedSupplier.contact && (
            <div style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8, fontSize: 14 }}>
              📞 {selectedSupplier.contact}
            </div>
          )}

          {selectedItems.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📦</div>
              <p>Позиций пока нет</p>
              <small>Добавьте первую позицию через «+»</small>
            </div>
          ) : (
            selectedItems
              .slice()
              .sort((a, b) => a.itemName.localeCompare(b.itemName, 'ru'))
              .map(it => {
                const trend  = itemTrend(it);
                const analog = itemAnalogs(it);
                const cheaper = analog.find(a => a.price < it.price);
                return (
                  <div key={it.id} className="card" onClick={() => setOpenItemId(it.id)} style={{ cursor: 'pointer' }}>
                    <div className="card-header">
                      <div className="card-title">{it.itemName}</div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtPrice(it.price, it.currency)}</div>
                        <div style={{ fontSize: 12, color: 'var(--neutral)' }}>за {it.unit}</div>
                      </div>
                    </div>
                    <div className="card-footer">
                      {trend !== null && <TrendBadge pct={trend} />}
                      {!it.productId && <span className="badge badge-neutral">Без привязки</span>}
                      {cheaper && (
                        <span className="badge badge-positive">
                          💡 дешевле у {supplierMap.get(cheaper.supplierId)?.name}: {fmtPrice(cheaper.price, cheaper.currency)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
          )}
        </div>

        <button
          className="fab"
          onClick={() => setItemForm({ initial: null, supplier: selectedSupplier })}
          aria-label="Добавить позицию"
        >
          +
        </button>

        {itemForm && (
          <ItemForm
            initial={itemForm.initial}
            supplier={itemForm.supplier}
            products={products}
            onClose={() => setItemForm(null)}
            onSave={saveItem}
          />
        )}

        {supplierForm && (
          <SupplierForm
            initial={supplierForm.initial}
            onClose={() => setSupplierForm(null)}
            onSave={saveSupplier}
          />
        )}

        {openItem && (
          <ItemDetailsModal
            item={openItem}
            supplier={selectedSupplier}
            supplierMap={supplierMap}
            history={itemHistory(openItem.id)}
            analogs={itemAnalogs(openItem)}
            onClose={() => setOpenItemId(null)}
            onEdit={() => {
              setItemForm({ initial: openItem, supplier: selectedSupplier });
              setOpenItemId(null);
            }}
            onDelete={() => removeItem(openItem)}
          />
        )}

        {importOpen && (
          <ImportPriceListModal
            supplier={selectedSupplier}
            products={products}
            onClose={() => setImportOpen(false)}
            onCreate={onCreate}
            showToast={showToast}
            onComplete={() => showToast('Прайс-лист загружен')}
          />
        )}
      </>
    );
  }

  // ── Render — suppliers list ────────────────────────────────────────────────

  return (
    <>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Поиск по поставщикам или категории"
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ padding: 16, paddingBottom: 100 }}>
        {filteredSuppliers.length === 0 && search ? (
          <div className="empty">
            <div className="empty-icon">🔍</div>
            <p>Ничего не найдено</p>
          </div>
        ) : suppliers.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🏪</div>
            <p>Поставщиков пока нет</p>
            <small>Добавьте первого через «+»</small>
          </div>
        ) : (
          filteredSuppliers.map(s => {
            const itemCount = (itemsBySupplier.get(s.id) || []).length;
            return (
              <div key={s.id} className="card" onClick={() => setSelectedSupplierId(s.id)} style={{ cursor: 'pointer' }}>
                <div className="card-header">
                  <div className="card-title">{s.name}</div>
                  {s.status === 'paused' && <span className="badge badge-neutral">Приостановлен</span>}
                </div>
                {s.contact && <div className="card-body" style={{ fontSize: 13 }}>📞 {s.contact}</div>}
                <div className="card-footer">
                  <span className="badge badge-neutral">{itemCount} {itemCount === 1 ? 'позиция' : 'позиций'}</span>
                  {(s.tags || []).map(t => (
                    <span key={t} className="badge badge-kpi">{t}</span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <button
        className="fab"
        onClick={() => setSupplierForm({ initial: null })}
        aria-label="Добавить поставщика"
      >
        +
      </button>

      {supplierForm && (
        <SupplierForm
          initial={supplierForm.initial}
          onClose={() => setSupplierForm(null)}
          onSave={saveSupplier}
        />
      )}
    </>
  );
}
