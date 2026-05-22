#!/usr/bin/env node
/*
 * Orakul Pilot — Demo Seed Script
 *
 * Создаёт реалистичный набор демо-данных для презентации пилотным клиентам:
 *   • 12 товаров склада (мука, масло, мясо, овощи, кофе и пр.)
 *   • 3 поставщика с пересекающимся ассортиментом (для подсветки «дешевле у X»)
 *   • Историю цен на 3 ключевые позиции (тренды ↑↓ за последние 3 месяца)
 *   • 2 заявки в разных статусах (черновик + отправленная)
 *   • 1 принятую заявку (для P&L → попадает в себестоимость)
 *   • Выручку за последние 14 дней (для P&L → выручка)
 *   • 4 постоянных расхода (аренда, ФОТ, коммуналка, прочее)
 *
 * Использование:
 *   APP_PASSWORD=xxx node seed-demo.js [--url http://localhost:3001]
 *
 * Скрипт ИДЕМПОТЕНТЕН по добавлению: повторный запуск создаст дубликаты.
 * Для чистого старта используйте /api/export → удалите store.enc → рестарт.
 */

require('dotenv').config();

const BASE_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : (process.env.SEED_URL || 'http://localhost:3001');

const PASSWORD = process.env.APP_PASSWORD;

if (!PASSWORD) {
  console.error('❌  APP_PASSWORD not set in .env');
  process.exit(1);
}

let token = null;

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) {
    console.error(`❌  Login failed: ${res.status}`);
    process.exit(1);
  }
  const { token: t } = await res.json();
  token = t;
  console.log('✅  Logged in');
}

async function post(body) {
  const res = await fetch(`${BASE_URL}/api/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`POST failed (${res.status}): ${err.error || res.statusText}`);
  }
  return res.json();
}

async function put(id, body) {
  const res = await fetch(`${BASE_URL}/api/records/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`PUT failed (${res.status}): ${err.error || res.statusText}`);
  }
  return res.json();
}

// Чтобы price_history имела разные timestamps, делаем небольшие паузы между
// обновлениями цены. Сервер использует Date.now() для createdAt истории.
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Данные для сидинга ────────────────────────────────────────────────────────

const PRODUCTS = [
  { name: 'Мука пшеничная в/с',   category: 'Бакалея',  unit: 'кг'   },
  { name: 'Масло сливочное 82.5%', category: 'Молочка',  unit: 'кг'   },
  { name: 'Яйцо куриное С1',       category: 'Молочка',  unit: 'шт'   },
  { name: 'Молоко 3.2%',           category: 'Молочка',  unit: 'л'    },
  { name: 'Сахар-песок',           category: 'Бакалея',  unit: 'кг'   },
  { name: 'Кофе арабика зерно',    category: 'Напитки',  unit: 'кг'   },
  { name: 'Сыр моцарелла',         category: 'Молочка',  unit: 'кг'   },
  { name: 'Помидоры свежие',       category: 'Овощи',    unit: 'кг'   },
  { name: 'Огурцы свежие',         category: 'Овощи',    unit: 'кг'   },
  { name: 'Куриная грудка',        category: 'Мясо',     unit: 'кг'   },
  { name: 'Хлеб тостовый',         category: 'Бакалея',  unit: 'шт'   },
  { name: 'Сливки 10%',            category: 'Молочка',  unit: 'л'    },
];

const SUPPLIERS = [
  {
    name:    'ООО АгроПоставка',
    contact: 'Иван Петров, +375 29 123 45 67',
    tags:    ['мясо', 'молочка', 'бакалея'],
    status:  'active',
    note:    'Основной поставщик с 2024 года. Доставка пн/ср/пт.',
  },
  {
    name:    'ИП Козлов',
    contact: 'Алексей Козлов, +375 33 456 78 90',
    tags:    ['бакалея', 'специи'],
    status:  'active',
    note:    'Нишевой поставщик. Хорошие цены на бакалею.',
  },
  {
    name:    'ООО ФрешМаркет',
    contact: 'Елена Морозова, fresh@market.by',
    tags:    ['овощи', 'фрукты', 'зелень'],
    status:  'active',
    note:    'Свежие овощи ежедневно. Доставка до 9:00.',
  },
];

