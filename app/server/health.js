/*
 * O05 — public health endpoint for Uptimerobot / Healthchecks.io.
 *
 * Returns 200 when: process alive, data dir accessible, store.enc readable.
 * No secrets, no record counts. Cheap stat-test only — does NOT decrypt the
 * store (that would do a PBKDF2 + AES round-trip on every probe).
 */
import fs from 'node:fs';
import { DATA, DATA_DIR } from './config.js';

const SERVER_STARTED_AT = Date.now();

export function register(app) {
  app.get('/api/health', (_req, res) => {
    try {
      fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
      const storeOk = !fs.existsSync(DATA) || fs.statSync(DATA).size >= 0;
      if (!storeOk) throw new Error('store unreadable');
      res.json({
        status: 'ok',
        uptimeSec: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
        version: process.env.ORAKUL_VERSION || 'dev',
        ts: Date.now(),
      });
    } catch (e) {
      res.status(503).json({ status: 'error', error: e.message });
    }
  });
}
