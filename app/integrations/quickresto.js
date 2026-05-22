/*
 * Quick Resto — опциональный плагин интеграции.
 *
 * Импортирует закрытые чеки из Quick Resto как записи `revenue_entry`
 * (source='quickresto', externalId для дедупликации). Два режима: 'mock'
 * (демо-чеки) и 'live' (REST API — stub до R3).
 *
 * Скелет REST-эндпоинтов общий со всеми интеграциями — см.
 * createIntegrationRouter.js. Здесь только спецификация и реализация sync.
 */

import crypto from 'node:crypto';
import { register as registerRouter, maskSettings } from './createIntegrationRouter.js';

export const SETTINGS_TYPE = 'quickresto_settings';

const FIELDS = [
  { name: 'baseUrl',  default: '', required: true,  secret: false },
  { name: 'username', default: '', required: true,  secret: false },
  { name: 'password', default: '', required: false, secret: true  },
];

function mockSync(store, settings) {
  // 2–4 случайных чека для текущего дня
  const count = 2 + Math.floor(Math.random() * 3);
  const today = new Date().toISOString().slice(0, 10);
  const created = [];
  for (let i = 0; i < count; i++) {
    const amount = Math.round((8 + Math.random() * 35) * 100) / 100;
    const externalId = `qr-mock-${Date.now()}-${i}`;
    if (store.records.some(r => r.source === 'quickresto' && r.externalId === externalId)) continue;
    store.records.push({
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
    });
    created.push({ externalId, amount });
  }
  return created;
}

async function liveSync(_store, _settings) {
  // TODO (R3): реальная интеграция через QR Back-Office API.
  // См. docs/08-technical/09-quickresto-integration-spec.md
  throw new Error('Live-режим QR пока не реализован. Используйте mock.');
}

export function register(app, deps) {
  registerRouter(app, deps, {
    id: 'quickresto',
    settingsType: SETTINGS_TYPE,
    fields: FIELDS,
    mockSync,
    liveSync,
    liveTestNotReady: 'Live-режим в разработке. Используйте mock.',
  });
}

export const maskedSettings = s => maskSettings(s, FIELDS);
