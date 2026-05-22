/*
 * PluginShell — общая обёртка модалки настроек плагина.
 *
 * Решает задачу дублирования между плагинами (QR, iiko и т.д.). Плагин
 * предоставляет декларативный набор полей credentials; шелл сам отвечает
 * за state machine, валидацию, рендер, кнопки и индикаторы.
 *
 * Контракт plugin api (передаётся через prop `api`):
 *   {
 *     getStatus():  () => Promise<{ configured, settings }>
 *     saveConfig:   (data) => Promise<{ settings }>
 *     remove:       () => Promise<{ ok }>
 *     test:         () => Promise<{ ok, message }>
 *     sync:         () => Promise<{ ok, imported, total, items? }>
 *   }
 *
 * Контракт credentialFields:
 *   [{
 *     name:                  string  — имя поля в API saveConfig
 *     label:                 string  — подпись в UI
 *     type:                  'text' | 'password' | 'url'
 *     required:              bool    — обязательно в live-режиме
 *     hasSecretPlaceholder:  bool    — показывать "(сохранён)" placeholder
 *                                       и не отправлять пустую строку
 *     defaultValue:          string  — дефолт при первом открытии
 *   }]
 */

import { useState, useEffect } from 'react';
import Modal from '../components/Modal.jsx';

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ru', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function CredentialField({ field, value, onChange, settings }) {
  const placeholder = field.hasSecretPlaceholder && settings?.[field.name]
    ? '(сохранён — оставьте пустым)'
    : field.placeholder || '';

  return (
    <div className="form-group">
      <label>{field.label}</label>
      <input
        type={field.type === 'password' ? 'password' : 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={field.type === 'password' ? 'new-password' : 'off'}
      />
    </div>
  );
}

