/*
 * Quick Resto — опциональный плагин интеграции.
 *
 * Что делает:
 *   • Импортирует закрытые чеки из Quick Resto как записи `revenue_entry`
 *     (с source='quickresto' и externalId для дедупликации).
 *   • Имеет два режима: 'mock' (генерит случайные чеки для демо) и 'live'
 *     (REST-вызовы к QR API — пока stub).
 *
 * Контракт плагина:
 *   exports.SETTINGS_TYPE — типа записи конфигурации (фильтруется из /api/records)
 *   exports.register(app, deps) — монтирует REST-эндпоинты в Express
 *   exports.maskedSettings(s) — возвращает settings без секретов (для GET)
 *
 * Деактивация: удалить запись типа SETTINGS_TYPE через DELETE-эндпоинт.
 * Полное удаление плагина: убрать require + register из server.js, удалить
 * директорию.
 */

const crypto = require('crypto');

const SETTINGS_TYPE = 'quickresto_settings';

function maskedSettings(s) {
  if (!s) return null;
  return {
    ...s,
    password: s.password ? '••••••' : '',
  };
}

function findSettings(store) {
  return store.records.find(r => r.type === SETTINGS_TYPE) || null;
}

function register(app, deps) {
  const { auth, loadStore, saveStore } = deps;

  // ── Статус и настройки ───────────────────────────────────────────────────

  app.get('/api/integrations/quickresto', auth, (_req, res) => {
    const store = loadStore();
    const s = findSettings(store);
    res.json({ configured: !!s, settings: maskedSettings(s) });
  });

  app.post('/api/integrations/quickresto/config', auth, (req, res) => {
    const {
      baseUrl  = '',
      username = '',
      password = '',
      venueId  = null,
      mode     = 'mock',
      active   = false,
    } = req.body || {};

    if (!['mock', 'live'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be mock or live' });
    }
    if (mode === 'live' && (!baseUrl.trim() || !username.trim())) {
      return res.status(400).json({ error: 'baseUrl и username обязательны для live-режима' });
    }

    const store = loadStore();
    const idx = store.records.findIndex(r => r.type === SETTINGS_TYPE);
    const prev = idx >= 0 ? store.records[idx] : null;
    const next = {
      id:              prev?.id ?? crypto.randomUUID(),
      type:            SETTINGS_TYPE,
      baseUrl:         baseUrl.trim(),
      username:        username.trim(),
      // Если пользователь не вводил пароль повторно — сохраняем старый
      password:        password || prev?.password || '',
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

  app.delete('/api/integrations/quickresto', auth, (_req, res) => {
    const store = loadStore();
    store.records = store.records.filter(r => r.type !== SETTINGS_TYPE);
    saveStore(store);
    res.json({ ok: true });
  });

  // ── Test connection ──────────────────────────────────────────────────────

  app.post('/api/integrations/quickresto/test', auth, async (_req, res) => {
    const store = loadStore();
    const s = findSettings(store);
    if (!s) return res.status(400).json({ error: 'Not configured' });

    if (s.mode === 'mock') {
      return res.json({ ok: true, message: 'Mock-режим. Соединение не требуется.' });
    }
    // Live mode: stub. Реальная проверка через POST {baseUrl}/.../auth — в R3.
    return res.status(501).json({ error: 'Live-режим в разработке. Используйте mock.' });
  });

  // ── Sync (импорт чеков) ──────────────────────────────────────────────────

  app.post('/api/integrations/quickresto/sync', auth, async (_req, res) => {
    const store = loadStore();
    const s = findSettings(store);
    if (!s) return res.status(400).json({ error: 'Not configured' });
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

// ── Sync implementations ─────────────────────────────────────────────────────

function mockSync(store, settings) {
  // Генерим 2–4 случайных чека для текущего дня
  const count = 2 + Math.floor(Math.random() * 3);
  const today = new Date().toISOString().slice(0, 10);
  const created = [];

  for (let i = 0; i < count; i++) {
    const amount = Math.round((8 + Math.random() * 35) * 100) / 100;
    const externalId = `qr-mock-${Date.now()}-${i}`;

    // Дедупликация по externalId (если уже есть — пропускаем)
    if (store.records.some(r => r.source === 'quickresto' && r.externalId === externalId)) continue;

    const record = {
      id:         crypto.randomUUID(),
      type:       'revenue_entry',
      venueId:    settings.venueId || null,
      date:       today,
      amount,
      currency:   'BYN',
      source:     'quickresto',
      externalId,
      note:       '🍽 Mock-чек Quick Resto',
      createdAt:  Date.now(),
      updatedAt:  Date.now(),
    };
    store.records.push(record);
    created.push({ externalId, amount });
  }

  return created;
}

async function liveSync(_store, _settings) {
  // TODO (R3): реальная интеграция через QR Back-Office API.
  // См. docs/08-technical/09-quickresto-integration-spec.md
  throw new Error('Live-режим QR пока не реализован. Используйте mock.');
}

module.exports = { register, SETTINGS_TYPE, maskedSettings };
