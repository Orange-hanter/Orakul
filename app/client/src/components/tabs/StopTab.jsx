import { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import AlphabetScroller, { firstLetter, sortLetters } from '../AlphabetScroller.jsx';

function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1)  return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин назад`;
}

function StopCard({ stop, onResolve }) {
  return (
    <div className="stop-card">
      <div className="stop-name">{stop.dishName}</div>
      <div>
        <span className="badge badge-negative" style={{ fontSize: 11 }}>
          {stop.duration === 'shift' ? '⏱ До конца смены' : '📋 До ревизии'}
        </span>
      </div>
      {stop.reason && <div className="stop-age" style={{ fontSize: 13 }}>{stop.reason}</div>}
      <div className="stop-age">{timeAgo(stop.createdAt)}</div>
      <button className="btn-resolve" onClick={onResolve}>✓ Убрать стоп</button>
    </div>
  );
}

function AddStopModal({ dishes, allStops, onClose, onAdd }) {
  const [selected, setSelected] = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [reason,   setReason]   = useState('');

  const sectionRefs = useRef({});

  const grouped = useMemo(() => {
    const out = {};
    dishes.forEach(d => {
      const L = firstLetter(d.name);
      (out[L] ||= []).push(d);
    });
    return out;
  }, [dishes]);

  const letters = sortLetters(Object.keys(grouped));

  const recent = useMemo(() => {
    const freq = {};
    allStops.forEach(s => { freq[s.dishId] = (freq[s.dishId] || 0) + 1; });
    return dishes
      .filter(d => freq[d.id])
      .sort((a, b) => freq[b.id] - freq[a.id])
      .slice(0, 6);
  }, [dishes, allStops]);

  function jumpTo(letter) {
    sectionRefs.current[letter]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function submit(duration) {
    if (!selected.length) return;
    setSaving(true);
    try {
      await onAdd(selected.map(id => ({
        dishId:   id,
        dishName: dishes.find(d => d.id === id)?.name || id,
        duration,
        reason:   reason.trim(),
        active:   true,
      })));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function DishChip({ d }) {
    return (
      <button
        className={`dish-chip${selected.includes(d.id) ? ' selected' : ''}`}
        onClick={() => toggle(d.id)}
      >
        {d.name}
      </button>
    );
  }

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-header">
          <h2 className="modal-title">Добавить стоп</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ paddingRight: 32 }}>
          {dishes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--neutral)' }}>Нет активных блюд</div>
          ) : (
            <>
              {recent.length > 0 && (
                <div className="recent-section">
                  <div className="recent-label">🔁 Частые стопы</div>
                  <div className="dish-picker-grid" style={{ marginBottom: 0 }}>
                    {recent.map(d => <DishChip key={`r-${d.id}`} d={d} />)}
                  </div>
                </div>
              )}

              {letters.map(L => (
                <div
                  key={L}
                  className="alpha-section"
                  ref={el => { if (el) sectionRefs.current[L] = el; }}
                >
                  <div className="alpha-section-header" style={{ background: 'var(--surface)' }}>{L}</div>
                  <div className="dish-picker-grid">
                    {grouped[L].map(d => <DishChip key={d.id} d={d} />)}
                  </div>
                </div>
              ))}
            </>
          )}

          {selected.length > 0 && (
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Причина (необязательно)</label>
              <input
                type="text"
                placeholder="Нет заготовки, закончилось…"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </div>
          )}
        </div>

        {dishes.length > 6 && (
          <AlphabetScroller availableLetters={letters} onJump={jumpTo} inModal />
        )}

        <div className="modal-footer" style={{ flexDirection: 'column', gap: 8 }}>
          {selected.length > 0 && (
            <div style={{ fontSize: 13, color: 'var(--neutral)', textAlign: 'center' }}>
              Выбрано: {selected.length} блюд
            </div>
          )}
          <div className="duration-row">
            <button className="dur-btn" onClick={() => submit('shift')}    disabled={!selected.length || saving}>⏱ До конца смены</button>
            <button className="dur-btn" onClick={() => submit('revision')} disabled={!selected.length || saving}>📋 До ревизии</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function StopTab({ records, loading, onCreate, onUpdate, showToast }) {
  const [showAdd, setShowAdd] = useState(false);

  const dishes      = records.filter(r => r.type === 'dish' && r.active !== false);
  const activeStops = records.filter(r => r.type === 'stop' && r.active);
  const allStops    = records.filter(r => r.type === 'stop');
  const todayStart  = new Date(); todayStart.setHours(0, 0, 0, 0);
  const resolvedToday = records.filter(
    r => r.type === 'stop' && !r.active && r.resolvedAt >= todayStart.getTime()
  );

  async function handleAdd(stops) {
    try {
      for (const s of stops) await onCreate({ type: 'stop', ...s });
      showToast(`Добавлено стопов: ${stops.length}`);
    } catch (e) {
      showToast(e.message, 'error');
      throw e;
    }
  }

  async function handleResolve(stop) {
    try {
      await onUpdate(stop.id, { active: false, resolvedAt: Date.now() });
      showToast(`Убрали: ${stop.dishName}`);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  if (loading) return <div className="loading"><div className="spinner" /> Загрузка…</div>;

  return (
    <>
      {activeStops.length === 0 ? (
        <div className="all-clear">
          <div className="all-clear-icon">✅</div>
          <h3>Стопов нет</h3>
          <p>Всё меню доступно</p>
        </div>
      ) : (
        <>
          <div className="section-label">Активные стопы — {activeStops.length}</div>
          <div className="stop-grid">
            {activeStops.map(s => (
              <StopCard key={s.id} stop={s} onResolve={() => handleResolve(s)} />
            ))}
          </div>
        </>
      )}

      {dishes.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <p>Нет блюд в меню</p>
          <small>Сначала добавьте блюда во вкладке Меню</small>
        </div>
      ) : (
        <button className="btn-add-stop" onClick={() => setShowAdd(true)}>
          + Добавить стоп
        </button>
      )}

      {resolvedToday.length > 0 && (
        <>
          <div className="section-label">Убраны сегодня — {resolvedToday.length}</div>
          <div className="cards-grid">
            {resolvedToday.map(s => (
              <div key={s.id} className="card" style={{ opacity: 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{s.dishName}</span>
                  <span className="badge badge-done">Убран</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--neutral)', marginTop: 6 }}>
                  {timeAgo(s.resolvedAt)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showAdd && (
        <AddStopModal
          dishes={dishes}
          allStops={allStops}
          onClose={() => setShowAdd(false)}
          onAdd={handleAdd}
        />
      )}
    </>
  );
}
