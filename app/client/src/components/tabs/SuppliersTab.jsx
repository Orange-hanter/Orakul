import { useState, useMemo } from 'react';
import ImportPriceListModal from '../ImportPriceListModal.jsx';
import { findAnalogs } from '../../utils/fuzzyMatch.js';
import { nplural } from '../../utils/plural.js';
import { fmtPrice } from '../../utils/format.js';
import SupplierForm from '../suppliers/SupplierForm.jsx';
import ItemForm from '../suppliers/ItemForm.jsx';
import ItemDetailsModal, { TrendBadge, trendPct } from '../suppliers/ItemDetailsModal.jsx';

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

  // Pre-compute analogs once per (items, suppliers) snapshot — был N²-проход
  // на каждый рендер из-за вызова из selectedItems.map. Теперь — Map<itemId, analogs>.
  const analogsByItemId = useMemo(() => {
    const candidatePool = items.filter(i =>
      supplierMap.get(i.supplierId)?.status !== 'paused'
    );
    const m = new Map();
    for (const it of items) {
      const analogs = findAnalogs(it, candidatePool, { threshold: 0.3, sameUnit: true })
        .map(x => ({
          ...x.item,
          _matchSimilarity: x.similarity,
          _matchExact:      x.exact,
        }));
      m.set(it.id, analogs);
    }
    return m;
  }, [items, supplierMap]);

  function itemAnalogs(item) {
    return analogsByItemId.get(item.id) || [];
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
              {nplural(selectedItems.length, ['позиция', 'позиции', 'позиций'])} ·{' '}
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
                // Inline cheaper-than hint только для уверенных совпадений.
                const cheaper = analog.find(a =>
                  a.price < it.price && (a._matchExact || a._matchSimilarity >= 0.7)
                );
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
                  <span className="badge badge-neutral">{nplural(itemCount, ['позиция', 'позиции', 'позиций'])}</span>
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
