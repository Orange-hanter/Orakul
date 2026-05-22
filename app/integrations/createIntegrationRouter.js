/*
 * Фабрика REST-эндпоинтов для интеграций (Quick Resto, iiko и т.д.).
 *
 * До рефакторинга quickresto.js и iiko.js повторяли один и тот же скелет:
 * GET status / POST config / DELETE / POST test / POST sync, плюс mock vs live,
 * lock на sync, поля настроек, маскирование секретов. Это ~95% boilerplate.
 *
 * Контракт спецификации:
 *   {
 *     id:           'quickresto',        // используется в URL: /api/integrations/<id>
 *     settingsType: 'quickresto_settings', // тип записи в store.records
 *     fields: [
 *       { name: 'baseUrl',  default: '', required: true,  secret: false },
 *       { name: 'username', default: '', required: true,  secret: false },
 *       { name: 'password', default: '', required: false, secret: true  },
 *     ],
 *     mockSync:     (store, settings) => Array<{externalId, amount}>,
 *     liveSync:     async (store, settings) => Array<{externalId, amount}>,
 *     liveTestNotReady: 'Live-режим в разработке. Используйте mock.',
 *   }
 */

import crypto from 'node:crypto';

export function maskSettings(s, fields) {
  if (!s) return null;
  const out = { ...s };
  for (const f of fields) {
    if (f.secret && out[f.name]) out[f.name] = '••••••';
  }
  return out;
}

function findSettings(store, settingsType) {
  return store.records.find(r => r.type === settingsType) || null;
}

export function register(app, deps, spec) {
  const { auth, loadStore, saveStore, withStoreLock } = deps;
  const lock = withStoreLock || (async fn => fn());
  const base = `/api/integrations/${spec.id}`;

  app.get(base, auth, (_req, res) => {
    const store = loadStore();
    const s = findSettings(store, spec.settingsType);
    res.json({ configured: !!s, settings: maskSettings(s, spec.fields) });
  });

  app.post(`${base}/config`, auth, (req, res) => {
    const body = req.body || {};
    const mode    = body.mode || 'mock';
    const active  = !!body.active;
    const venueId = body.venueId ?? null;

    if (!['mock', 'live'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be mock or live' });
    }
    if (mode === 'live') {
      for (const f of spec.fields) {
        if (!f.required) continue;
        const incoming = body[f.name];
        if (incoming && String(incoming).trim()) continue;
        if (f.secret) {
          const store = loadStore();
          const prev = findSettings(store, spec.settingsType);
          if (prev?.[f.name]) continue;
        }
        return res.status(400).json({ error: `${f.name} обязателен для live-режима` });
      }
    }

    const store = loadStore();
    const idx = store.records.findIndex(r => r.type === spec.settingsType);
    const prev = idx >= 0 ? store.records[idx] : null;

    const next = {
      id:              prev?.id ?? crypto.randomUUID(),
      type:            spec.settingsType,
      venueId,
      mode,
      active,
      lastSyncAt:      prev?.lastSyncAt      ?? null,
      lastSyncStatus:  prev?.lastSyncStatus  ?? null,
      lastSyncMessage: prev?.lastSyncMessage ?? null,
      createdAt:       prev?.createdAt ?? Date.now(),
      updatedAt:       Date.now(),
    };
    for (const f of spec.fields) {
      const raw = body[f.name];
      const trimmed = typeof raw === 'string' ? raw.trim() : raw;
      if (f.secret) {
        next[f.name] = trimmed || prev?.[f.name] || f.default || '';
      } else {
        next[f.name] = (trimmed !== undefined && trimmed !== null && trimmed !== '')
          ? trimmed
          : (prev?.[f.name] ?? f.default ?? '');
      }
    }

    if (idx >= 0) store.records[idx] = next;
    else          store.records.push(next);
    saveStore(store);
    res.json({ ok: true, settings: maskSettings(next, spec.fields) });
  });

  app.delete(base, auth, (_req, res) => {
    const store = loadStore();
    store.records = store.records.filter(r => r.type !== spec.settingsType);
    saveStore(store);
    res.json({ ok: true });
  });

  app.post(`${base}/test`, auth, async (_req, res) => {
    const store = loadStore();
    const s = findSettings(store, spec.settingsType);
    if (!s) return res.status(400).json({ error: 'Not configured' });
    if (s.mode === 'mock') {
      return res.json({ ok: true, message: 'Mock-режим. Соединение не требуется.' });
    }
    if (spec.liveTestNotReady) {
      return res.status(501).json({ error: spec.liveTestNotReady });
    }
    return res.json({ ok: true, message: 'OK' });
  });

  app.post(`${base}/sync`, auth, async (_req, res) => {
    let status, body;
    await lock(async () => {
      const store = loadStore();
      const s = findSettings(store, spec.settingsType);
      if (!s)        { status = 400; body = { error: 'Not configured' }; return; }
      if (!s.active) { status = 400; body = { error: 'Integration paused (active=false)' }; return; }
      try {
        const created = s.mode === 'mock'
          ? spec.mockSync(store, s)
          : await spec.liveSync(store, s);
        s.lastSyncAt = Date.now();
        s.lastSyncStatus = 'ok';
        s.lastSyncMessage = `Импортировано чеков: ${created.length}`;
        s.updatedAt = Date.now();
        saveStore(store);
        status = 200;
        body = {
          ok:       true,
          imported: created.length,
          total:    created.reduce((a, b) => a + b.amount, 0),
          items:    created,
        };
      } catch (e) {
        s.lastSyncAt = Date.now();
        s.lastSyncStatus = 'error';
        s.lastSyncMessage = e.message;
        s.updatedAt = Date.now();
        saveStore(store);
        status = 500; body = { error: e.message };
      }
    });
    res.status(status).json(body);
  });
}

export { findSettings };
