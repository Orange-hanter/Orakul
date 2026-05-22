require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const { encrypt, decrypt } = require('./crypto');
const quickresto = require('./integrations/quickresto');
const iiko       = require('./integrations/iiko');

// Список типов записей с секретами/конфигом плагинов — не отдаём через /api/records
const PLUGIN_SETTINGS_TYPES = new Set([
  'telegram_settings',
  quickresto.SETTINGS_TYPE,
  iiko.SETTINGS_TYPE,
]);

const app  = express();
const PORT = process.env.PORT || 3001;
const PASS = process.env.APP_PASSWORD;
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const DATA  = path.join(__dirname, 'data', 'store.enc');
const BUILD = path.join(__dirname, 'client', 'dist');

if (!PASS) {
  console.error('\n❌  APP_PASSWORD not set. Copy .env.example → .env and set a password.\n');
  process.exit(1);
}

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// ── Store helpers ──────────────────────────────────────────────────────────────

function loadStore() {
  if (!fs.existsSync(DATA)) return { version: 1, records: [] };
  try {
    return decrypt(fs.readFileSync(DATA, 'utf8'), PASS);
  } catch {
    console.error('⚠️  Failed to decrypt store. Wrong APP_PASSWORD or corrupted file.');
    return { version: 1, records: [] };
  }
}

function saveStore(data) {
  fs.writeFileSync(DATA, encrypt(data, PASS), 'utf8');
}

// Async mutex для последовательности load-modify-save в обработчиках, где
// между этими шагами есть await (live-плагины, валидация токена в Telegram).
// В чисто синхронных handler-ах (POST /api/records и т.д.) гонок не бывает —
// Node.js однопоточный, и весь блок выполняется в одном tick'е event loop.
let storeMutex = Promise.resolve();
async function withStoreLock(fn) {
  const release = storeMutex;
  let unlock;
  storeMutex = new Promise(r => { unlock = r; });
  await release;
  try { return await fn(); }
  finally { unlock(); }
}

// ── O01 Audit log ─────────────────────────────────────────────────────────────
// Append-only NDJSON. Не зашифровано — это метаданные «кто/когда/что», а не сами
// данные (которые остаются в data/store.enc под AES-GCM). Цель: forensics
// «откуда взялась эта запись», «когда удалили блюдо», «кто менял цены».
//
// Ротация: при превышении AUDIT_MAX_BYTES (по умолчанию 5 MB) переименовываем
// файл в audit-<ts>.jsonl и стартуем новый. Старые лежат рядом для разбора.

const AUDIT_FILE = path.join(__dirname, 'data', 'audit.jsonl');
const AUDIT_MAX_BYTES = Number(process.env.AUDIT_MAX_BYTES) || 5 * 1024 * 1024;

function shortName(rec) {
  if (!rec) return '';
  if (rec.name) return rec.name;
  if (rec.productName) return rec.productName;
  if (rec.number) return rec.number;
  if (rec.itemName) return rec.itemName;
  return '';
}

function diffKeys(prev, next) {
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
    fs.renameSync(AUDIT_FILE, path.join(__dirname, 'data', `audit-${stamp}.jsonl`));
  } catch (e) {
    console.warn('audit: rotate failed:', e.message);
  }
}

function appendAudit(entry) {
  try {
    rotateAuditIfNeeded();
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.warn('audit: append failed:', e.message);
  }
}

function readAudit({ limit = 200, type = null, op = null } = {}) {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  // Грубо, без streaming — для пилота при < 5 MB ок. При выходе на > 1 клиента
  // переписать через readline.createInterface (см. O06 Postgres план).
  const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (type && e.recordType !== type) continue;
      if (op && e.op !== op) continue;
      out.push(e);
    } catch {}
  }
  return out;
}

