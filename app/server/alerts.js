/*
 * F04 + F06 — price-jump Telegram alerts when a supplier_item.price increases.
 *
 * Called fire-and-forget from records PUT handler (we don't block the API
 * response on Telegram). Threshold: ≥ 5% OR ≥ 1 BYN (whichever fires first).
 *
 * Phase 6: dish cost calculation now reuses client/utils/dishCost.js
 * (cheapestPriceForProduct + computeDishCost) via ESM — single implementation,
 * single set of tests. The «replacement» trick (hypothetical new price for an
 * item-being-edited) is layered on by overlaying the candidate item before
 * passing to computeDishCost.
 */
import { tgApi, escapeMd, getTgToken } from './telegram.js';
import { computeDishCost } from '../shared/dishCost.js';

function isPriceJumpSignificant(oldPrice, newPrice) {
  if (newPrice <= oldPrice) return false;
  const pct = (newPrice - oldPrice) / oldPrice * 100;
  const abs = newPrice - oldPrice;
  return pct >= 5 || abs >= 1;
}

// Build a hypothetical supplier_items list with one item's price overridden,
// so we can compute «what would FC% be if this item moved to that price?»
function applyReplacement(items, replacement) {
  if (!replacement) return items;
  return items.map(i =>
    i.id === replacement.itemId ? { ...i, price: replacement.price } : i
  );
}

export async function queuePriceAlerts(store, change) {
  if (!getTgToken()) return;
  const { item, oldPrice, newPrice } = change;
  if (!isPriceJumpSignificant(oldPrice, newPrice)) return;

  const chats = store.records.filter(r => r.type === 'telegram_chat');
  if (chats.length === 0) return;

  const suppliers     = store.records.filter(r => r.type === 'supplier');
  const supplierItems = store.records.filter(r => r.type === 'supplier_item');
  const supplier      = suppliers.find(s => s.id === item.supplierId);
  const supplierName  = supplier?.name || 'поставщик';
  const pct = ((newPrice - oldPrice) / oldPrice * 100).toFixed(1).replace('.', '\\.');

  const rawMsg =
    `📈 *Цена выросла*\n` +
    `${escapeMd(item.itemName)} у ${escapeMd(supplierName)}\n` +
    `${oldPrice} → *${newPrice}* BYN \\(\\+${pct}%\\)`;

  // F04 — margin impact on dishes that use this product
  const affectedDishes = [];
  if (item.productId) {
    const dishes = store.records.filter(r => r.type === 'dish' && r.active !== false);
    const oldItems = applyReplacement(supplierItems, { itemId: item.id, price: oldPrice });
    const newItems = applyReplacement(supplierItems, { itemId: item.id, price: newPrice });
    for (const d of dishes) {
      if (!d.ingredients?.some(i => i.productId === item.productId)) continue;
      const sellPrice = Number(d.sellPrice);
      if (!Number.isFinite(sellPrice) || sellPrice <= 0) continue;

      const oldCost = computeDishCost(d, oldItems, suppliers).cost;
      const newCost = computeDishCost(d, newItems, suppliers).cost;
      if (oldCost === null || newCost === null) continue;
      const oldFC = oldCost / sellPrice * 100;
      const newFC = newCost / sellPrice * 100;
      const fcJump = newFC - oldFC;
      if (fcJump < 1.5) continue; // < 1.5 п.п. — noise

      affectedDishes.push({ d, oldFC, newFC, fcJump });
    }
  }

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

export { isPriceJumpSignificant };
