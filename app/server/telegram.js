/*
 * Telegram: low-level API, digest builders, polling loop, morning scheduler,
 * and HTTP config endpoints.
 *
 * Server-side digests for stock/PnL stay local; anomaly digest now reuses the
 * client/utils/anomaly.js implementation via ESM (Phase 6) — no more drift
 * between two implementations of the same z-score.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DATA } from './config.js';
import { loadStore, saveStore } from './store.js';
import { authMiddleware as auth } from './auth.js';
import { detectAllAnomalies } from '../client/src/utils/anomaly.js';

// ── Token + low-level API ────────────────────────────────────────────────────

export function getTgToken() {
  try {
    if (fs.existsSync(DATA)) {
      const store = loadStore();
      const s = store.records.find(r => r.type === 'telegram_settings');
      if (s?.botToken) return s.botToken;
    }
  } catch {}
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

export async function tgApi(method, body = {}) {
  const token = getTgToken();
  if (!token) throw new Error('Telegram token not configured');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// MarkdownV2 requires escaping or Telegram drops the message silently.
export function escapeMd(s) {
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// ── Digest builders ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

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

  const cutoff = Date.now() - 14 * DAY_MS;
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

// AI05 — anomaly digest now built on top of the canonical client detector.
// One implementation, one set of tests.
function buildAnomalyDigest(venueId) {
  if (!venueId) return null;
  const store = loadStore();
  const venueRecords = store.records.filter(r => r.venueId === venueId);
  const flagged = detectAllAnomalies(venueRecords);
  if (flagged.length === 0) return null;

  let msg = '⚠️ *Аномальное списание*\n';
  for (const a of flagged.slice(0, 6)) {
    const icon = a.severity === 'critical' ? '🔴' : '🟡';
    const today = a.todayWriteoff.toFixed(1).replace('.', '\\.');
    const mean  = a.mean.toFixed(1).replace('.', '\\.');
    const sig   = a.sigmas.toFixed(1).replace('.', '\\.');
    msg += `${icon} ${escapeMd(a.productName)}: *${today}* ${escapeMd(a.unit)} \\(норма ~${mean}, ${sig}σ\\)\n`;
  }
  if (flagged.length > 6) msg += `…и ещё ${flagged.length - 6}\n`;
  return msg.trimEnd();
}

export async function sendDigestToAll() {
  if (!getTgToken()) return;
  const store = loadStore();
  const chats = store.records.filter(r => r.type === 'telegram_chat');
  if (chats.length === 0) return;
  for (const chat of chats) {
    try {
      const stockMsg   = buildDigestText(chat.venueId);
      const anomalyMsg = buildAnomalyDigest(chat.venueId);
      const pnlMsg     = buildPnLDigest(chat.venueId);
      const text = [stockMsg, anomalyMsg, pnlMsg].filter(Boolean).join('\n\n');
      await tgApi('sendMessage', { chat_id: chat.chatId, text, parse_mode: 'MarkdownV2' });
    } catch (e) {
      console.error(`TG: failed to send to ${chat.chatId}:`, e.message);
    }
  }
}

// ── Polling + morning scheduler ──────────────────────────────────────────────

let tgOffset    = 0;
let tgActive    = false;
let tgTimer     = null;
let digestTimer = null;

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
    // network error — retry on the next tick
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

export function startTelegram() {
  if (tgActive) return;
  tgActive = true;
  tgOffset = 0;
  pollTelegram();
  scheduleMorningDigest();
  console.log('✅  Telegram bot started');
}

export function stopTelegram() {
  tgActive = false;
  if (tgTimer)     { clearTimeout(tgTimer);     tgTimer = null; }
  if (digestTimer) { clearTimeout(digestTimer); digestTimer = null; }
}

export function isActive() { return tgActive; }

// ── HTTP config endpoints ────────────────────────────────────────────────────

export function register(app) {
  app.get('/api/telegram/config', auth, (_req, res) => {
    res.json({ configured: !!getTgToken(), active: tgActive });
  });

  app.post('/api/telegram/config', auth, async (req, res) => {
    const { botToken } = req.body;
    if (!botToken?.trim()) return res.status(400).json({ error: 'botToken required' });
    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken.trim()))
      return res.status(400).json({ error: 'Неверный формат токена' });

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
}
