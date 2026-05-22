/*
 * iiko — опциональный плагин интеграции с iiko POS.
 *
 * Контракт идентичен Quick Resto; отличается списком полей (API Key vs basic
 * auth) и характером мок-чеков (много мелких — пиццерия/фастфуд).
 *
 * Live-режим (iiko Cloud API /api/1/auth → /api/1/olap/...) — stub в R3.
 */

import crypto from 'node:crypto';
import { register as registerRouter, maskSettings } from './createIntegrationRouter.js';

export const SETTINGS_TYPE = 'iiko_settings';

const FIELDS = [
  { name: 'baseUrl', default: 'https://api-ru.iiko.services', required: false, secret: false },
  { name: 'apiKey',  default: '',                              required: true,  secret: true  },
];

function mockSync(store, settings) {
  // iiko-стиль: 5–8 мелких чеков
  const count = 5 + Math.floor(Math.random() * 4);
  const today = new Date().toISOString().slice(0, 10);
  const created = [];
  for (let i = 0; i < count; i++) {
    const amount = Math.round((4 + Math.random() * 18) * 100) / 100;
    const externalId = `iiko-mock-${Date.now()}-${i}`;
    if (store.records.some(r => r.source === 'iiko' && r.externalId === externalId)) continue;
    store.records.push({
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
    });
    created.push({ externalId, amount });
  }
  return created;
}

async function liveSync(_store, _settings) {
  // TODO (R3): /api/1/auth → /api/1/orders/by_table или /api/1/olap/v2/reports
  throw new Error('Live-режим iiko пока не реализован.');
}

export function register(app, deps) {
  registerRouter(app, deps, {
    id: 'iiko',
    settingsType: SETTINGS_TYPE,
    fields: FIELDS,
    mockSync,
    liveSync,
    liveTestNotReady: 'Live-режим в разработке. Используйте mock.',
  });
}

export const maskedSettings = s => maskSettings(s, FIELDS);