/*
 * Каталог поставщиков. Пересечения подобраны так, чтобы подсветка
 * «💡 дешевле у X» сработала в демо.
 *
 * productKey — имя из PRODUCTS (для маппинга на productId).
 */
const CATALOG = [
  // ── ООО АгроПоставка (основной, средние цены) ───────────────────────
  { supplierIdx: 0, productKey: 'Мука пшеничная в/с',    itemName: 'Мука в/с 25 кг',         unit: 'кг', price: 1.20, minQty: 25,   deliveryDays: 2 },
  { supplierIdx: 0, productKey: 'Масло сливочное 82.5%', itemName: 'Масло слив. 82.5% 5 кг', unit: 'кг', price: 8.50, minQty: 5,    deliveryDays: 2 },
  { supplierIdx: 0, productKey: 'Яйцо куриное С1',       itemName: 'Яйцо С1 десяток',         unit: 'шт', price: 0.43, minQty: 100,  deliveryDays: 2 },
  { supplierIdx: 0, productKey: 'Молоко 3.2%',           itemName: 'Молоко 3.2% 1 л',         unit: 'л',  price: 2.10, minQty: 12,   deliveryDays: 2 },
  { supplierIdx: 0, productKey: 'Сахар-песок',           itemName: 'Сахар-песок 50 кг',       unit: 'кг', price: 2.40, minQty: 50,   deliveryDays: 2 },
  { supplierIdx: 0, productKey: 'Сыр моцарелла',         itemName: 'Моцарелла для пиццы 2 кг', unit: 'кг', price: 14.80, minQty: 2,   deliveryDays: 3 },
  { supplierIdx: 0, productKey: 'Куриная грудка',        itemName: 'Грудка куриная охл.',     unit: 'кг', price: 9.20, minQty: 5,    deliveryDays: 1 },
  { supplierIdx: 0, productKey: 'Сливки 10%',            itemName: 'Сливки 10% 1 л',          unit: 'л',  price: 4.30, minQty: 6,    deliveryDays: 2 },

  // ── ИП Козлов (дешевле на бакалее) ──────────────────────────────────
  { supplierIdx: 1, productKey: 'Мука пшеничная в/с',    itemName: 'Мука пшеничная высш. сорт', unit: 'кг', price: 1.05, minQty: 50, deliveryDays: 3 },
  { supplierIdx: 1, productKey: 'Сахар-песок',           itemName: 'Сахар-песок ГОСТ',          unit: 'кг', price: 2.15, minQty: 50, deliveryDays: 3 },
  { supplierIdx: 1, productKey: 'Кофе арабика зерно',    itemName: 'Кофе арабика в зёрнах 1 кг', unit: 'кг', price: 38.00, minQty: 5, deliveryDays: 5 },
  { supplierIdx: 1, productKey: 'Хлеб тостовый',         itemName: 'Хлеб для тостов 450 г',     unit: 'шт', price: 1.80, minQty: 12, deliveryDays: 1 },

  // ── ООО ФрешМаркет (овощи, эксклюзивно) ──────────────────────────────
  { supplierIdx: 2, productKey: 'Помидоры свежие',       itemName: 'Помидоры розовые', unit: 'кг', price: 5.40, minQty: 3, deliveryDays: 1 },
  { supplierIdx: 2, productKey: 'Огурцы свежие',         itemName: 'Огурцы гладкие',    unit: 'кг', price: 4.20, minQty: 3, deliveryDays: 1 },
];

/*
 * История цен — для каждого item можно задать массив прошлых цен,
 * которые проигрываются «как было раньше», создавая тренд.
 * Первый элемент массива — самая старая цена, последний — текущая (не дублируется).
 */