// One-shot migration: legacy stock_entry { quantity } → { kind:'inventory', resulting, delta:null, source:'manual' }
function migrateStockEntries() {
  if (!fs.existsSync(DATA)) return;
  const store = loadStore();
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

migrateStockEntries();

// Multi-venue migration: создаёт «Точка 1» при первом запуске и проставляет
// venueId всем существующим venue-scoped записям. Идемпотентна.
const VENUE_SCOPED_TYPES = new Set([
  'product',
  'stop',
  'stock_entry',
  'dish',
  'dish_sale',
  'order',
  'revenue_entry',
  'fixed_expense',
  'telegram_chat',
  'recommendation_action',
]);

function migrateMultiVenue() {
  const store = loadStore();
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

migrateMultiVenue();

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10mb' }));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== PASS)
    return res.status(401).json({ error: 'Wrong password' });
  const token = jwt.sign({ ok: true }, SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// ── Records CRUD ───────────────────────────────────────────────────────────────

app.get('/api/records', auth, (_req, res) => {
  const store = loadStore();
  res.json(store.records.filter(r => !PLUGIN_SETTINGS_TYPES.has(r.type)).sort((a, b) => b.createdAt - a.createdAt));
});

function nextOrderNumber(store) {
  const year = new Date().getFullYear();
  const prefix = `ОРД-${year}-`;
  const used = store.records
    .filter(r => r.type === 'order' && typeof r.number === 'string' && r.number.startsWith(prefix))
    .map(r => parseInt(r.number.slice(prefix.length), 10))
    .filter(n => !Number.isNaN(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

app.post('/api/records', auth, (req, res) => {
  const store = loadStore();
  const record = { id: crypto.randomUUID(), ...req.body, createdAt: Date.now(), updatedAt: Date.now() };

  if (record.type === 'order' && !record.number) {
    record.number = nextOrderNumber(store);
  }

  // Safety net: если клиент не прислал venueId на venue-scoped запись —
  // подставляем default. Frontend обычно делает это сам, но seed-скрипты,
  // внешние интеграции и старые клиенты могут пропустить.
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

  // F04 + F06: после ответа клиенту проверяем алёрты на повышение цены.
  // Fire-and-forget — не блокируем PUT-handler.
  if (priceChange) {
    queuePriceAlerts(loadStore(), priceChange).catch(e => console.error('TG price alerts:', e.message));
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

// ── Export / Import ────────────────────────────────────────────────────────────

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

// ── Telegram ──────────────────────────────────────────────────────────────────

let tgOffset  = 0;
let tgActive  = false;
let tgTimer   = null;
let digestTimer = null;

function getTgToken() {
  try {
    if (fs.existsSync(DATA)) {
      const store = loadStore();
      const s = store.records.find(r => r.type === 'telegram_settings');
      if (s?.botToken) return s.botToken;
    }
  } catch {}
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

async function tgApi(method, body = {}) {
  const token = getTgToken();
  if (!token) throw new Error('Telegram token not configured');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// MarkdownV2 требует экранировать спецсимволы — иначе Telegram отбрасывает сообщение.
function escapeMd(s) {
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Если venueId передан — фильтруем продукты/движения только этой точки.
// Если null/undefined (вызов из старых мест) — агрегируем по всем (legacy fallback).
function buildDigestText(venueId = null) {
  const store = loadStore();
  let products     = store.records.filter(r => r.type === 'product');
  let stockEntries = store.records.filter(r => r.type === 'stock_entry');
  let venueName    = null;

  if (venueId) {
    products     = products.filter(p => p.venueId === venueId);
    stockEntries = stockEntries.filter(e => e.venueId === venueId);
    const v      = store.records.find(r => r.type === 'venue' && r.id === venueId);
    venueName    = v?.name || null;
  }

  const entryByProduct = new Map();
  stockEntries.forEach(e => {
    const cur = entryByProduct.get(e.productId);
    if (!cur || cur.createdAt < e.createdAt) entryByProduct.set(e.productId, e);
  });

  const cutoff = Date.now() - 14 * 86_400_000;
  const critical = [], warning = [];

  for (const p of products) {
    const last = entryByProduct.get(p.id);
    if (!last) continue;
    const current = last.resulting ?? 0;
    if (current <= 0) { critical.push({ p, days: 0, current }); continue; }
    const outflow = stockEntries
      .filter(e => e.productId === p.id && e.createdAt >= cutoff && e.delta !== null)
      .filter(e => e.kind === 'writeoff' || (e.kind === 'inventory' && e.delta < 0))
      .reduce((sum, e) => sum + Math.abs(e.delta), 0);
    if (outflow === 0) continue;
    const days = Math.round(current / (outflow / 14));
    if (days <= 1)      critical.push({ p, days, current });
    else if (days <= 3) warning.push({ p, days, current });
  }

  const dateStr = new Date().toLocaleDateString('ru', { day: 'numeric', month: 'long', weekday: 'long' });
  let msg = `🍕 *Склад — дайджест*\n📅 ${escapeMd(dateStr)}\n`;
  if (venueName) msg += `📍 ${escapeMd(venueName)}\n`;
  msg += '\n';

  if (critical.length === 0 && warning.length === 0) {
    return msg + '✅ Всё в норме, критичных позиций нет\\.';
  }
  if (critical.length > 0) {
    msg += '🔴 *Критично \\(меньше 2 дней\\):*\n';
    critical.forEach(({ p, days, current }) => {
      const dStr = days === 0 ? 'кончается' : `~${days} дн\\.`;
      msg += `• ${escapeMd(p.name)} — ${current} ${escapeMd(p.unit)} \\(${dStr}\\)\n`;
    });
    msg += '\n';
  }
  if (warning.length > 0) {
    msg += '⚠️ *Скоро закончится \\(2–3 дня\\):*\n';
    warning.forEach(({ p, days, current }) => {
      msg += `• ${escapeMd(p.name)} — ${current} ${escapeMd(p.unit)} \\(~${days} дн\\.\\)\n`;
    });
  }
  return msg;
}

// ── F04 + F06: алёрты при изменении цен поставщика ─────────────────────────

// Порог по росту цены: ≥ 5% или абсолютно ≥ 1 BYN — что меньше.
function isPriceJumpSignificant(oldPrice, newPrice) {
  if (newPrice <= oldPrice) return false;
  const pct = (newPrice - oldPrice) / oldPrice * 100;
  const abs = newPrice - oldPrice;
  return pct >= 5 || abs >= 1;
}

// Найти самую дешёвую цену для productId среди active поставщиков.
// При расчёте «новой» цены передаём skipItemId/replacementPrice — чтобы
// учесть только что обновлённый item с новой ценой ещё до сохранения store.
function cheapestPriceServer(store, productId, replacement) {
  const suppliers = new Map(
    store.records.filter(r => r.type === 'supplier').map(s => [s.id, s])
  );
  const items = store.records.filter(r => r.type === 'supplier_item' && r.productId === productId);
  const prices = items
    .filter(i => suppliers.get(i.supplierId)?.status !== 'paused')
    .map(i => i.id === replacement?.itemId ? replacement.price : Number(i.price))
    .filter(p => Number.isFinite(p) && p >= 0);
  return prices.length ? Math.min(...prices) : null;
}

// Себестоимость блюда по рецепту + текущим (или гипотетическим) ценам.
function dishCostServer(store, dish, replacement) {
  if (!dish || !Array.isArray(dish.ingredients) || dish.ingredients.length === 0) return null;
  let total = 0;
  for (const ing of dish.ingredients) {
    if (!ing.productId || !ing.quantity) continue;
    const p = cheapestPriceServer(store, ing.productId, replacement);
    if (p === null) return null; // не хватает данных
    total += ing.quantity * p;
  }
  return total;
}

async function queuePriceAlerts(store, change) {
  if (!getTgToken()) return;
  const { item, oldPrice, newPrice } = change;
  if (!isPriceJumpSignificant(oldPrice, newPrice)) return;

  const chats = store.records.filter(r => r.type === 'telegram_chat');
  if (chats.length === 0) return;

  const supplier = store.records.find(r => r.type === 'supplier' && r.id === item.supplierId);
  const supplierName = supplier?.name || 'поставщик';
  const pct = ((newPrice - oldPrice) / oldPrice * 100).toFixed(1).replace('.', '\\.');

  // F06 — raw price increase
  const rawMsg =
    `📈 *Цена выросла*\n` +
    `${escapeMd(item.itemName)} у ${escapeMd(supplierName)}\n` +
    `${oldPrice} → *${newPrice}* BYN \\(\\+${pct}%\\)`;

  // F04 — margin impact on dishes
  // Найти все блюда, использующие productId этого item-а.
  const affectedDishes = [];
  if (item.productId) {
    const dishes = store.records.filter(r => r.type === 'dish' && r.active !== false);
    for (const d of dishes) {
      if (!d.ingredients?.some(i => i.productId === item.productId)) continue;
      const sellPrice = Number(d.sellPrice);
      if (!Number.isFinite(sellPrice) || sellPrice <= 0) continue;

      const oldCost = dishCostServer(store, d, { itemId: item.id, price: oldPrice });
      const newCost = dishCostServer(store, d, { itemId: item.id, price: newPrice });
      if (oldCost === null || newCost === null) continue;
      const oldFC = oldCost / sellPrice * 100;
      const newFC = newCost / sellPrice * 100;
      const fcJump = newFC - oldFC;
      if (fcJump < 1.5) continue; // меньше 1.5 п.п. — игнорируем (шум)

      affectedDishes.push({ d, oldFC, newFC, fcJump });
    }
  }

  // Отправка
  const msgs = [rawMsg];
  if (affectedDishes.length > 0) {
    let m = `🍽 *Маржа упала на блюдах*\n` +
            `Из-за роста цены: ${escapeMd(item.itemName)}\n`;
    for (const a of affectedDishes.slice(0, 8)) {
      const fcOldS = a.oldFC.toFixed(1).replace('.', '\\.');
      const fcNewS = a.newFC.toFixed(1).replace('.', '\\.');
      m += `• ${escapeMd(a.d.name)}: FC ${fcOldS}% → *${fcNewS}%*\n`;
    }
    if (affectedDishes.length > 8) m += `…и ещё ${affectedDishes.length - 8}\n`;
    msgs.push(m.trimEnd());
  }

  for (const chat of chats) {
    for (const text of msgs) {
      try {
        await tgApi('sendMessage', { chat_id: chat.chatId, text, parse_mode: 'MarkdownV2' });
      } catch (e) {
        console.error(`TG: failed to send alert to ${chat.chatId}:`, e.message);
      }
    }
  }
}

// F05: P&L за вчера — отдельный блок утреннего дайджеста.
// Возвращает MarkdownV2-строку или null если за вчера нет revenue (нет смысла).
function buildPnLDigest(venueId) {
  if (!venueId) return null;
  const store = loadStore();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const dateStr = yest.toISOString().slice(0, 10);
  const dayStart = new Date(yest); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(yest); dayEnd.setHours(23, 59, 59, 999);

  const venueRecs = store.records.filter(r => r.venueId === venueId);
  const revenue = venueRecs
    .filter(r => r.type === 'revenue_entry' && r.date === dateStr)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  if (revenue <= 0) return null;

  const variableCosts = venueRecs
    .filter(r => r.type === 'order' && r.status === 'received')
    .filter(o => {
      const ts = o.receivedAt || o.updatedAt || o.createdAt;
      return ts >= dayStart.getTime() && ts <= dayEnd.getTime();
    })
    .reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);

  // Прората постоянных расходов на один день (месяц = 30 дней per spec 10).
  const fixedPerDay = venueRecs
    .filter(r => r.type === 'fixed_expense')
    .filter(e => !e.endDate || e.endDate >= dateStr)
    .filter(e => !e.startDate || e.startDate <= dateStr)
    .reduce((s, e) => s + (Number(e.amount) || 0) / 30, 0);

  const ebitda  = revenue - variableCosts - fixedPerDay;
  const fcPct   = variableCosts / revenue * 100;
  const ebitPct = ebitda / revenue * 100;
  const dateRu  = yest.toLocaleDateString('ru', { day: 'numeric', month: 'long' });

  let msg = `📊 *P&L за ${escapeMd(dateRu)}*\n`;
  msg += `💰 Выручка: *${Math.round(revenue)}* BYN\n`;
  msg += `🍳 Закупки: ${Math.round(variableCosts)} BYN \\(FC ${fcPct.toFixed(1).replace('.', '\\.')}%\\)\n`;
  msg += `🏠 Постоянные: ~${Math.round(fixedPerDay)} BYN\n`;
  const ebitdaIcon = ebitda > 0 ? '✅' : '🔴';
  msg += `${ebitdaIcon} EBITDA: *${Math.round(ebitda)}* BYN \\(${ebitPct.toFixed(1).replace('.', '\\.')}%\\)`;
  return msg;
}

// AI05 — server-side anomaly digest. Дублирует логику client/utils/anomaly.js
// (см. DL-2026-005: client ESM ↔ server CJS, не шарим напрямую).
// Считаем дневные writeoff по продукту за 14 дней + сравниваем с today.
function buildAnomalyDigest(venueId) {
  if (!venueId) return null;
  const store = loadStore();
  const products = store.records.filter(r => r.type === 'product' && r.venueId === venueId);
  const entries  = store.records.filter(r => r.type === 'stock_entry' && r.venueId === venueId);
  if (products.length === 0) return null;

  const DAY = 86_400_000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isoOf = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const todayIso = isoOf(today.getTime());
  const windowIsos = new Set();
  for (let i = 1; i <= 14; i++) windowIsos.add(isoOf(today.getTime() - i * DAY));

  const flagged = [];
  for (const p of products) {
    const daily = new Map();
    let todayWriteoff = 0;
    for (const e of entries) {
      if (e.productId !== p.id || e.kind !== 'writeoff' || e.delta == null) continue;
      const ts = e.createdAt || e.updatedAt || 0;
      if (!ts) continue;
      const iso = isoOf(ts);
      const out = Math.abs(Number(e.delta) || 0);
      if (out === 0) continue;
      if (iso === todayIso) todayWriteoff += out;
      else if (windowIsos.has(iso)) daily.set(iso, (daily.get(iso) || 0) + out);
    }
    if (todayWriteoff === 0) continue;
    const samples = [...daily.values()];
    if (samples.length < 7) continue;

    const mean = samples.reduce((a, c) => a + c, 0) / samples.length;
    const variance = samples.reduce((acc, x) => acc + (x - mean) ** 2, 0) /
                     Math.max(1, samples.length - 1);
    const stdDev = Math.sqrt(variance);
    const sigmas = stdDev === 0
      ? (mean > 0 ? todayWriteoff / mean : 0)
      : (todayWriteoff - mean) / stdDev;
    if (sigmas < 2) continue;

    flagged.push({
      name: p.name, unit: p.unit || 'шт',
      todayWriteoff, mean, sigmas,
      severity: sigmas >= 3 ? 'critical' : 'high',
    });
  }
  if (flagged.length === 0) return null;
  flagged.sort((a, b) => b.sigmas - a.sigmas);

  let msg = '⚠️ *Аномальное списание*\n';
  for (const a of flagged.slice(0, 6)) {
    const icon = a.severity === 'critical' ? '🔴' : '🟡';
    const today = a.todayWriteoff.toFixed(1).replace('.', '\\.');
    const mean  = a.mean.toFixed(1).replace('.', '\\.');
    const sig   = a.sigmas.toFixed(1).replace('.', '\\.');
    msg += `${icon} ${escapeMd(a.name)}: *${today}* ${escapeMd(a.unit)} \\(норма ~${mean}, ${sig}σ\\)\n`;
  }
  if (flagged.length > 6) msg += `…и ещё ${flagged.length - 6}\n`;
  return msg.trimEnd();
}

async function sendDigestToAll() {
  if (!getTgToken()) return;
  const store = loadStore();
  const chats = store.records.filter(r => r.type === 'telegram_chat');
  if (chats.length === 0) return;
  for (const chat of chats) {
    try {
      // Каждому чату — свой дайджест по его venueId (см. DL-2026-010).
      const stockMsg     = buildDigestText(chat.venueId);
      const anomalyMsg   = buildAnomalyDigest(chat.venueId);
      const pnlMsg       = buildPnLDigest(chat.venueId);
      const text = [stockMsg, anomalyMsg, pnlMsg].filter(Boolean).join('\n\n');
      await tgApi('sendMessage', { chat_id: chat.chatId, text, parse_mode: 'MarkdownV2' });
    } catch (e) {
      console.error(`TG: failed to send to ${chat.chatId}:`, e.message);
    }
  }
}

async function pollTelegram() {
  if (!tgActive) return;
  try {
    const { result } = await tgApi('getUpdates', { offset: tgOffset, timeout: 25 });
    for (const upd of result || []) {
      tgOffset = upd.update_id + 1;
      const msg = upd.message;
      if (!msg || !msg.text) continue;
      const text      = msg.text.split(' ')[0].toLowerCase();
      const chatId    = String(msg.chat.id);
      const chatTitle = msg.chat.title || msg.chat.first_name || chatId;

      if (text === '/start') {
        const store = loadStore();
        if (!store.records.find(r => r.type === 'telegram_chat' && r.chatId === chatId)) {
          // Привязываем чат к default-точке — пользователь сможет переназначить
          // через будущий /venue или редактирование записи.
          const defaultVenue =
            store.records.find(r => r.type === 'venue' && r.isDefault) ||
            store.records.find(r => r.type === 'venue');
          store.records.push({
            id: crypto.randomUUID(),
            type: 'telegram_chat',
            chatId,
            chatTitle,
            venueId: defaultVenue?.id || null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          saveStore(store);
          console.log(`TG: registered chat "${chatTitle}" (${chatId}) → venue ${defaultVenue?.name || '(none)'}`);
        }
        await tgApi('sendMessage', { chat_id: chatId, text: '✅ Чат подключён к Orakul\\! Дайджест — каждый день в 09:00\\.\n\n/digest — получить сейчас\n/stop — отключить', parse_mode: 'MarkdownV2' });
      }
      if (text === '/stop') {
        const store = loadStore();
        store.records = store.records.filter(r => !(r.type === 'telegram_chat' && r.chatId === chatId));
        saveStore(store);
        await tgApi('sendMessage', { chat_id: chatId, text: '🔕 Уведомления отключены.' });
      }
      if (text === '/digest' || text === '/status') {
        // Найдём венью чата (если зарегистрирован) — иначе дефолтный фильтр.
        const store = loadStore();
        const chatRec = store.records.find(r => r.type === 'telegram_chat' && r.chatId === chatId);
        await tgApi('sendMessage', {
          chat_id:    chatId,
          text:       buildDigestText(chatRec?.venueId || null),
          parse_mode: 'MarkdownV2',
        });
      }
    }
  } catch {
    // network error — retry
  }
  if (tgActive) tgTimer = setTimeout(pollTelegram, 2000);
}

function scheduleMorningDigest() {
  if (digestTimer) { clearTimeout(digestTimer); digestTimer = null; }
  const now  = new Date();
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  digestTimer = setTimeout(function tick() {
    sendDigestToAll();
    digestTimer = setTimeout(tick, 24 * 60 * 60 * 1000);
  }, next - now);
}

function startTelegram() {
  if (tgActive) return;
  tgActive = true;
  tgOffset = 0;
  pollTelegram();
  scheduleMorningDigest();
  console.log('✅  Telegram bot started');
}

function stopTelegram() {
  tgActive = false;
  if (tgTimer)   { clearTimeout(tgTimer);   tgTimer = null; }
  if (digestTimer) { clearTimeout(digestTimer); digestTimer = null; }
}

// ── Telegram config endpoints ──────────────────────────────────────────────────

app.get('/api/telegram/config', auth, (_req, res) => {
  res.json({ configured: !!getTgToken(), active: tgActive });
});

app.post('/api/telegram/config', auth, async (req, res) => {
  const { botToken } = req.body;
  if (!botToken?.trim()) return res.status(400).json({ error: 'botToken required' });
  if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken.trim()))
    return res.status(400).json({ error: 'Неверный формат токена' });

  // Validate token with Telegram
  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken.trim()}/getMe`);
    const data  = await tgRes.json();
    if (!data.ok) return res.status(400).json({ error: `Telegram не принял токен: ${data.description || 'invalid token'}` });
  } catch {
    return res.status(400).json({ error: 'Не удалось проверить токен — нет связи с Telegram' });
  }

  const store = loadStore();
  const idx = store.records.findIndex(r => r.type === 'telegram_settings');
  if (idx >= 0) {
    store.records[idx] = { ...store.records[idx], botToken: botToken.trim(), updatedAt: Date.now() };
  } else {
    store.records.push({ id: crypto.randomUUID(), type: 'telegram_settings', botToken: botToken.trim(), createdAt: Date.now(), updatedAt: Date.now() });
  }
  saveStore(store);
  stopTelegram();
  startTelegram();
  res.json({ ok: true });
});

app.delete('/api/telegram/config', auth, (_req, res) => {
  const store = loadStore();
  store.records = store.records.filter(r => r.type !== 'telegram_settings');
  saveStore(store);
  stopTelegram();
  res.json({ ok: true });
});

app.post('/api/telegram/test-digest', auth, async (_req, res) => {
  if (!getTgToken()) return res.status(400).json({ error: 'Telegram not configured' });
  try { await sendDigestToAll(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Auto-start if token is available at launch
if (getTgToken()) startTelegram();

// ── Plugins ────────────────────────────────────────────────────────────────────

quickresto.register(app, { auth, loadStore, saveStore, withStoreLock });
iiko.register(app,       { auth, loadStore, saveStore, withStoreLock });

// ── O05 Health check ───────────────────────────────────────────────────────────
// Публичный (без auth) — чтобы Uptimerobot / Healthchecks.io мог опрашивать.
// Возвращает 200 если: процесс жив, data-директория доступна, store.enc читается.
// Возвращает 503 при любой проблеме. Без секретов и без счётчиков записей.
const SERVER_STARTED_AT = Date.now();

app.get('/api/health', (_req, res) => {
  try {
    fs.accessSync(path.join(__dirname, 'data'), fs.constants.R_OK | fs.constants.W_OK);
    // Не вызываем loadStore() — он расшифровывает; делаем дешёвый stat-тест.
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

// ── Stats ──────────────────────────────────────────────────────────────────────

app.get('/api/stats', auth, (_req, res) => {
  const store = loadStore();
  const byType = store.records.reduce((acc, r) => {
    acc[r.type] = (acc[r.type] || 0) + 1;
    return acc;
  }, {});
  res.json({ total: store.records.length, byType });
});

// ── Static (production build) ──────────────────────────────────────────────────

if (fs.existsSync(BUILD)) {
  app.use(express.static(BUILD));
  app.get('*', (_req, res) => res.sendFile(path.join(BUILD, 'index.html')));
}

// По умолчанию слушаем только loopback — клиенты ходят через nginx (порт 80/443).
// Переопределить можно через BIND_HOST=0.0.0.0 (например, для Docker, где nginx —
// другой контейнер, а 3001 пробрасывается наружу docker-compose'ом).
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';

app.listen(PORT, BIND_HOST, () => {
  console.log(`\n✅  Orakul Pilot App → http://${BIND_HOST}:${PORT}\n`);
});
