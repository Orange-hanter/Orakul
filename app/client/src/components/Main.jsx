import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import StopTab   from './tabs/StopTab.jsx';
import StockTab  from './tabs/StockTab.jsx';
import MenuTab   from './tabs/MenuTab.jsx';
import DataTab   from './tabs/DataTab.jsx';

const TABS = [
  { id: 'stop',  label: 'Стопы',  icon: '🚫' },
  { id: 'stock', label: 'Склад',  icon: '📦' },
  { id: 'menu',  label: 'Меню',   icon: '📋' },
  { id: 'data',  label: 'Данные', icon: '📊' },
];

function Toast({ msg, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return <div className={`toast${type === 'error' ? ' error' : ''}`}>{msg}</div>;
}

export default function Main({ onLogout }) {
  const [tab,     setTab]     = useState('stop');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast,   setToast]   = useState(null);

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

  function showToast(msg, type = 'ok') {
    setToast({ msg, type, key: Date.now() });
  }

  async function handleCreate(data) {
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

  const ctx = { records, loading, onCreate: handleCreate, onUpdate: handleUpdate, onDelete: handleDelete, showToast };

  const activeStops = records.filter(r => r.type === 'stop' && r.active).length;
  const today = new Date().toLocaleDateString('ru', { day: 'numeric', month: 'long' });

  return (
    <>
      <header className="app-header">
        <div className="header-left">
          <h1>🧀 Моцарелла</h1>
          <span className="subtitle">{today}</span>
        </div>
        <button className="btn-logout" onClick={onLogout}>Выйти</button>
      </header>

      <div className="tab-content">
        {tab === 'stop'  && <StopTab  {...ctx} />}
        {tab === 'stock' && <StockTab {...ctx} />}
        {tab === 'menu'  && <MenuTab  {...ctx} />}
        {tab === 'data'  && <DataTab  {...ctx} onReload={load} />}
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

      {toast && (
        <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />
      )}
    </>
  );
}
