import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api.js';
import VenueSelector from './VenueSelector.jsx';
import OnboardingChecklist from './OnboardingChecklist.jsx';
import { isOnboardingDismissed, onboardingProgress } from '../utils/onboarding.js';
import StopTab      from './tabs/StopTab.jsx';
import StockTab     from './tabs/StockTab.jsx';
import MenuTab      from './tabs/MenuTab.jsx';
import SuppliersTab from './tabs/SuppliersTab.jsx';
import OrdersTab    from './tabs/OrdersTab.jsx';
import FinanceTab   from './tabs/FinanceTab.jsx';
import DataTab      from './tabs/DataTab.jsx';

const TABS = [
  { id: 'stop',      label: 'Стопы',       icon: '🚫' },
  { id: 'stock',     label: 'Склад',       icon: '📦' },
  { id: 'menu',      label: 'Меню',        icon: '📋' },
  { id: 'suppliers', label: 'Поставщики',  icon: '🏪' },
  { id: 'orders',    label: 'Заявки',      icon: '📝' },
  { id: 'finance',   label: 'Финансы',     icon: '📈' },
  { id: 'data',      label: 'Данные',      icon: '📊' },
];

// Записи, привязанные к точке. Должно совпадать с VENUE_SCOPED_TYPES в server.js
const VENUE_SCOPED_TYPES = new Set([
  'product',
  'stop',
  'stock_entry',
  'dish',
  'dish_sale',
  'order',
  'revenue_entry',
  'fixed_expense',
  'telegram_chat',
  'recommendation_action',
]);

const VENUE_STORAGE_KEY = 'orakul_venue_id';

function Toast({ msg, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return <div className={`toast${type === 'error' ? ' error' : ''}`}>{msg}</div>;
}

export default function Main({ onLogout }) {
  const [tab,           setTab]           = useState('stop');
  const [records,       setRecords]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [toast,         setToast]         = useState(null);
  const [venueId,       setVenueId]       = useState(() => localStorage.getItem(VENUE_STORAGE_KEY));
  const [venueSelector, setVenueSelector] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setRecords(await api.records.list());
    } catch {
      showToast('Ошибка загрузки', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Onboarding: показываем чек-лист один раз после первой загрузки данных,
  // если ≥1 шаг не закрыт И пользователь явно не нажимал «Не показывать».
  useEffect(() => {
    if (loading) return;
    if (isOnboardingDismissed()) return;
    const { done, total } = onboardingProgress(records);
    if (done < total) setOnboardingOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function showToast(msg, type = 'ok') {
    setToast({ msg, type, key: Date.now() });
  }

  // ── Venue resolution ─────────────────────────────────────────────────

  const venues = useMemo(
    () => records.filter(r => r.type === 'venue').sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [records]
  );

  // Если выбранная точка не найдена (удалена / другой инстанс) — fallback на default или первую
  const effectiveVenueId = useMemo(() => {
    if (venues.length === 0) return null;
    if (venueId && venues.some(v => v.id === venueId)) return venueId;
    return venues.find(v => v.isDefault)?.id || venues[0].id;
  }, [venues, venueId]);

  useEffect(() => {
    if (effectiveVenueId && effectiveVenueId !== venueId) {
      setVenueId(effectiveVenueId);
      localStorage.setItem(VENUE_STORAGE_KEY, effectiveVenueId);
    }
  }, [effectiveVenueId, venueId]);

  function pickVenue(id) {
    setVenueId(id);
    localStorage.setItem(VENUE_STORAGE_KEY, id);
  }

  // ── Filtered records (venue-scoped types only) ───────────────────────

  const filteredRecords = useMemo(() => {
    if (!effectiveVenueId) return records;
    return records.filter(r =>
      !VENUE_SCOPED_TYPES.has(r.type) || r.venueId === effectiveVenueId
    );
  }, [records, effectiveVenueId]);

  // ── CRUD with auto venueId injection ─────────────────────────────────

  async function handleCreate(data) {
    if (VENUE_SCOPED_TYPES.has(data.type) && !data.venueId && effectiveVenueId) {
      data = { ...data, venueId: effectiveVenueId };
    }
    const r = await api.records.create(data);
    setRecords(prev => [r, ...prev]);
    return r;
  }

  async function handleUpdate(id, data) {
    const r = await api.records.update(id, data);
    setRecords(prev => prev.map(x => x.id === id ? r : x));
    return r;
  }

  async function handleDelete(id) {
    await api.records.remove(id);
    setRecords(prev => prev.filter(x => x.id !== id));
  }

  const ctx = {
    records: filteredRecords,
    allRecords: records,           // для модулей, которым нужны данные всех точек (FinanceTab сравнение)
    venues,                        // список точек организации
    currentVenueId: effectiveVenueId,
    loading,
    onCreate: handleCreate,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
    showToast,
  };

  const activeStops = filteredRecords.filter(r => r.type === 'stop' && r.active).length;
  const currentVenue = venues.find(v => v.id === effectiveVenueId);

  return (
    <>
      <header className="app-header">
        <div className="header-left">
          <h1>🧀 Моцарелла</h1>
          {currentVenue && (
            <button className="venue-pill" onClick={() => setVenueSelector(true)}>
              📍 {currentVenue.name} ▾
            </button>
          )}
        </div>
        <button className="btn-logout" onClick={onLogout}>Выйти</button>
      </header>

      <div className="tab-content">
        {tab === 'stop'      && <StopTab      {...ctx} />}
        {tab === 'stock'     && <StockTab     {...ctx} />}
        {tab === 'menu'      && <MenuTab      {...ctx} />}
        {tab === 'suppliers' && <SuppliersTab {...ctx} />}
        {tab === 'orders'    && <OrdersTab    {...ctx} />}
        {tab === 'finance'   && <FinanceTab   {...ctx} />}
        {tab === 'data'      && <DataTab      {...ctx} onReload={load} />}
      </div>

      <nav className="tab-bar">
        {TABS.map(t => (
          <button key={t.id} className={`tab-item${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
            {t.id === 'stop' && activeStops > 0 && (
              <span className="tab-badge">{activeStops}</span>
            )}
          </button>
        ))}
      </nav>

      {venueSelector && (
        <VenueSelector
          venues={venues}
          currentVenueId={effectiveVenueId}
          onSelect={pickVenue}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onClose={() => setVenueSelector(false)}
          showToast={showToast}
        />
      )}

      {onboardingOpen && (
        <OnboardingChecklist
          records={filteredRecords}
          onClose={() => setOnboardingOpen(false)}
          onJumpToTab={(t) => { setTab(t); setOnboardingOpen(false); }}
        />
      )}

      {toast && (
        <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />
      )}
    </>
  );
}
