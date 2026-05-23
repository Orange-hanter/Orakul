/*
 * Centralised runtime config + early-exit validation. Importing this module
 * is the «is the process correctly set up» gate — if env is broken, we
 * `process.exit(1)` here, not deep inside a request handler.
 */
import crypto from 'node:crypto';
import path   from 'node:path';
import fs     from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

export const PORT      = process.env.PORT || 3001;
export const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
export const IS_PROD   = process.env.NODE_ENV === 'production';
// DATA_DIR override lets a second instance (e.g. orakul-demo) share the same
// code tree but write its store.enc/audit.jsonl to a different directory.
// Default — co-located with the code, как было исторически.
export const DATA_DIR  = process.env.DATA_DIR || path.join(ROOT, 'data');
export const DATA      = path.join(DATA_DIR, 'store.enc');
export const BUILD     = path.join(ROOT, 'client', 'dist');
export { ROOT };

const _PASS = process.env.APP_PASSWORD;
if (!_PASS) {
  console.error('\n❌  APP_PASSWORD not set. Copy .env.example → .env and set a password.\n');
  process.exit(1);
}
if (_PASS.length < 12) {
  console.warn(`\n⚠️   APP_PASSWORD is only ${_PASS.length} chars — recommend ≥ 12 for at-rest encryption strength.\n`);
}
export const PASS = _PASS;

let _SECRET = process.env.JWT_SECRET;
if (!_SECRET) {
  if (IS_PROD) {
    console.error('\n❌  JWT_SECRET is required in production. Set a long random value in .env.\n');
    process.exit(1);
  }
  _SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️   JWT_SECRET not set — generated ephemeral secret (dev only; tokens will not survive restart).');
}
export const SECRET = _SECRET;

// CORS: prod expects same-origin via nginx; dev allows everything.
// CORS_ORIGIN env (comma-separated) overrides both.
export const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : (IS_PROD ? false : true);

// Pre-hash configured password for timing-safe equality at login.
export const PASS_HASH = crypto.createHash('sha256').update(PASS).digest();

fs.mkdirSync(DATA_DIR, { recursive: true });