export default function PluginShell({
  manifest,
  api,
  venues = [],
  onClose,
  showToast,
  credentialFields = [],
  defaultMode = 'mock',
}) {
  const [loading,    setLoading]    = useState(true);
  const [settings,   setSettings]   = useState(null);
  const [mode,       setMode]       = useState(defaultMode);
  const [venueId,    setVenueId]    = useState(venues[0]?.id || '');
  const [active,     setActive]     = useState(false);
  const [fields,     setFields]     = useState(() =>
    Object.fromEntries(credentialFields.map(f => [f.name, f.defaultValue || '']))
  );
  const [saving,     setSaving]     = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [testing,    setTesting]    = useState(false);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    api.getStatus()
      .then(({ configured, settings: s }) => {
        if (configured && s) {
          setSettings(s);
          setMode(s.mode || defaultMode);
          setVenueId(s.venueId || venues[0]?.id || '');
          setActive(!!s.active);
          // Гидратируем НЕ-секретные поля. Секретные (hasSecretPlaceholder)
          // никогда не приходят с сервера в открытом виде.
          setFields(prev => {
            const next = { ...prev };
            for (const f of credentialFields) {
              if (!f.hasSecretPlaceholder && s[f.name]) next[f.name] = s[f.name];
            }
            return next;
          });
        }
      })
      .catch(() => showToast(`Не удалось загрузить настройки ${manifest.name}`, 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validateLive() {
    for (const f of credentialFields) {
      if (!f.required) continue;
      const has = fields[f.name] || (f.hasSecretPlaceholder && settings?.[f.name]);
      if (!has) return `Поле «${f.label}» обязательно для live-режима`;
    }
    return null;
  }

  async function save() {
    if (!venueId) return showToast('Выберите точку', 'error');
    if (mode === 'live') {
      const err = validateLive();
      if (err) return showToast(err, 'error');
    }
    setSaving(true);
    try {
      const { settings: next } = await api.saveConfig({ ...fields, venueId, mode, active });
      setSettings(next);
      // Очищаем секретные поля после сохранения
      setFields(prev => {
        const cleared = { ...prev };
        for (const f of credentialFields) {
          if (f.hasSecretPlaceholder) cleared[f.name] = '';
        }
        return cleared;
      });
      showToast('Настройки сохранены');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Отключить плагин и удалить настройки?')) return;
    try {
      await api.remove();
      setSettings(null);
      setActive(false);
      setFields(prev => Object.fromEntries(Object.keys(prev).map(k => [k, ''])));
      showToast('Плагин отключён');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function test() {
    setTesting(true);
    try {
      const r = await api.test();
      showToast(r.message || 'OK');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setTesting(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setLastResult(null);
    try {
      const r = await api.sync();
      setLastResult(r);
      const total = r.total?.toFixed(2) || '0';
      showToast(`Импортировано ${r.imported} чеков (${total} BYN)`);
      const { settings: next } = await api.getStatus();
      setSettings(next);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <Modal title={`${manifest.icon} ${manifest.name}`} onClose={onClose}>
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--neutral)' }}>Загрузка…</div>
      </Modal>
    );
  }

  return (
    <Modal title={`${manifest.icon} ${manifest.name}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 16 }}>
        {manifest.description}
      </div>

      {settings && (
        <div style={{
          padding: 12,
          background: settings.active ? '#dcfce7' : '#f1f5f9',
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 16,
        }}>
          {settings.active ? '🟢 Активен' : '⏸ Приостановлен'}
          {settings.lastSyncAt && (
            <div style={{ fontSize: 12, color: 'var(--neutral)', marginTop: 4 }}>
              Последняя синхронизация: {fmtDate(settings.lastSyncAt)} ·{' '}
              {settings.lastSyncStatus === 'ok' ? '✓' : '⚠'} {settings.lastSyncMessage || ''}
            </div>
          )}
        </div>
      )}

      <div className="form-group">
        <label>Режим</label>
        <select value={mode} onChange={e => setMode(e.target.value)}>
          <option value="mock">Mock (демо — случайные чеки)</option>
          <option value="live">Live (реальный API)</option>
        </select>
      </div>

      {mode === 'live' && credentialFields.map(field => (
        <CredentialField
          key={field.name}
          field={field}
          value={fields[field.name]}
          onChange={v => setFields(prev => ({ ...prev, [field.name]: v }))}
          settings={settings}
        />
      ))}

      <div className="form-group">
        <label>Точка-получатель</label>
        <select value={venueId} onChange={e => setVenueId(e.target.value)}>
          {venues.length === 0 && <option value="">— Нет точек —</option>}
          {venues.map(v => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 16, padding: 10, background: '#f8fafc', borderRadius: 8,
      }}>
        <input
          type="checkbox"
          id={`${manifest.id}-active`}
          checked={active}
          onChange={e => setActive(e.target.checked)}
          style={{ width: 20, height: 20, marginRight: 4 }}
        />
        <label htmlFor={`${manifest.id}-active`} style={{ flex: 1, fontSize: 14, margin: 0 }}>
          Плагин активен (синхронизация разрешена)
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>
          {saving ? '...' : 'Сохранить'}
        </button>
        {settings && <button className="btn btn-ghost" style={{ flex: 1 }} onClick={remove}>Удалить</button>}
      </div>

      {settings?.active && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={test} disabled={testing}>
            {testing ? '...' : 'Проверить связь'}
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={sync} disabled={syncing}>
            {syncing ? '...' : '↻ Синхронизация'}
          </button>
        </div>
      )}

      {lastResult && (
        <div style={{ marginTop: 12, padding: 12, background: '#eff6ff', borderRadius: 8, fontSize: 12 }}>
          Импортировано <strong>{lastResult.imported}</strong> чеков на{' '}
          <strong>{lastResult.total?.toFixed(2)} BYN</strong>.
          {lastResult.items?.length > 0 && lastResult.items.length <= 8 && (
            <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
              {lastResult.items.map(it => (
                <li key={it.externalId} style={{ color: 'var(--neutral)' }}>
                  {it.externalId}: {it.amount.toFixed(2)} BYN
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
