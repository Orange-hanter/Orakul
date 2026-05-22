/*
 * Encrypted store export/import — the «backup file» feature for users.
 *
 * Export streams the existing on-disk encrypted blob untouched. Import
 * accepts a base64-encrypted blob, decrypts it with the SAME APP_PASSWORD
 * (no cross-password imports), validates structure, and overwrites the store.
 */
import fs from 'node:fs';
import express from 'express';
import { decrypt } from '../crypto.js';
import { DATA, PASS } from './config.js';
import { saveStore } from './store.js';
import { authMiddleware as auth } from './auth.js';

export function register(app) {
  app.get('/api/export', auth, (_req, res) => {
    if (!fs.existsSync(DATA)) return res.status(404).json({ error: 'No data' });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="orakul-pilot-${date}.enc"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(fs.readFileSync(DATA));
  });

  app.post('/api/import', auth, express.text({ type: '*/*', limit: '50mb' }), (req, res) => {
    try {
      const data = decrypt(req.body.trim(), PASS);
      if (!Array.isArray(data.records)) throw new Error('bad format');
      saveStore(data);
      res.json({ ok: true, count: data.records.length });
    } catch {
      res.status(400).json({ error: 'Cannot decrypt. Wrong password or corrupted file.' });
    }
  });
}
