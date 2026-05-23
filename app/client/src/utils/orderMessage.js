/*
 * Order message builder + channel deeplinks.
 *
 * См. docs/08-technical/12-order-from-stock-spec.md §7 (шаблон) и §9 (каналы).
 *
 * Каналы — клиент-side диплинки, никакой серверной отправки:
 *   email    → mailto:?subject=&body=         (протокол-хендлер ОС)
 *   telegram → https://t.me/<user>?text=      (открывается в браузере / TG-клиенте)
 *   viber    → viber://chat?number=           (НЕ поддерживает text — копируем в clipboard)
 */
import { CURRENCY } from './format.js';

const CHANNELS = ['email', 'telegram', 'viber'];

/**
 * Собирает текст заявки. Юзер увидит его в textarea и сможет отредактировать
 * перед отправкой.
 */
export function buildOrderMessage({ venueName, items, desiredDate, total, currency = CURRENCY }) {
  const lines = items
    .map((it, i) => `  ${i + 1}. ${it.itemName} — ${it.quantity} ${it.unit}`)
    .join('\n');
  const dateLine = desiredDate
    ? `Желаемая дата поставки: ${formatRuDate(desiredDate)}\n`
    : '';
  const venueLine = venueName ? ` для «${venueName}»` : '';

  return `Здравствуйте!

Прошу подготовить заказ${venueLine}:

${lines}

${dateLine}Сумма: ${total.toFixed(2)} ${currency}

Спасибо!`;
}

function formatRuDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

/**
 * Какие каналы доступны для поставщика — те, у которых заполнено
 * соответствующее поле контактов.
 */
export function availableChannels(supplier) {
  if (!supplier) return [];
  const out = [];
  if (supplier.email)            out.push('email');
  if (supplier.telegramUsername) out.push('telegram');
  if (supplier.viberPhone)       out.push('viber');
  return out;
}

export function channelLabel(channel) {
  switch (channel) {
    case 'email':    return 'Email';
    case 'telegram': return 'Telegram';
    case 'viber':    return 'Viber';
    default:         return channel;
  }
}

export function channelIcon(channel) {
  switch (channel) {
    case 'email':    return '✉';
    case 'telegram': return '✈';
    case 'viber':    return '💬';
    default:         return '';
  }
}

/**
 * Строит диплинк. Для viber возвращает только chat-URI — текст надо
 * отдельно положить в clipboard (см. openOrderChannel).
 */
export function buildDeeplink(channel, supplier, text) {
  const enc = encodeURIComponent(text || '');
  if (channel === 'email') {
    if (!supplier.email) return null;
    const subj = encodeURIComponent('Заявка на поставку');
    return `mailto:${supplier.email}?subject=${subj}&body=${enc}`;
  }
  if (channel === 'telegram') {
    if (!supplier.telegramUsername) return null;
    // Допускаем как @username, так и +375... (TG нормализует оба)
    const handle = supplier.telegramUsername.replace(/^@/, '');
    return `https://t.me/${encodeURIComponent(handle)}?text=${enc}`;
  }
  if (channel === 'viber') {
    if (!supplier.viberPhone) return null;
    return `viber://chat?number=${encodeURIComponent(supplier.viberPhone)}`;
  }
  return null;
}

/**
 * Открывает диплинк синхронно из user-gesture обработчика.
 * Для viber дополнительно копирует текст в clipboard (Viber не принимает text=).
 *
 * Returns { ok: boolean, viberClipboard: boolean } — для toast'а.
 */
export function openOrderChannel(channel, supplier, text) {
  const href = buildDeeplink(channel, supplier, text);
  if (!href) return { ok: false, viberClipboard: false };

  let viberClipboard = false;
  if (channel === 'viber') {
    try {
      navigator.clipboard?.writeText?.(text);
      viberClipboard = true;
    } catch { /* clipboard может быть недоступен — не критично */ }
  }

  // Telegram — это https URL, открываем в новой вкладке.
  // mailto: / viber: — протокол-хендлеры, target=_self не уводит со страницы.
  const a = document.createElement('a');
  a.href = href;
  if (channel === 'telegram') {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  document.body.appendChild(a);
  a.click();
  a.remove();

  return { ok: true, viberClipboard };
}

export const ORDER_CHANNELS = CHANNELS;
