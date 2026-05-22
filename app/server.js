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
  res.status(201).json(record);
});

app.put('/api/records/:id', auth, (req, res) => {
  const store = loadStore();
  const i = store.records.findIndex(r => r.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });

  const prev = store.records[i];
  const next = { ...prev, ...req.body, updatedAt: Date.now() };
  store.records[i] = next;

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
  }

  saveStore(store);
  res.json(next);
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
  res.json({ ok: true });
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

async function sendDigestToAll() {
  if (!getTgToken()) return;
  const store = loadStore();
  const chats = store.records.filter(r => r.type === 'telegram_chat');
  if (chats.length === 0) return;
  for (const chat of chats) {
    try {
      // Каждому чату — свой дайджест по его venueId (см. DL-2026-010).
      const text = buildDigestText(chat.venueId);
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
