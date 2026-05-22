import { useState, useMemo, useRef } from 'react';
import Modal from '../Modal.jsx';
import IngredientPicker from '../IngredientPicker.jsx';
import AlphabetScroller, { firstLetter, sortLetters } from '../AlphabetScroller.jsx';
import { computeDishEconomics } from '../../utils/dishCost.js';
import { foodCostColor } from '../../utils/pnl.js';
import { nplural } from '../../utils/plural.js';
import { toIsoDate, salesInPeriod } from '../../utils/dishSales.js';
import DishSalesModal from '../DishSalesModal.jsx';

function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${Number(n).toFixed(2)}`;
}

const CATEGORIES = ['Закуски', 'Салаты', 'Супы', 'Паста', 'Пицца', 'Основные блюда', 'Гарниры', 'Десерты', 'Напитки', 'Прочее'];
const EMPTY = { name: '', category: 'Прочее', active: true, sellPrice: '', ingredients: [] };

export default function MenuTab({ records, loading, onCreate, onUpdate, onDelete, showToast }) {
  const [modal,        setModal]        = useState(null);
  const [form,         setForm]         = useState(EMPTY);
  const [saving,       setSaving]       = useState(false);
  const [showPicker,   setShowPicker]   = useState(false);
  const [salesOpen,    setSalesOpen]    = useState(false);

  const sectionRefs = useRef({});

  const dishes = useMemo(
    () => records.filter(r => r.type === 'dish').sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [records]
  );

  const products = useMemo(() => records.filter(r => r.type === 'product'), [records]);
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const activeStops = useMemo(
    () => new Set(records.filter(r => r.type === 'stop' && r.active).map(r => r.dishId)),
    [records]
  );

  // Себестоимость/маржа per dish — считаются из рецепта + текущих цен поставщиков.
  // Поставщики НЕ venue-scoped, поэтому видны во всех точках.
  const suppliers     = useMemo(() => records.filter(r => r.type === 'supplier'),      [records]);
  const supplierItems = useMemo(() => records.filter(r => r.type === 'supplier_item'), [records]);
  const economicsByDish = useMemo(() => {
    const m = new Map();
    dishes.forEach(d => m.set(d.id, computeDishEconomics(d, supplierItems, suppliers)));
    return m;
  }, [dishes, supplierItems, suppliers]);

  // Продажи блюд — для бейджа «сегодня продано N»
  const sales = useMemo(() => records.filter(r => r.type === 'dish_sale'), [records]);
  const today = toIsoDate(new Date());
  const todaySalesByDish = useMemo(() => {
    const m = new Map();
    dishes.forEach(d => m.set(d.id, salesInPeriod(sales, d.id, today, today)));
    return m;
  }, [sales, dishes, today]);
  const todayTotal = [...todaySalesByDish.values()].reduce((a, b) => a + b, 0);

  const grouped = useMemo(() => {
    const out = {};
    dishes.forEach(d => {
      const L = firstLetter(d.name);
      (out[L] ||= []).push(d);
    });
    return out;
  }, [dishes]);

  const letters = sortLetters(Object.keys(grouped));

  function jumpTo(letter) {
    sectionRefs.current[letter]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function openAdd()   { setForm(EMPTY);  setModal('add'); }
  function openEdit(d) {
    setForm({
      name: d.name,
      category: d.category,
      active: d.active,
      sellPrice: d.sellPrice ?? '',
      ingredients: d.ingredients || [],
    });
    setModal(d);
  }
  function close()     { setModal(null); setShowPicker(false); }

  function validate() {
    if (!form.name.trim()) return 'Введите название блюда';
    const bad = (form.ingredients || []).filter(i => !i.quantity || isNaN(i.quantity) || i.quantity <= 0);
    if (bad.length) {
      const names = bad.map(i => productById.get(i.productId)?.name || '?').slice(0, 2).join(', ');
      return `Количество должно быть > 0: ${names}${bad.length > 2 ? ` и ещё ${bad.length - 2}` : ''}`;
    }
    return null;
  }

  async function save() {
    const err = validate();
    if (err) {
      showToast(err, 'error');
      return;
    }
    setSaving(true);
    try {
      // Нормализуем sellPrice: пустая строка → null; число → Number
      const sellPriceNum = form.sellPrice === '' || form.sellPrice === null
        ? null
        : Number(form.sellPrice);
      const payload = {
        ...form,
        sellPrice: Number.isFinite(sellPriceNum) && sellPriceNum > 0 ? sellPriceNum : null,
      };
      if (modal === 'add') {
        await onCreate({ type: 'dish', ...payload });
        showToast('Блюдо добавлено');
      } else {
        await onUpdate(modal.id, payload);
        showToast('Блюдо обновлено');
      }
      close();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(d) {
    try {
      await onUpdate(d.id, { active: !d.active });
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function deleteDish(d) {
    if (!confirm(`Удалить «${d.name}»?`)) return;
    try {
      await onDelete(d.id);
      showToast('Удалено');
      close();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  if (loading) return <div className="loading"><div className="spinner" /> Загрузка…</div>;

  function DishRow({ d }) {
    const isStopped = activeStops.has(d.id);
    const hasRecipe = (d.ingredients || []).length > 0;
    const econ = economicsByDish.get(d.id);
    const fcColor = econ?.foodCostPct !== null ? foodCostColor(econ?.foodCostPct) : null;
    const hasMissing = econ?.missing?.length > 0;
    const soldToday = todaySalesByDish.get(d.id) || 0;
    return (
      <div className={`dish-row${isStopped ? ' stopped' : ''}`} onClick={() => openEdit(d)}>
        <div className="dish-row-name" style={{ color: d.active ? 'inherit' : 'var(--neutral)', textDecoration: d.active ? 'none' : 'line-through' }}>
          {d.name}
          <div style={{ fontSize: 12, color: 'var(--neutral)', fontWeight: 400, marginTop: 2, textDecoration: 'none' }}>{d.category}</div>
        </div>
        <div className="dish-row-badges">
          {hasRecipe && <span className="badge badge-kpi" style={{ fontSize: 11 }} title={`${d.ingredients.length} ингредиентов`}>🧬 {d.ingredients.length}</span>}
          {econ?.cost !== null && econ?.foodCostPct !== null && (
            <span className="badge" style={{ fontSize: 11, background: '#f1f5f9', color: fcColor || '#475569' }}
                  title={`Себест. ${fmtMoney(econ.cost)} BYN · Цена ${fmtMoney(econ.sellPrice)} BYN · Маржа ${fmtMoney(econ.margin)} BYN`}>
              💰 FC {econ.foodCostPct.toFixed(0)}%
            </span>
          )}
          {econ?.cost !== null && econ?.foodCostPct === null && (
            <span className="badge badge-neutral" style={{ fontSize: 11 }} title={`Себест. ${fmtMoney(econ.cost)} BYN/порция`}>
              💰 {fmtMoney(econ.cost)}
            </span>
          )}
          {hasMissing && (
            <span className="badge badge-pending" style={{ fontSize: 11 }} title={`Нет активного поставщика на ${econ.missing.length} ингр.`}>
              ⚠ {econ.missing.length}
            </span>
          )}
          {soldToday > 0 && (
            <span className="badge badge-in_progress" style={{ fontSize: 11 }} title={`Сегодня продано: ${soldToday} порц.`}>
              🍽 {soldToday}
            </span>
          )}
          {isStopped && <span className="badge badge-negative" style={{ fontSize: 11 }}>🚫 Стоп</span>}
          {!d.active && <span className="badge badge-neutral" style={{ fontSize: 11 }}>Off</span>}
        </div>
        <label className="toggle" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={!!d.active} onChange={() => toggleActive(d)} />
          <span className="toggle-slider" />
        </label>
      </div>
    );
  }

  return (
    <>
      <div className="section-header" style={{ paddingRight: dishes.length > 6 ? 28 : 0 }}>
        <span className="section-title">Меню</span>
        <span className="section-count">{nplural(dishes.length, ['блюдо', 'блюда', 'блюд'])}</span>
      </div>

      {dishes.length > 0 && (
        <button
          className="btn btn-ghost btn-block"
          style={{ marginBottom: 12, height: 44, fontSize: 14 }}
          onClick={() => setSalesOpen(true)}
        >
          📋 Продажи дня
          {todayTotal > 0 && <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 700 }}>· {todayTotal} порц.</span>}
        </button>
      )}

      {dishes.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <p>Меню пустое</p>
          <small>Добавьте первое блюдо кнопкой ниже</small>
        </div>
      ) : (
        <div className="alpha-list">
          {letters.map(L => (
            <div
              key={L}
              className="alpha-section"
              ref={el => { if (el) sectionRefs.current[L] = el; }}
            >
              <div className="alpha-section-header">{L}</div>
              {grouped[L].map(d => <DishRow key={d.id} d={d} />)}
            </div>
          ))}
        </div>
      )}

      {dishes.length > 6 && (
        <AlphabetScroller availableLetters={letters} onJump={jumpTo} />
      )}

      <button className="fab" onClick={openAdd}>+</button>

      {modal && (
        <Modal
          title={modal === 'add' ? 'Новое блюдо' : `Редактировать: ${modal.name}`}
          onClose={close}
          onSave={save}
          saving={saving}
          saveLabel={modal === 'add' ? 'Добавить' : 'Сохранить'}
        >
          <div className="form-group">
            <label>Название блюда</label>
            <input
              type="text"
              placeholder="Например: Пицца Маргарита"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className={form.name !== '' && !form.name.trim() ? 'input-error' : ''}
              autoFocus
            />
            {!form.name.trim() && form.name !== '' && (
              <div className="field-hint error">Название не может быть пустым</div>
            )}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Категория</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Цена продажи (BYN)</label>
              <input
                type="number"
                step="0.10"
                min="0"
                inputMode="decimal"
                placeholder="напр. 18.50"
                value={form.sellPrice ?? ''}
                onChange={e => setForm({ ...form, sellPrice: e.target.value })}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Активно в меню</label>
            <div className="segment segment-2">
              <button type="button" className={`seg-btn${form.active ? ' active-done' : ''}`} onClick={() => setForm({ ...form, active: true })}>✓ Да</button>
              <button type="button" className={`seg-btn${!form.active ? ' active-cancelled' : ''}`} onClick={() => setForm({ ...form, active: false })}>✕ Нет</button>
            </div>
          </div>

          <div className="form-group">
            <label>
              Рецепт <span style={{ fontWeight: 400, color: 'var(--neutral)', textTransform: 'none', letterSpacing: 0 }}>· опционально</span>
            </label>
            {form.ingredients.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--neutral)', padding: '6px 0 10px' }}>
                Ингредиенты не указаны
              </div>
            ) : (
              <>
                {(() => {
                  const badCount = form.ingredients.filter(i => !i.quantity || isNaN(i.quantity) || i.quantity <= 0).length;
                  return badCount > 0 ? (
                    <div className="section-hint">⚠ Проверьте количество: {badCount} {badCount === 1 ? 'ингредиент' : 'ингредиентов'}</div>
                  ) : null;
                })()}
                <div className="recipe-list">
                  {form.ingredients.map((ing, i) => {
                    const p = productById.get(ing.productId);
                    const invalid = !ing.quantity || isNaN(ing.quantity) || ing.quantity <= 0;
                    return (
                      <div key={ing.productId} className="recipe-row">
                        <div className="recipe-name">{p?.name || '(удалён)'}</div>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={ing.quantity}
                          className={invalid ? 'input-error' : ''}
                          onChange={e => {
                            const next = [...form.ingredients];
                            const v = e.target.value;
                            next[i] = { ...next[i], quantity: v === '' ? '' : +v };
                            setForm({ ...form, ingredients: next });
                          }}
                        />
                        <span className="recipe-unit">{p?.unit || ''}</span>
                        <button
                          type="button"
                          className="recipe-remove"
                          onClick={() => setForm({
                            ...form,
                            ingredients: form.ingredients.filter((_, j) => j !== i),
                          })}
                        >✕</button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ marginTop: 8, height: 44 }}
              onClick={() => setShowPicker(true)}
              disabled={products.length === 0}
            >
              + Добавить ингредиент
            </button>
            {products.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--neutral)', marginTop: 6 }}>
                Сначала добавьте продукты во вкладке Склад
              </div>
            )}
          </div>

          {modal !== 'add' && (
            <button className="btn btn-danger btn-block" style={{ marginTop: 8 }} onClick={() => deleteDish(modal)}>
              Удалить блюдо
            </button>
          )}
        </Modal>
      )}

      {showPicker && (
        <IngredientPicker
          products={products}
          excludeIds={form.ingredients.map(i => i.productId)}
          onAdd={ing => setForm(f => ({ ...f, ingredients: [...(f.ingredients || []), ing] }))}
          onClose={() => setShowPicker(false)}
        />
      )}

      {salesOpen && (
        <DishSalesModal
          dishes={dishes}
          sales={sales}
          onClose={() => setSalesOpen(false)}
          onCreate={onCreate}
          onUpdate={onUpdate}
          showToast={showToast}
        />
      )}
    </>
  );
}
