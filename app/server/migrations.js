/*
 * One-shot startup migrations. Each is idempotent.
 *
 * Important guard: if the store cannot be decrypted (wrong APP_PASSWORD,
 * corrupted file), loadStore() returns an empty record set with the
 * `_decryptFailed` flag — we MUST refuse to run, otherwise the migration
 * would write an empty store back under the wrong key. See store.js.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DATA } from './config.js';
import { loadStore, saveStore } from './store.js';
import scopedTypesList from '../shared/scopedTypes.json' with { type: 'json' };

export const VENUE_SCOPED_TYPES = new Set(scopedTypesList);

function refuseIfDecryptFailed(store) {
  if (store?._decryptFailed) {
    console.error('❌  Cannot run migrations — store.enc could not be decrypted. Refusing to start.');
    process.exit(1);
  }
}

// Legacy: stock_entry { quantity } → movement journal { kind, resulting, delta, ...}
function migrateStockEntries() {
  if (!fs.existsSync(DATA)) return;
  const store = loadStore();
  refuseIfDecryptFailed(store);
  let changed = false;
  for (const r of store.records) {
    if (r.type === 'stock_entry' && r.kind === undefined) {
      r.kind = 'inventory';
      r.resulting = r.quantity;
      r.delta = null;
      r.note = null;
      r.source = 'manual';
      r.externalId = null;
      delete r.quantity;
      changed = true;
    }
  }
  if (changed) {
    saveStore(store);
    console.log('✅  Migrated legacy stock_entry records to movement journal format');
  }
}

// Creates «Точка 1» on first boot and back-fills venueId for venue-scoped types.
function migrateMultiVenue() {
  const store = loadStore();
  refuseIfDecryptFailed(store);
  let changed = false;

  let defaultVenue = store.records.find(r => r.type === 'venue' && r.isDefault);
  if (!defaultVenue) {
    defaultVenue = {
      id:        crypto.randomUUID(),
      type:      'venue',
      name:      'Точка 1',
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.records.push(defaultVenue);
    changed = true;
  }

  for (const r of store.records) {
    if (VENUE_SCOPED_TYPES.has(r.type) && !r.venueId) {
      r.venueId = defaultVenue.id;
      changed = true;
    }
  }

  if (changed) {
    saveStore(store);
    console.log('✅  Multi-venue migration applied (default venue: «' + defaultVenue.name + '»)');
  }
}

export function runMigrations() {
  migrateStockEntries();
  migrateMultiVenue();
}
