/*
 * Records CRUD + audit read endpoint.
 *
 * Plugin settings records (telegram + integrations) are filtered out of
 * GET /api/records — they hold secrets/config that should only be reachable
 * via their typed endpoints (with proper masking).
 */
import crypto from 'node:crypto';
import { loadStore, saveStore } from './store.js';
import { authMiddleware as auth } from './auth.js';
import { appendAudit, readAudit, shortName, diffKeys } from './audit.js';
import { VENUE_SCOPED_TYPES } from './migrations.js';
import { queuePriceAlerts } from './alerts.js';

function nextOrderNumber(store) {
  const year = new Date().getFullYear();
  const prefix = `ОРД-${year}-`;
  let maxN = 0;
  for (const r of store.records) {
    if (r.type !== 'order' || typeof r.number !== 'string' || !r.number.startsWith(prefix)) continue;
    const n = parseInt(r.number.slice(prefix.length), 10);
    if (!Number.isNaN(n) && n > maxN) maxN = n;
  }
  return `${prefix}${String(maxN + 1).padStart(4, '0')}`;
}

export function register(app, { pluginSettingsTypes }) {
  // Query params (all optional, AND-combined):
  //   ?type=product             — single type
  //   ?types=product,dish       — multiple types
  //   ?venueId=<uuid>           — filter to one venue
  // Without filters: full non-plugin record set (legacy default).
  app.get('/api/records', auth, (req, res) => {
    const store = loadStore();
    const typeParam = req.query.type;
    const typesParam = req.query.types;
    const venueId = req.query.venueId || null;

    const typeFilter = typeParam
      ? new Set([typeParam])
      : (typesParam ? new Set(String(typesParam).split(',').map(s => s.trim()).filter(Boolean)) : null);

    let out = store.records.filter(r => !pluginSettingsTypes.has(r.type));
    if (typeFilter) out = out.filter(r => typeFilter.has(r.type));
    if (venueId)    out = out.filter(r => !r.venueId || r.venueId === venueId);

    res.json(out.sort((a, b) => b.createdAt - a.createdAt));
  });

  app.post('/api/records', auth, (req, res) => {
    const store = loadStore();
    const record = { id: crypto.randomUUID(), ...req.body, createdAt: Date.now(), updatedAt: Date.now() };

    if (record.type === 'order' && !record.number) {
      record.number = nextOrderNumber(store);
    }

    // Safety net: backfill venueId from default venue if client/seed omitted it.
    if (VENUE_SCOPED_TYPES.has(record.type) && !record.venueId) {
      const fallbackVenue =
        store.records.find(r => r.type === 'venue' && r.isDefault) ||
        store.records.find(r => r.type === 'venue');
      if (fallbackVenue) record.venueId = fallbackVenue.id;
    }

    store.records.push(record);

    if (record.type === 'supplier_item' && typeof record.price === 'number') {
      store.records.push({
        id: crypto.randomUUID(),
        type: 'supplier_price_history',
        itemId: record.id,
        price: record.price,
        prevPrice: null,
        source: 'manual',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    saveStore(store);
    appendAudit({
      ts: Date.now(),
      op: 'create',
      recordId: record.id,
      recordType: record.type,
      by: 'auth',
      name: shortName(record),
      venueId: record.venueId || null,
    });
    res.status(201).json(record);
  });

  app.put('/api/records/:id', auth, (req, res) => {
    const store = loadStore();
    const i = store.records.findIndex(r => r.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Not found' });

    const prev = store.records[i];
    const next = { ...prev, ...req.body, updatedAt: Date.now() };
    store.records[i] = next;

    let priceChange = null;
    if (prev.type === 'supplier_item' &&
        typeof next.price === 'number' &&
        prev.price !== next.price) {
      store.records.push({
        id: crypto.randomUUID(),
        type: 'supplier_price_history',
        itemId: prev.id,
        price: next.price,
        prevPrice: prev.price ?? null,
        source: 'manual',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      priceChange = { item: next, oldPrice: prev.price, newPrice: next.price };
    }

    saveStore(store);
    appendAudit({
      ts: Date.now(),
      op: 'update',
      recordId: next.id,
      recordType: next.type,
      by: 'auth',
      name: shortName(next),
      venueId: next.venueId || null,
      changed: diffKeys(prev, next),
    });
    res.json(next);

    // F04 + F06: fire-and-forget price-jump alerts after responding.
    if (priceChange) {
      queuePriceAlerts(store, priceChange).catch(e => console.error('TG price alerts:', e.message));
    }
  });

  app.delete('/api/records/:id', auth, (req, res) => {
    const store = loadStore();
    const target = store.records.find(r => r.id === req.params.id);
    if (!target) return res.json({ ok: true });

    if (target.type === 'supplier') {
      const itemIds = store.records
        .filter(r => r.type === 'supplier_item' && r.supplierId === target.id)
        .map(r => r.id);
      store.records = store.records.filter(r =>
        r.id !== target.id &&
        !(r.type === 'supplier_item' && r.supplierId === target.id) &&
        !(r.type === 'supplier_price_history' && itemIds.includes(r.itemId))
      );
    } else if (target.type === 'supplier_item') {
      store.records = store.records.filter(r =>
        r.id !== target.id &&
        !(r.type === 'supplier_price_history' && r.itemId === target.id)
      );
    } else {
      store.records = store.records.filter(r => r.id !== req.params.id);
    }

    saveStore(store);
    appendAudit({
      ts: Date.now(),
      op: 'delete',
      recordId: target.id,
      recordType: target.type,
      by: 'auth',
      name: shortName(target),
      venueId: target.venueId || null,
    });
    res.json({ ok: true });
  });

  app.get('/api/audit', auth, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const type  = req.query.type || null;
    const op    = req.query.op   || null;
    res.json(readAudit({ limit, type, op }));
  });

  app.get('/api/stats', auth, (_req, res) => {
    const store = loadStore();
    const byType = store.records.reduce((acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + 1;
      return acc;
    }, {});
    res.json({ total: store.records.length, byType });
  });
}
