import 'dotenv/config';
import fs      from 'node:fs';
import path    from 'node:path';
import express from 'express';
import cors    from 'cors';

import { PORT, BIND_HOST, CORS_ORIGIN, BUILD } from './server/config.js';
import { runMigrations }                       from './server/migrations.js';
import * as auth                               from './server/auth.js';
import * as records                            from './server/records.js';
import * as exportImport                       from './server/exportImport.js';
import * as health                             from './server/health.js';
import * as telegram                           from './server/telegram.js';
import { loadStore, saveStore, withStoreLock } from './server/store.js';
import * as quickresto                         from './integrations/quickresto.js';
import * as iiko                               from './integrations/iiko.js';

runMigrations();

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));

// Plugin settings types are excluded from /api/records — they hold secrets
// and have typed endpoints that mask them.
const pluginSettingsTypes = new Set([
  'telegram_settings',
  quickresto.SETTINGS_TYPE,
  iiko.SETTINGS_TYPE,
]);

auth.register(app);
records.register(app, { pluginSettingsTypes });
exportImport.register(app);
telegram.register(app);
health.register(app);

quickresto.register(app, { auth: auth.authMiddleware, loadStore, saveStore, withStoreLock });
iiko.register(app,       { auth: auth.authMiddleware, loadStore, saveStore, withStoreLock });

// Auto-start Telegram polling if a token is already configured.
if (telegram.getTgToken()) telegram.startTelegram();

// Static (production build) — must come AFTER all API routes.
if (fs.existsSync(BUILD)) {
  app.use(express.static(BUILD));
  app.get('*', (_req, res) => res.sendFile(path.join(BUILD, 'index.html')));
}

// Default to loopback — clients reach us via nginx (80/443).
// Override with BIND_HOST=0.0.0.0 (e.g. inside docker-compose).
app.listen(PORT, BIND_HOST, () => {
  console.log(`\n✅  Orakul Pilot App → http://${BIND_HOST}:${PORT}\n`);
});
