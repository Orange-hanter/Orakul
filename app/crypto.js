import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const SALT_LEN = 32;
const ITERATIONS = 100_000;

// PBKDF2 dominates request latency (~50 ms per call at 100k iters). The salt
// changes on every encrypt, but the same salt is re-read every decrypt — so
// cache derivations keyed by salt. Bounded to last 16 distinct salts to avoid
// unbounded growth from external encrypted-file imports.
const keyCache = new Map();
const KEY_CACHE_MAX = 16;
function deriveKey(password, salt) {
  const key = `${password.length}|${salt.toString('base64')}`;
  const hit = keyCache.get(key);
  if (hit) return hit;
  const derived = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, 'sha256');
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.delete(keyCache.keys().next().value);
  keyCache.set(key, derived);
  return derived;
}

export function encrypt(data, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Layout: salt(32) | iv(12) | tag(16) | ciphertext
  return Buffer.concat([salt, iv, tag, enc]).toString('base64');
}

export function decrypt(b64, password) {
  const buf = Buffer.from(b64, 'base64');
  const salt = buf.subarray(0, SALT_LEN);
  const iv   = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag  = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const enc  = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key  = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}
