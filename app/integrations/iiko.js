/*
 * iiko — опциональный плагин интеграции с iiko POS.
 *
 * Демонстрирует, что плагинный паттерн масштабируется:
 *   • Контракт идентичен Quick Resto (register, SETTINGS_TYPE, maskedSettings).
 *   • Отличается: API Key вместо basic auth, мок генерит несколько мелких
 *     чеков (характерно для пиццерий/фастфуда), брендовый icon.
 *
 * Live-режим (реальные вызовы iiko Cloud API /api/1/auth → /api/1/olap/...) —
 * stub в R3.
 */

const crypto = require('crypto');

const SETTINGS_TYPE = 'iiko_settings';

function maskedSettings(s) {
  if (!s) return null;
  return {
    ...s,
    apiKey: s.apiKey ? '••••••' : '',
  };
}

function findSettings(store) {
  return store.records.find(r => r.type === SETTINGS_TYPE) || null;
}

function register(app, deps) {
  const { auth, loadStore, saveStore } = deps;

  app.get('/api/integrations/iiko', auth, (_req, res) => {
    const store = loadStore();
    const s = findSettings(store);
    res.json({ configured: !!s, settings: maskedSettings(s) });
  });

  app.post('/api/integrations/iiko/config', auth, (req, res) => {
    const {
      baseUrl = 'https://api-ru.iiko.services',
      apiKey  = '',
      venueId = null,
      mode    = 'mock',
      active  = false,
    } = req.body || {};

    if (!['mock', 'live'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be mock or live' });
    }
    if (mode === 'live' && !apiKey.trim()) {
      return res.status(400).json({ error: 'apiKey обязателен для live-режима' });
    }

    const store = loadStore();
    const idx = store.records.findIndex(r => r.type === SETTINGS_TYPE);
    const prev = idx >= 0 ? store.records[idx] : null;
    const next = {
      id:              prev?.id ?? crypto.randomUUID(),
      type:            SETTINGS_TYPE,
      baseUrl:         baseUrl.trim(),
      // Если новый apiKey пустой — сохраняем старый
      apiKey:          apiKey || prev?.apiKey || '',
      venueId,
      mode,
      active:          !!active,
      lastSyncAt:      prev?.lastSyncAt      ?? null,
      lastSyncStatus:  prev?.lastSyncStatus  ?? null,
      lastSyncMessage: prev?.lastSyncMessage ?? null,
      createdAt:       prev?.createdAt ?? Date.now(),
      updatedAt:       Date.now(),
    };
    if (idx >= 0) store.records[idx] = next;
    else          store.records.push(next);
    saveStore(store);
    res.json({ ok: true, settings: maskedSettings(next) });
  });

  app.delete('/api/integrations/iiko', auth, (_req, res) => {
    const store = loadStore();
    store.records = store.records.filter(r => r.type !== SETTINGS_TYPE);
    saveStore(store);
    res.json({ ok: true });
  });

  app.post('/api/integrations/iiko/test', auth, (_req, res) => {
    const store = loadStore();
    const s = findSettings(store);
    if (!s) return res.status(400).json({ error: 'Not configured' });
    if (s.mode === 'mock') {
      return res.json({ ok: true, message: 'Mock-режим. Соединение не требуется.' });
    }
    return res.status(501).json({ error: 'Live-режим в разработке. Используйте mock.' });
  });

  app.post('/api/integrations/iiko/sync', auth, async (_req, res) => {
    const store = loadStore();
    const s = findSettings(store);
    if (!s)        return res.status(400).json({ error: 'Not configured' });
    if (!s.active) return res.status(400).json({ error: 'Integration paused (active=false)' });

    try {
      const created = s.mode === 'mock'
        ? mockSync(store, s)
        : await liveSync(store, s);
      s.lastSyncAt = Date.now();
      s.lastSyncStatus = 'ok';
      s.lastSyncMessage = `Импортировано чеков: ${created.length}`;
      s.updatedAt = Date.now();
      saveStore(store);
      res.json({
        ok:       true,
        imported: created.length,
        total:    created.reduce((a, b) => a + b.amount, 0),
        items:    created,
      });
    } catch (e) {
      s.lastSyncAt = Date.now();
      s.lastSyncStatus = 'error';
      s.lastSyncMessage = e.message;
      s.updatedAt = Date.now();
      saveStore(store);
      res.status(500).json({ error: e.message });
    }
  });
}

function mockSync(store, settings) {
  // iiko-стиль: много мелких чеков (характерно для кофейни/пиццерии)
  const count = 5 + Math.floor(Math.random() * 4); // 5–8 чеков
  const today = new Date().toISOString().slice(0, 10);
  const created = [];

  for (let i = 0; i < count; i++) {
    const amount = Math.round((4 + Math.random() * 18) * 100) / 100;
    const externalId = `iiko-mock-${Date.now()}-${i}`;
    if (store.records.some(r => r.source === 'iiko' && r.externalId === externalId)) continue;

    const record = {
      id:         crypto.randomUUID(),
      type:       'revenue_entry',
      venueId:    settings.venueId || null,
      date:       today,
      amount,
      currency:   'BYN',
      source:     'iiko',
      externalId,
      note:       '🍴 Mock-чек iiko',
      createdAt:  Date.now(),
      updatedAt:  Date.now(),
    };
    store.records.push(record);
    created.push({ externalId, amount });
  }

  return created;
}

async function liveSync(_store, _settings) {
  // TODO (R3): /api/1/auth → /api/1/orders/by_table или /api/1/olap/v2/reports
  throw new Error('Live-режим iiko пока не реализован.');
}

module.exports = { register, SETTINGS_TYPE, maskedSettings };