const PRICE_TIMELINE = {
  // Мука у АгроПоставки выросла на 9% за 3 месяца — на демо показываем тренд ↑
  'ООО АгроПоставка|Мука в/с 25 кг': [1.10, 1.15, 1.20],
  // Масло у АгроПоставки сначала росло, потом откатилось — волатильность
  'ООО АгроПоставка|Масло слив. 82.5% 5 кг': [8.20, 8.90, 8.50],
  // Кофе у Козлова стабильно дешевеет — выгодное предложение
  'ИП Козлов|Кофе арабика в зёрнах 1 кг': [42.00, 40.00, 38.00],
};

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  await login();

  console.log('\n📦 Создаю товары склада...');
  const productMap = new Map();
  for (const p of PRODUCTS) {
    const created = await post({ type: 'product', ...p });
    productMap.set(p.name, created.id);
    console.log(`   • ${p.name}`);
  }

  console.log('\n🏪 Создаю поставщиков...');
  const supplierIds = [];
  for (const s of SUPPLIERS) {
    const created = await post({ type: 'supplier', ...s });
    supplierIds.push(created.id);
    console.log(`   • ${s.name}`);
  }

  console.log('\n💰 Заполняю каталоги (с историей цен)...');
  const itemIds = new Map(); // supplierName|itemName → itemId
  for (const c of CATALOG) {
    const supplier   = SUPPLIERS[c.supplierIdx];
    const productId  = productMap.get(c.productKey) || null;
    const timelineKey = `${supplier.name}|${c.itemName}`;
    const history    = PRICE_TIMELINE[timelineKey];

    // Если есть история — создаём с самой старой ценой, потом проигрываем апдейты
    const initialPrice = history ? history[0] : c.price;

    const item = await post({
      type:         'supplier_item',
      supplierId:   supplierIds[c.supplierIdx],
      productId,
      itemName:     c.itemName,
      unit:         c.unit,
      price:        initialPrice,
      currency:     'BYN',
      minQty:       c.minQty       ?? null,
      deliveryDays: c.deliveryDays ?? null,
    });
    itemIds.set(timelineKey, item.id);

    if (history) {
      // Промежуточные цены: history[1]..history[N-1]
      for (let i = 1; i < history.length - 1; i++) {
        await sleep(15); // разные timestamps для истории
        await put(item.id, { price: history[i] });
      }
      // Финальная актуальная цена (если отличается от последнего шага истории)
      if (history[history.length - 1] !== history[history.length - 2]) {
        await sleep(15);
        await put(item.id, { price: history[history.length - 1] });
      }
      console.log(`   • ${supplier.name} → ${c.itemName} (история: ${history.join(' → ')})`);
    } else {
      console.log(`   • ${supplier.name} → ${c.itemName} (${c.price} BYN)`);
    }
  }

  console.log('\n📝 Создаю демо-заявки...');

  // Заявка №1 — черновик: смешанный заказ у основного поставщика
  const items1 = [
    { key: 'ООО АгроПоставка|Мука в/с 25 кг',         qty: 50  },
    { key: 'ООО АгроПоставка|Масло слив. 82.5% 5 кг', qty: 10  },
    { key: 'ООО АгроПоставка|Яйцо С1 десяток',         qty: 200 },
  ].map(({ key, qty }) => {
    const c = CATALOG.find(c => `${SUPPLIERS[c.supplierIdx].name}|${c.itemName}` === key);
    return {
      itemId:    itemIds.get(key),
      itemName:  c.itemName,
      unit:      c.unit,
      quantity:  qty,
      unitPrice: c.price,
      currency:  'BYN',
      total:     qty * c.price,
    };
  });
  const total1 = items1.reduce((s, x) => s + x.total, 0);

  await post({
    type:         'order',
    supplierId:   supplierIds[0],
    supplierName: SUPPLIERS[0].name,
    status:       'draft',
    items:        items1,
    totalAmount:  total1,
    currency:     'BYN',
    desiredDate:  isoDateInDays(2),
    note:         'Стандартный недельный заказ',
  });
  console.log(`   • Черновик у АгроПоставки на ${total1.toFixed(2)} BYN`);

  // Заявка №2 — отправленная: бакалея у Козлова (демонстрирует, что мы
  // переключились на более дешёвого поставщика по муке и сахару)
  const items2 = [
    { key: 'ИП Козлов|Мука пшеничная высш. сорт', qty: 100 },
    { key: 'ИП Козлов|Сахар-песок ГОСТ',           qty: 50  },
  ].map(({ key, qty }) => {
    const c = CATALOG.find(c => `${SUPPLIERS[c.supplierIdx].name}|${c.itemName}` === key);
    return {
      itemId:    itemIds.get(key),
      itemName:  c.itemName,
      unit:      c.unit,
      quantity:  qty,
      unitPrice: c.price,
      currency:  'BYN',
      total:     qty * c.price,
    };
  });
  const total2 = items2.reduce((s, x) => s + x.total, 0);

  await post({
    type:         'order',
    supplierId:   supplierIds[1],
    supplierName: SUPPLIERS[1].name,
    status:       'submitted',
    items:        items2,
    totalAmount:  total2,
    currency:     'BYN',
    desiredDate:  isoDateInDays(3),
    note:         'Переключились с АгроПоставки — экономия ~14% на бакалее',
  });
  console.log(`   • Отправлена Козлову на ${total2.toFixed(2)} BYN`);

  // Заявка №3 — принятая (для P&L): фрукты у ФрешМаркета
  const items3 = [
    { key: 'ООО ФрешМаркет|Помидоры розовые', qty: 15 },
    { key: 'ООО ФрешМаркет|Огурцы гладкие',   qty: 10 },
  ].map(({ key, qty }) => {
    const c = CATALOG.find(c => `${SUPPLIERS[c.supplierIdx].name}|${c.itemName}` === key);
    return {
      itemId:    itemIds.get(key),
      itemName:  c.itemName,
      unit:      c.unit,
      quantity:  qty,
      unitPrice: c.price,
      currency:  'BYN',
      total:     qty * c.price,
    };
  });
  const total3 = items3.reduce((s, x) => s + x.total, 0);

  await post({
    type:         'order',
    supplierId:   supplierIds[2],
    supplierName: SUPPLIERS[2].name,
    status:       'received',
    receivedAt:   Date.now() - 3 * 86_400_000, // 3 дня назад
    items:        items3,
    totalAmount:  total3,
    currency:     'BYN',
    desiredDate:  isoDateInDays(-3),
    note:         'Принято полностью',
  });
  console.log(`   • Принята у ФрешМаркета на ${total3.toFixed(2)} BYN`);

  console.log('\n💵 Заполняю выручку (последние 14 дней)...');
  // Реалистичная дневная выручка для небольшой кофейни/кафе: 350–650 BYN/день
  // с пиками в выходные.
  const revenuePattern = [380, 420, 510, 480, 590, 720, 650, 360, 410, 530, 470, 580, 690, 640];
  for (let i = 0; i < revenuePattern.length; i++) {
    const date = isoDateInDays(-(revenuePattern.length - i));
    await post({
      type:     'revenue_entry',
      date,
      amount:   revenuePattern[i],
      currency: 'BYN',
      source:   'manual',
      note:     '',
    });
  }
  const revenueTotal = revenuePattern.reduce((s, x) => s + x, 0);
  console.log(`   • 14 дней по 350–720 BYN/день · итого ${revenueTotal} BYN`);

  console.log('\n🏠 Заполняю постоянные расходы...');
  const fixedExpenses = [
    { name: 'Аренда помещения',  amount: 2200, category: 'rent',      icon: '🏠' },
    { name: 'ФОТ (2 сотрудника)', amount: 3400, category: 'payroll',   icon: '👥' },
    { name: 'Коммунальные',      amount:  280, category: 'utilities', icon: '💡' },
    { name: 'Эквайринг + связь', amount:  150, category: 'other',     icon: '📋' },
  ];
  const firstDayOfMonth = (() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  })();
  for (const e of fixedExpenses) {
    await post({
      type:      'fixed_expense',
      name:      e.name,
      amount:    e.amount,
      currency:  'BYN',
      category:  e.category,
      startDate: firstDayOfMonth,
      endDate:   null,
    });
    console.log(`   • ${e.icon} ${e.name}: ${e.amount} BYN/мес`);
  }

  console.log('\n✅  Демо-данные загружены успешно.\n');
  console.log('   Подсказки для демо:');
  console.log('   • Поставщики → ООО АгроПоставка → Мука в/с — тренд ▲ + аналог дешевле у Козлова');
  console.log('   • Заявки — черновик, отправленная, принятая (попадает в P&L)');
  console.log('   • Финансы → "7 дней" — увидите выручку, food cost, EBITDA');
  console.log('   • Финансы → ⚙ — редактируемые выручка и расходы\n');
}

function isoDateInDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

main().catch(e => {
  console.error('\n❌  Seed failed:', e.message);
  process.exit(1);
});
