import { useState, useMemo, useRef } from 'react';
import Modal from '../Modal.jsx';
import AlphabetScroller, { firstLetter, sortLetters } from '../AlphabetScroller.jsx';
import { detectAllAnomalies } from '../../utils/anomaly.js';
import { buildStockStatusMap, explainStockStatus } from '../../utils/stockStatus.js';
import { nplural } from '../../utils/plural.js';
import { fmtDateTime as fmtDate } from '../../utils/format.js';
import { DAY_MS } from '../../utils/time.js';
import OrderFromStock from '../orders/OrderFromStock.jsx';

const UNITS = ['кг', 'г', 'л', 'мл', 'шт', 'уп', 'порц', 'бут'];
const CATEGORIES = ['Мясо/Рыба', 'Гастрономия', 'Морепродукты', 'Молочное', 'Овощи/Фрукты', 'Сухие', 'Заморозка', 'Соусы', 'Тесто', 'Десерты', 'Напитки', 'Прочее'];

const EMPTY_PRODUCT = { name: '', unit: 'кг', category: 'Прочее', reorderPoint: '' };

const MODE_LABEL  = { receipt: 'Приход', writeoff: 'Списание', inventory: 'Переучёт' };
const MODE_VERB   = { receipt: 'Поступило', writeoff: 'Списать', inventory: 'Фактический остаток' };

function round2(n) { return +(+n).toFixed(2); }

function qtyClass(qty, unit) {
  if (qty === null || qty === undefined) return '';
  if (['кг','л','бут','уп'].includes(unit)) {
    if (qty <= 0.5) return 'qty-low';
    if (qty <= 2)   return 'qty-mid';
    return 'qty-good';
  }
  if (qty <= 2)  return 'qty-low';
  if (qty <= 10) return 'qty-mid';
  return 'qty-good';
}

