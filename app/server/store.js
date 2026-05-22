/*
 * Encrypted JSON store + async mutex.
 *
 * KNOWN HAZARD: loadStore() returns an empty record set on decrypt failure
 * instead of throwing. This is convenient for first-boot (no file yet) but
 * dangerous when combined with auto-running migrations: a wrong APP_PASSWORD
 * will silently wipe a real store on save. See app/server/migrations.js —
 * migrations now guard against this by skipping save when decrypt failed.
 *
 * TODO (P0): tighten loadStore to differentiate «no file» from «decrypt failed»
 * and bubble decrypt errors out; entrypoint should refuse to start.
 */
import fs from 'node:fs';
import { encrypt, decrypt } from '../crypto.js';
import { DATA, PASS } from './config.js';

export function loadStore() {
  if (!fs.existsSync(DATA)) return { version: 1, records: [] };
  try {
    return decrypt(fs.readFileSync(DATA, 'utf8'), PASS);
  } catch {
    console.error('⚠️  Failed to decrypt store. Wrong APP_PASSWORD or corrupted file.');
    return { version: 1, records: [], _decryptFailed: true };
  }
}

export function saveStore(data) {
  // Never save back data that came from a failed decrypt — that's how the
  // store gets clobbered with empty contents under a wrong password.
  if (data && data._decryptFailed) {
    throw new Error('refusing to save: source store could not be decrypted');
  }
  fs.writeFileSync(DATA, encrypt(data, PASS), 'utf8');
}

// Async mutex for load-modify-save sequences that span an await (live plugin
// sync, Telegram token validation). Synchronous handlers (POST /api/records)
// don't need this — Node.js single-threaded, the whole block is one tick.
let storeMutex = Promise.resolve();
export async function withStoreLock(fn) {
  const release = storeMutex;
  let unlock;
  storeMutex = new Promise(r => { unlock = r; });
  await release;
  try { return await fn(); }
  finally { unlock(); }
}
