import { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import AlphabetScroller, { firstLetter, sortLetters } from './AlphabetScroller.jsx';

export default function IngredientPicker({ products, excludeIds = [], onAdd, onClose }) {
  const [selected, setSelected] = useState(null);
  const [qty,      setQty]      = useState('');

  const sectionRefs = useRef({});

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);

  const available = useMemo(
    () => products
      .filter(p => !exclude.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [products, exclude]
  );

  const grouped = useMemo(() => {
    const out = {};
    available.forEach(p => {
      const L = firstLetter(p.name);
      (out[L] ||= []).push(p);
    });
    return out;
  }, [available]);

  const letters = sortLetters(Object.keys(grouped));

  function jumpTo(letter) {
    sectionRefs.current[letter]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  const qtyNum = +qty;
  const qtyError = selected && qty !== '' && (isNaN(qtyNum) || qtyNum <= 0)
    ? 'Количество должно быть больше 0'
    : '';
  const canAdd = selected && qty !== '' && !qtyError;

  function add() {
    if (!canAdd) return;
    onAdd({ productId: selected.id, quantity: qtyNum });
    setSelected(null);
    setQty('');
  }

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-header">
          <h2 className="modal-title">Добавить ингредиент</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ paddingRight: available.length > 6 ? 32 : 20 }}>
          {excludeIds.length > 0 && (
            <div className="field-hint" style={{ marginBottom: 10 }}>
              В рецепте уже: {excludeIds.length} {excludeIds.length === 1 ? 'продукт' : 'продуктов'} (скрыты)
            </div>
          )}
          {available.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--neutral)' }}>
              Все продукты уже добавлены в рецепт
            </div>
          ) : (
            letters.map(L => (
              <div
                key={L}
                className="alpha-section"
                ref={el => { if (el) sectionRefs.current[L] = el; }}
              >
                <div className="alpha-section-header" style={{ background: 'var(--surface)' }}>{L}</div>
                {grouped[L].map(p => (
                  <div
                    key={p.id}
                    className={`picker-row${selected?.id === p.id ? ' selected' : ''}`}
                    onClick={() => setSelected(p)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="picker-name">{p.name}</div>
                      <div className="picker-meta">{p.category} · {p.unit}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {available.length > 6 && (
          <AlphabetScroller availableLetters={letters} onJump={jumpTo} inModal />
        )}

        {selected && (
          <div className="modal-footer" style={{ flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
            <div style={{ fontSize: 14, color: 'var(--neutral)' }}>
              Выбрано: <strong style={{ color: 'var(--primary)' }}>{selected.name}</strong>
            </div>
            <div className="qty-input-row">
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0"
                value={qty}
                onChange={e => setQty(e.target.value)}
                className={qtyError ? 'input-error' : ''}
                autoFocus
              />
              <span className="unit-label">{selected.unit}</span>
              <button
                className="btn btn-primary"
                style={{ flex: 'none', width: 140 }}
                onClick={add}
                disabled={!canAdd}
              >
                Добавить
              </button>
            </div>
            <div className={`field-hint${qtyError ? ' error' : ''}`}>
              {qtyError || (qty === '' ? 'Введите количество на одну порцию' : ` `)}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