export default function StockTab({ records, byType, venues, currentVenueId, loading, onCreate, onUpdate, onDelete, showToast }) {
  const currentVenue = venues?.find(v => v.id === currentVenueId) || null;
  const [logModal,  setLogModal]  = useState(null);
  const [addModal,  setAddModal]  = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [mode,      setMode]      = useState('receipt');
  const [qty,       setQty]       = useState('');
  const [note,      setNote]      = useState('');
  const [form,      setForm]      = useState(EMPTY_PRODUCT);
  const [saving,    setSaving]    = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [orderModal,  setOrderModal]  = useState(false);

  const sectionRefs = useRef({});

  function toggleSelected(productId) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else                     next.add(productId);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  const products = useMemo(
    () => (byType?.get('product') || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [byType]
  );

  const stockEntries = useMemo(() => byType?.get('stock_entry') || [], [byType]);

  const entryByProduct = useMemo(() => {
    const map = new Map();
    stockEntries.forEach(e => {
      const cur = map.get(e.productId);
      if (!cur || cur.createdAt < e.createdAt) map.set(e.productId, e);
    });
    return map;
  }, [stockEntries]);

  const recent = useMemo(() => {
    return products
      .map(p => ({ p, last: entryByProduct.get(p.id) }))
      .filter(x => x.last)
      .sort((a, b) => b.last.createdAt - a.last.createdAt)
      .slice(0, 6)
      .map(x => x.p);
  }, [products, entryByProduct]);

  const grouped = useMemo(() => {
    const out = {};
    products.forEach(p => {
      const L = firstLetter(p.name);
      (out[L] ||= []).push(p);
    });
    return out;
  }, [products]);

  // Days-to-depletion: based on writeoffs + inventory deficits over last 14 days
  const daysLeftMap = useMemo(() => {
    const map = new Map();
    const cutoff = Date.now() - 14 * DAY_MS;
    products.forEach(p => {
      const last = entryByProduct.get(p.id);
      if (!last) return;
      const current = last.resulting ?? 0;
      if (current <= 0) { map.set(p.id, 0); return; }
      const outflow = stockEntries
        .filter(e => e.productId === p.id && e.createdAt >= cutoff && e.delta !== null)
        .filter(e => e.kind === 'writeoff' || (e.kind === 'inventory' && e.delta < 0))
        .reduce((sum, e) => sum + Math.abs(e.delta), 0);
      if (outflow === 0) return;
      map.set(p.id, Math.round(current / (outflow / 14)));
    });
    return map;
  }, [products, stockEntries, entryByProduct]);

  // Low-stock сигнал: 'out' / 'low-manual' / 'low-forecast' / 'ok'
  // см. docs/08-technical/12-order-from-stock-spec.md §4
  const stockStatusMap = useMemo(
    () => buildStockStatusMap(records, products),
    [records, products]
  );

  // AI05 — аномальные списания (today > 2σ относительно 14-дневного среднего)
  const anomalies = useMemo(() => detectAllAnomalies(records), [records]);
  const anomalyByProduct = useMemo(() => {
    const m = new Map();
    for (const a of anomalies) m.set(a.productId, a);
    return m;
  }, [anomalies]);

  const letters = sortLetters(Object.keys(grouped));

  function jumpTo(letter) {
    sectionRefs.current[letter]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function openLog(p) {
    setMode('receipt');
    setQty('');
    setNote('');
    setLogModal(p);
  }

  function closeLog() {
    setLogModal(null);
    setQty('');
    setNote('');
  }

  // history for the currently open product, newest first
  const productHistory = useMemo(() => {
    if (!logModal) return [];
    return stockEntries
      .filter(e => e.productId === logModal.id)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [stockEntries, logModal]);

  const lastForOpen = productHistory[0] || null;
  const prevResulting = lastForOpen ? lastForOpen.resulting : null;

  // computed preview
  const amount = qty === '' ? null : +qty;
  const amountValid = amount !== null && !isNaN(amount) && amount >= 0;
  let nextResulting = null;
  let nextDelta     = null;
  if (amountValid) {
    if (mode === 'receipt')   { nextDelta =  amount; nextResulting = round2((prevResulting ?? 0) + amount); }
    if (mode === 'writeoff')  { nextDelta = -amount; nextResulting = round2((prevResulting ?? 0) - amount); }
    if (mode === 'inventory') { nextResulting = round2(amount); nextDelta = prevResulting === null ? null : round2(amount - prevResulting); }
  }

  const willGoNegative = amountValid && nextResulting !== null && nextResulting < 0;

  async function saveOp() {
    if (!amountValid) {
      showToast('Введите количество', 'error');
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        type:        'stock_entry',
        productId:   logModal.id,
        productName: logModal.name,
        unit:        logModal.unit,
        kind:        mode,
        delta:       nextDelta,
        resulting:   nextResulting,
        note:        note.trim() || null,
        source:      'manual',
        externalId:  null,
      });
      let msg = `${logModal.name}: ${MODE_LABEL[mode]} ${nextResulting} ${logModal.unit}`;
      if (mode === 'inventory' && nextDelta !== null && nextDelta !== 0) {
        msg += nextDelta < 0 ? ` (недостача ${nextDelta})` : ` (излишек +${nextDelta})`;
      }
      showToast(msg);
      closeLog();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry) {
    if (!confirm(`Удалить последнюю операцию (${MODE_LABEL[entry.kind] || 'учёт'} ${entry.resulting} ${entry.unit})?`)) return;
    try {
      await onDelete(entry.id);
      showToast('Операция отменена');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function saveProduct(isEdit) {
    if (!form.name.trim()) {
      showToast('Введите название продукта', 'error');
      return;
    }
    const reorderPointNum = form.reorderPoint === '' || form.reorderPoint == null
      ? null
      : Number(form.reorderPoint);
    if (reorderPointNum !== null && (Number.isNaN(reorderPointNum) || reorderPointNum < 0)) {
      showToast('Порог заказа должен быть числом ≥ 0', 'error');
      return;
    }
    const payload = { ...form, reorderPoint: reorderPointNum };
    setSaving(true);
    try {
      if (isEdit) {
        await onUpdate(editModal.id, payload);
        showToast('Продукт обновлён');
        setEditModal(null);
      } else {
        await onCreate({ type: 'product', ...payload });
        showToast('Продукт добавлен');
        setAddModal(false);
      }
      setForm(EMPTY_PRODUCT);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(p) {
    if (!confirm(`Удалить «${p.name}»?`)) return;
    try {
      await onDelete(p.id);
      showToast(`${p.name} удалён`);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  if (loading) return <div className="loading"><div className="spinner" /> Загрузка…</div>;

  function ProductRow({ p }) {
    const last = entryByProduct.get(p.id);
    const cls  = last ? qtyClass(last.resulting, p.unit) : '';
    const days = daysLeftMap.get(p.id);
    const daysCls = days === undefined ? '' : days <= 1 ? 'days-critical' : days <= 3 ? 'days-warn' : days <= 7 ? 'days-ok' : '';
    const anomaly = anomalyByProduct.get(p.id);
    const status  = stockStatusMap.get(p.id);
    const stockBadge =
      status?.status === 'out'          ? { label: 'Закончился',     cls: 'days-critical' } :
      status?.status === 'low-manual'   ? { label: 'Ниже порога',    cls: 'days-warn' } :
      status?.status === 'low-forecast' ? { label: 'Заканчивается',  cls: 'days-warn' } :
      null;
    const isSelected = selectedIds.has(p.id);
    return (
      <div className={`product-row ${cls} ${isSelected ? 'selected' : ''}`} onClick={() => openLog(p)}>
        <label
          className="product-select"
          onClick={e => e.stopPropagation()}
          title="Добавить в заказ"
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelected(p.id)}
          />
        </label>
        <div className="product-info">
          <div className="product-name">
            {p.name}
            {anomaly && (
              <span
                title={`Списание сегодня ${anomaly.todayWriteoff.toFixed(2)} ${anomaly.unit} — это ${anomaly.sigmas.toFixed(1)}σ от 14-дневной нормы ~${anomaly.mean.toFixed(2)} ${anomaly.unit}`}
                style={{
                  marginLeft: 6, padding: '2px 6px', borderRadius: 4,
                  fontSize: 11, fontWeight: 700,
                  background: anomaly.severity === 'critical' ? 'var(--danger)' : 'var(--warning)',
                  color: '#fff',
                }}
              >
                ⚠ {anomaly.severity === 'critical' ? 'аномалия' : 'много'}
              </span>
            )}
            {stockBadge && (
              <span
                className={`days-badge ${stockBadge.cls}`}
                title={explainStockStatus(status, p.unit)}
              >
                {stockBadge.label}
              </span>
            )}
            {/* Days-to-depletion badge: показываем только когда low-stock не сработал,
                чтобы не дублировать сигнал. */}
            {!stockBadge && days !== undefined && days <= 7 && (
              <span className={`days-badge ${daysCls}`}>
                {days === 0 ? 'кончается' : `~${days} дн.`}
              </span>
            )}
          </div>
          {last
            ? <div className="product-last">{p.category} · {fmtDate(last.createdAt)}</div>
            : <div className="product-last" style={{ color: 'var(--warning)' }}>{p.category} · Нет данных</div>
          }
        </div>
        <div className={`product-qty ${cls}`}>
          {last ? (
            <>
              <div className="qty-value">{last.resulting}</div>
              <div className="qty-unit">{p.unit}</div>
            </>
          ) : (
            <div className="qty-unit" style={{ fontSize: 20 }}>—</div>
          )}
        </div>
        <button
          style={{ background: 'none', border: 'none', color: 'var(--neutral)', fontSize: 18, padding: '0 0 0 8px', cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); setForm({ name: p.name, unit: p.unit, category: p.category, reorderPoint: p.reorderPoint ?? '' }); setEditModal(p); }}
        >
          ✎
        </button>
      </div>
    );
  }

  return (
    <>
      {anomalies.length > 0 && (
        <div style={{
          margin: '12px 16px 0',
          padding: 12,
          background: anomalies.some(a => a.severity === 'critical') ? '#fef2f2' : '#fffbeb',
          border: `1px solid ${anomalies.some(a => a.severity === 'critical') ? 'var(--danger)' : 'var(--warning)'}`,
          borderRadius: 8,
          fontSize: 13,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ⚠ {nplural(anomalies.length, ['Аномалия', 'Аномалии', 'Аномалий'])} списания сегодня: {anomalies.length}
          </div>
          <div style={{ color: 'var(--neutral)' }}>
            {anomalies.slice(0, 3).map(a =>
              `${a.productName} (${a.todayWriteoff.toFixed(1)} ${a.unit}, ${a.sigmas.toFixed(1)}σ)`
            ).join(' · ')}
            {anomalies.length > 3 && ` · …и ещё ${anomalies.length - 3}`}
          </div>
        </div>
      )}

      <div className="section-header" style={{ paddingRight: products.length > 6 ? 28 : 0 }}>
        <span className="section-title">Склад</span>
        <span className="section-count">{products.length} позиций</span>
      </div>

      {products.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📦</div>
          <p>Нет продуктов</p>
          <small>Добавьте первый продукт кнопкой ниже</small>
        </div>
      ) : (
        <div className="alpha-list">
          {recent.length > 0 && (
            <div className="recent-section">
              <div className="recent-label">⏱ Недавнее</div>
              <div className="product-list" style={{ marginBottom: 0 }}>
                {recent.map(p => <ProductRow key={`r-${p.id}`} p={p} />)}
              </div>
            </div>
          )}

          {letters.map(L => (
            <div
              key={L}
              className="alpha-section"
              ref={el => { if (el) sectionRefs.current[L] = el; }}
            >
              <div className="alpha-section-header">{L}</div>
              <div className="product-list" style={{ marginBottom: 0 }}>
                {grouped[L].map(p => <ProductRow key={p.id} p={p} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {products.length > 6 && (
        <AlphabetScroller availableLetters={letters} onJump={jumpTo} />
      )}

      {selectedIds.size === 0 && (
        <button className="fab" onClick={() => { setForm(EMPTY_PRODUCT); setAddModal(true); }}>+</button>
      )}

      {selectedIds.size > 0 && (
        <div className="stock-order-bar">
          <div className="stock-order-bar-info">
            <span className="stock-order-bar-count">
              Выбрано {selectedIds.size} {nplural(selectedIds.size, ['товар','товара','товаров'])}
            </span>
            <button className="stock-order-bar-clear" onClick={clearSelection}>
              Сбросить
            </button>
          </div>
          <button
            className="btn btn-primary stock-order-bar-cta"
            onClick={() => setOrderModal(true)}
          >
            Заказать →
          </button>
        </div>
      )}

      {orderModal && (
        <OrderFromStock
          products={products.filter(p => selectedIds.has(p.id))}
          records={records}
          statusByProduct={stockStatusMap}
          venueName={currentVenue?.name || ''}
          onClose={() => { setOrderModal(false); clearSelection(); }}
          onCreate={onCreate}
          showToast={showToast}
        />
      )}

      {logModal && (
        <Modal
          title={`${logModal.name}`}
          onClose={closeLog}
          onSave={saveOp}
          saving={saving}
          saveLabel="Сохранить"
        >
          <div className="stock-current">
            Сейчас на складе:&nbsp;
            <strong>{prevResulting === null ? '—' : `${prevResulting} ${logModal.unit}`}</strong>
          </div>

          <div className="mode-switch">
            {['receipt','writeoff','inventory'].map(m => (
              <button
                key={m}
                type="button"
                className={`mode-btn ${mode === m ? 'active' : ''} mode-${m}`}
                onClick={() => setMode(m)}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          <div className="form-group">
            <label>{MODE_VERB[mode]}</label>
            <div className="qty-input-row">
              <input
                type="number"
                step="0.1"
                min="0"
                inputMode="decimal"
                placeholder="0"
                value={qty}
                onChange={e => setQty(e.target.value)}
                className={qty !== '' && (isNaN(+qty) || +qty < 0) ? 'input-error' : ''}
                autoFocus
              />
              <span className="unit-label">{logModal.unit}</span>
            </div>
            {qty !== '' && isNaN(+qty) && <div className="field-hint error">Введите число</div>}
            {qty !== '' && !isNaN(+qty) && +qty < 0 && <div className="field-hint error">Не может быть отрицательным</div>}
          </div>

          {amountValid && nextResulting !== null && (
            <div className="op-preview">
              <span>Было <strong>{prevResulting === null ? '—' : `${prevResulting} ${logModal.unit}`}</strong></span>
              <span className="arrow">→</span>
              <span>Станет <strong>{nextResulting} {logModal.unit}</strong></span>
              {mode === 'inventory' && nextDelta !== null && nextDelta !== 0 && (
                <span className={`delta-badge ${nextDelta < 0 ? 'neg' : 'pos'}`}>
                  {nextDelta < 0 ? `недостача ${nextDelta}` : `излишек +${nextDelta}`}
                </span>
              )}
              {mode === 'receipt' && (
                <span className="delta-badge pos">+{nextDelta}</span>
              )}
              {mode === 'writeoff' && (
                <span className="delta-badge neg">{nextDelta}</span>
              )}
            </div>
          )}

          {willGoNegative && (
            <div className="field-hint warn">
              ⚠ Остаток уйдёт в минус ({nextResulting} {logModal.unit}). Сохранить можно, но проверь данные.
            </div>
          )}

          <div className="form-group">
            <label>Комментарий <span className="label-hint">(необязательно)</span></label>
            <input
              type="text"
              placeholder={mode === 'receipt' ? 'Поставщик, накладная…' : mode === 'writeoff' ? 'Причина…' : 'Заметка…'}
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={120}
            />
          </div>

          {productHistory.length > 0 && (
            <div className="history-block">
              <div className="history-label">История</div>
              <div className="history-list">
                {productHistory.slice(0, 10).map((e, idx) => {
                  const isLast = idx === 0;
                  const kindCls = e.kind === 'receipt' ? 'pos'
                                : e.kind === 'writeoff' ? 'neg'
                                : (e.delta && e.delta < 0) ? 'neg'
                                : (e.delta && e.delta > 0) ? 'pos'
                                : 'neutral';
                  let label = MODE_LABEL[e.kind] || 'Учёт';
                  if (e.kind === 'inventory' && e.delta !== null && e.delta !== 0) {
                    label += e.delta < 0 ? ` · недостача ${e.delta}` : ` · излишек +${e.delta}`;
                  } else if (e.kind === 'inventory' && (e.delta === null || e.delta === 0)) {
                    label += e.delta === null ? ' · начальный остаток' : ' · без изменений';
                  }
                  return (
                    <div key={e.id} className={`history-row ${kindCls}`}>
                      <div className="history-main">
                        <div className="history-kind">{label}</div>
                        <div className="history-meta">
                          {fmtDate(e.createdAt)}
                          {e.note ? <> · {e.note}</> : null}
                          {e.source && e.source !== 'manual' ? <> · {e.source}</> : null}
                        </div>
                      </div>
                      <div className="history-amount">
                        {(e.kind === 'receipt' || e.kind === 'writeoff') && e.delta !== null && (
                          <div className="history-delta">{e.delta > 0 ? `+${e.delta}` : e.delta}</div>
                        )}
                        <div className="history-resulting">= {e.resulting} {e.unit}</div>
                      </div>
                      {isLast && (
                        <button
                          className="history-del"
                          title="Отменить последнюю операцию"
                          onClick={() => deleteEntry(e)}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Modal>
      )}

      {(addModal || editModal) && (
        <Modal
          title={editModal ? `Редактировать: ${editModal.name}` : 'Новый продукт'}
          onClose={() => { setAddModal(false); setEditModal(null); setForm(EMPTY_PRODUCT); }}
          onSave={() => saveProduct(!!editModal)}
          saving={saving}
          saveLabel={editModal ? 'Сохранить' : 'Добавить'}
        >
          <div className="form-group">
            <label>Название</label>
            <input
              type="text"
              placeholder="Мука, Курица, Моцарелла…"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className={form.name !== '' && !form.name.trim() ? 'input-error' : ''}
              autoFocus
            />
            {!form.name.trim() && form.name !== '' && (
              <div className="field-hint error">Название не может быть пустым</div>
            )}
          </div>
          <div className="form-group">
            <label>Единица измерения</label>
            <select value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Категория</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>
              Порог заказа <span className="label-hint">(опц., {form.unit})</span>
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              inputMode="decimal"
              placeholder="Напр. 5 — сигнал «заканчивается» когда остаток ниже"
              value={form.reorderPoint}
              onChange={e => setForm({ ...form, reorderPoint: e.target.value })}
            />
            <div className="field-hint">
              Если оставить пустым — сигнал будет считаться по прогнозу продаж.
            </div>
          </div>
          {editModal && (
            <button className="btn btn-danger btn-block" style={{ marginTop: 8 }} onClick={() => deleteProduct(editModal)}>
              Удалить продукт
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
