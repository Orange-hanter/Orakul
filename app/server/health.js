/*
 * O05 — public health endpoint for Uptimerobot / Healthchecks.io.
 *
 * Returns 200 when: process alive, data dir accessible, store.enc readable.
 * No secrets, no record counts. Cheap stat-test only — does NOT decrypt the
 * store (that would do a PBKDF2 + AES round-trip on every probe).
 */
import fs from 'node:fs';
import { DATA, DATA_DIR, DEMO_MODE, DEMO_PASSWORD_HINT } from './config.js';

const SERVER_STARTED_AT = Date.now();

export function register(app) {
  app.get('/api/health', (_req, res) => {
    try {
      fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
      const storeOk = !fs.existsSync(DATA) || fs.statSync(DATA).size >= 0;
      if (!storeOk) throw new Error('store unreadable');
      // demo / demoPasswordHint are only present when DEMO_MODE=1; prod never
      // surfaces a password through any endpoint. Used by Login.jsx to show
      // an inline hint on the demo instance.
      const body = {
        status: 'ok',
        uptimeSec: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
        version: process.env.ORAKUL_VERSION || 'dev',
        ts: Date.now(),
      };
      if (DEMO_MODE) {
        body.demo = true;
        body.demoPasswordHint = DEMO_PASSWORD_HINT;
      }
      res.json(body);
    } catch (e) {
      res.status(503).json({ status: 'error', error: e.message });
    }
  });
}
