/*
 * OrderFromStock — корзина заказа со склада.
 *
 * Точка входа: пользователь выбрал на вкладке «Склад» N товаров → этот модал
 * предлагает per-line количество (предзаполнено suggestedQty из forecast),
 * выбор поставщика (по умолчанию самый дешёвый активный с этим товаром),
 * группирует по поставщикам и создаёт по одному `order(status:'draft')` на каждого.
 *
 * Фаза 2 (см. docs/08-technical/12-order-from-stock-spec.md §10):
 *   только создание черновиков, без отправки. Канал отправки — фаза 3.
 *
 * Ограничение фазы 2: товары без привязанных supplier_item показываются
 * отдельной секцией с просьбой завести позицию в каталоге поставщика.
 * Свободный ввод — фаза 4 polish.
 */
import { useState, useMemo } from 'react';
import Modal from '../Modal.jsx';
import { nplural } from '../../utils/plural.js';
import { CURRENCY, fmtPrice } from '../../utils/format.js';

export default function OrderFromStock({ products, records, statusByProduct, onClose, onCreate, showToast }) {
  // Per-product список доступных supplier_items (sorted по цене asc).
  const optionsByProduct = useMemo(() => {
    const activeSuppliers = new Map();
    for (const r of records) {
      if (r.type === 'supplier' && r.status !== 'paused') activeSuppliers.set(r.id, r);
    }
    const map = new Map();
    for (const p of products) {
      const opts = records
        .filter(r => r.type === 'supplier_item' && r.productId === p.id)
        .filter(i => activeSuppliers.has(i.supplierId) && Number.isFinite(Number(i.price)))
        .map(i => ({ item: i, supplier: activeSuppliers.get(i.supplierId) }))
        .sort((a, b) => Number(a.item.price) - Number(b.item.price));
      map.set(p.id, opts);
    }
    return map;
  }, [records, products]);

  // Initial lines: pre-fill quantity = suggestedQty (или 1 если нет forecast),
  // supplier = cheapest active (или первый из options).
  const [lines, setLines] = useState(() => products.map(p => {
    const opts = (records
      .filter(r => r.type === 'supplier_item' && r.productId === p.id)
      .filter(i => Number.isFinite(Number(i.price)))
      .sort((a, b) => Number(a.price) - Number(b.price)));
    const cheapest = opts[0] || null;
    const status = statusByProduct.get(p.id);
    return {
      productId:      p.id,
      productName:    p.name,
      unit:           p.unit,
      currentStock:   status?.stock ?? 0,
      quantity:       String(status?.suggestedQty ?? 1),
      supplierItemId: cheapest?.id ?? null,
    };
  }));
  const [saving, setSaving] = useState(false);

  function updateLine(productId, patch) {
    setLines(prev => prev.map(l => l.productId === productId ? { ...l, ...patch } : l));
  }
  function removeLine(productId) {
    setLines(prev => {
      const next = prev.filter(l => l.productId !== productId);
      if (next.length === 0) onClose();
      return next;
    });
  }

  // Computed: для каждой линии — выбранный supplier_item, total, валидации.
  const computedLines = useMemo(() => lines.map(l => {
    const opts = optionsByProduct.get(l.productId) || [];
    const chosen = opts.find(o => o.item.id === l.supplierItemId) || null;
    const qty = Number(l.quantity) || 0;
    const unitPrice = chosen ? Number(chosen.item.price) : 0;
    const minQty    = chosen?.item.minQty ? Number(chosen.item.minQty) : 0;
    return {
      ...l,
      options:   opts,
      chosen,
      qty,
      unitPrice,
      total:     qty * unitPrice,
      minQty,
      belowMin:  minQty > 0 && qty > 0 && qty < minQty,
      itemName:  chosen?.item.itemName || l.productName,
    };
  }), [lines, optionsByProduct]);

  // Группировка по supplierId — каждая группа = одна будущая заявка.
  const groups = useMemo(() => {
    const map = new Map();
    for (const l of computedLines) {
      if (!l.chosen || l.qty <= 0) continue;
      const sid = l.chosen.supplier.id;
      if (!map.has(sid)) map.set(sid, { supplier: l.chosen.supplier, lines: [], total: 0 });
      const g = map.get(sid);
      g.lines.push(l);
      g.total += l.total;
    }
    return [...map.values()];
  }, [computedLines]);

  const orphanLines = computedLines.filter(l => l.options.length === 0);

  const canSubmit = groups.length > 0 && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      let count = 0;
      for (const g of groups) {
        await onCreate({
          type:         'order',
          status:       'draft',
          supplierId:   g.supplier.id,
          supplierName: g.supplier.name,
          items: g.lines.map(l => ({
            itemId:    l.chosen.item.id,
            itemName:  l.itemName,
            unit:      l.unit,
            quantity:  l.qty,
            unitPrice: l.unitPrice,
            currency:  l.chosen.item.currency || CURRENCY,
            total:     l.total,
          })),
          totalAmount: g.total,
          currency:    CURRENCY,
          desiredDate: null,
          note:        '',
        });
        count++;
      }
      showToast(`Создано ${count} ${nplural(count, ['черновик заявки', 'черновика заявок', 'черновиков заявок'])}`);
      onClose();
    } catch (e) {
      showToast(e.message || 'Не удалось создать заявки', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Заказ со склада · ${products.length} ${nplural(products.length, ['товар','товара','товаров'])}`}
      onClose={onClose}
      onSave={submit}
      saving={saving}
      saveLabel={groups.length > 0
        ? `Создать ${groups.length} ${nplural(groups.length, ['заявку','заявки','заявок'])}`
        : 'Создать заявки'}
      disabled={!canSubmit}
    >
      <div className="ofs-list">
        {computedLines.map(l => l.options.length === 0 ? null : (
          <div key={l.productId} className="ofs-line">
            <div className="ofs-line-head">
              <div>
                <div className="ofs-line-name">{l.productName}</div>
                <div className="ofs-line-stock">Остаток: {l.currentStock} {l.unit}</div>
              </div>
              <button
                className="ofs-line-remove"
                title="Убрать из заказа"
                onClick={() => removeLine(l.productId)}
              >
                ✕
              </button>
            </div>

            <div className="ofs-qty-row">
              <label className="ofs-qty-label">Количество</label>
              <input
                type="number"
                step="0.1"
                min="0"
                inputMode="decimal"
                value={l.quantity}
                onChange={e => updateLine(l.productId, { quantity: e.target.value })}
                className={`ofs-qty-input ${l.belowMin ? 'input-error' : ''}`}
              />
              <span className="ofs-qty-unit">{l.unit}</span>
            </div>
            {l.belowMin && (
              <div className="field-hint warn">
                ⚠ Минимальная партия у поставщика: {l.minQty} {l.unit}
              </div>
            )}

            <div className="ofs-suppliers">
              {l.options.map((opt, idx) => (
                <label
                  key={opt.item.id}
                  className={`ofs-supplier ${l.supplierItemId === opt.item.id ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name={`sup-${l.productId}`}
                    checked={l.supplierItemId === opt.item.id}
                    onChange={() => updateLine(l.productId, { supplierItemId: opt.item.id })}
                  />
                  <div className="ofs-supplier-info">
                    <div className="ofs-supplier-name">
                      {opt.supplier.name}
                      {idx === 0 && l.options.length > 1 && (
                        <span className="ofs-cheapest">🟢 дешевле всех</span>
                      )}
                    </div>
                    <div className="ofs-supplier-meta">
                      {fmtPrice(opt.item.price)} / {opt.item.unit}
                      {opt.item.deliveryDays ? ` · доставка ${opt.item.deliveryDays} дн.` : ''}
                      {opt.item.minQty ? ` · мин. ${opt.item.minQty} ${opt.item.unit}` : ''}
                    </div>
                  </div>
                  <div className="ofs-supplier-total">
                    {fmtPrice((Number(l.quantity) || 0) * Number(opt.item.price))}
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}

        {orphanLines.length > 0 && (
          <div className="ofs-orphans">
            <div className="ofs-orphans-title">
              ⚠ Без поставщика ({orphanLines.length})
            </div>
            <div className="ofs-orphans-body">
              У этих товаров нет ни одного активного поставщика в каталоге —
              добавьте позицию во вкладке «Поставщики», чтобы заказать.
            </div>
            <ul className="ofs-orphans-list">
              {orphanLines.map(l => (
                <li key={l.productId}>
                  <span>{l.productName}</span>
                  <button
                    className="ofs-line-remove"
                    title="Убрать"
                    onClick={() => removeLine(l.productId)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {groups.length > 0 && (
          <div className="ofs-summary">
            <div className="ofs-summary-title">
              Будет создано {groups.length} {nplural(groups.length, ['заявка','заявки','заявок'])}:
            </div>
            <ul className="ofs-summary-list">
              {groups.map(g => (
                <li key={g.supplier.id}>
                  <span>{g.supplier.name}</span>
                  <span className="ofs-summary-meta">
                    {g.lines.length} {nplural(g.lines.length, ['поз.','поз.','поз.'])} ·{' '}
                    <strong>{fmtPrice(g.total)}</strong>
                  </span>
                </li>
              ))}
            </ul>
            <div className="ofs-summary-total">
              Итого: <strong>{fmtPrice(groups.reduce((s, g) => s + g.total, 0))}</strong>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
