/*
 * O01 — append-only NDJSON audit log.
 *
 * NOT encrypted on disk: this is metadata («who / when / what»), not the data
 * itself (which lives in store.enc under AES-GCM). Goal — forensics: «where
 * did this record come from», «when was the dish deleted», «who changed
 * prices».
 *
 * Rotation: when AUDIT_MAX_BYTES (default 5 MB) is exceeded we rename to
 * audit-<ts>.jsonl and start fresh. Old files stay next to it.
 */
import fs   from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');
const AUDIT_MAX_BYTES = Number(process.env.AUDIT_MAX_BYTES) || 5 * 1024 * 1024;

export function shortName(rec) {
  if (!rec) return '';
  if (rec.name)        return rec.name;
  if (rec.productName) return rec.productName;
  if (rec.number)      return rec.number;
  if (rec.itemName)    return rec.itemName;
  return '';
}

export function diffKeys(prev, next) {
  if (!prev || !next) return [];
  const changed = [];
  for (const k of Object.keys(next)) {
    if (k === 'updatedAt') continue;
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) changed.push(k);
  }
  return changed;
}

function rotateAuditIfNeeded() {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return;
    const size = fs.statSync(AUDIT_FILE).size;
    if (size < AUDIT_MAX_BYTES) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(AUDIT_FILE, path.join(DATA_DIR, `audit-${stamp}.jsonl`));
  } catch (e) {
    console.warn('audit: rotate failed:', e.message);
  }
}

export function appendAudit(entry) {
  try {
    rotateAuditIfNeeded();
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.warn('audit: append failed:', e.message);
  }
}

export function readAudit({ limit = 200, type = null, op = null } = {}) {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  // Naive whole-file read — at < 5 MB rotation cap this is fine for the pilot.
  // When we go > 1 client / Postgres (O06), switch to readline streaming.
  const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (type && e.recordType !== type) continue;
      if (op   && e.op         !== op)   continue;
      out.push(e);
    } catch {}
  }
  return out;
}
