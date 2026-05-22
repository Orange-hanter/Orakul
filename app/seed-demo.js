#!/usr/bin/env node
/*
 * Orakul Pilot — Demo Seed Script
 *
 * Создаёт реалистичный набор демо-данных для презентации пилотным клиентам:
 *   • 12 товаров склада (мука, масло, мясо, овощи, кофе и пр.)
 *   • 3 поставщика с пересекающимся ассортиментом (для подсветки «дешевле у X»)
 *   • Историю цен на 3 ключевые позиции (тренды ↑↓ за последние 3 месяца)
 *   • 3 точки с разными финансовыми профилями (флагман / мини / новая)
 *   • 2 заявки в разных статусах (черновик + отправленная) на основной точке
 *   • По 1 принятой заявке на каждой точке (для P&L → попадает в себестоимость)
 *   • Выручку за последние 14 дней (per venue, разный объём)
 *   • 4 постоянных расхода на каждой точке (аренда, ФОТ, коммуналка, прочее)
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

async function getRecords() {
  const res = await fetch(`${BASE_URL}/api/records`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
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
 * Профили точек для compare-демо. Числа подобраны так, чтобы:
 *   • Точка 1 — зелёный профиль (FC ~27%, EBITDA положительная)
 *   • Точка 2 — жёлтый профиль (FC ~33%)
 *   • Точка 3 — красный профиль (FC ~43%, EBITDA отрицательная — триггер алёрта)
 */
const VENUE_PROFILES = [
  {
    name:    'Кофейня №1 (флагман)',
    address: 'пр. Мира 12',
    // Выручка 14 дней: ~6430 BYN. Пики в выходные.
    revenue: [380, 420, 510, 480, 590, 720, 650, 360, 410, 530, 470, 580, 690, 640],
    fixed: [
      { name: 'Аренда помещения',    amount: 2200, category: 'rent'      },
      { name: 'ФОТ (3 сотрудника)',  amount: 3800, category: 'payroll'   },
      { name: 'Коммунальные',        amount:  320, category: 'utilities' },
      { name: 'Эквайринг + связь',   amount:  150, category: 'other'     },
    ],
    receivedOrder: {
      supplierIdx: 0,
      items: [
        { key: 'ООО АгроПоставка|Грудка куриная охл.',         qty: 100 },
        { key: 'ООО АгроПоставка|Моцарелла для пиццы 2 кг',    qty: 30  },
        { key: 'ООО АгроПоставка|Масло слив. 82.5% 5 кг',      qty: 40  },
      ],
      daysAgo: 4,
      note:    'Закупка на неделю',
    },
  },
  {
    name:    'Кофейня №2 (мини)',
    address: 'ул. Сурганова 25',
    // Выручка ~4070 BYN.
    revenue: [240, 260, 280, 220, 310, 380, 360, 230, 250, 290, 260, 320, 340, 330],
    fixed: [
      { name: 'Аренда помещения',     amount: 1500, category: 'rent'      },
      { name: 'ФОТ (1 сотрудник)',    amount: 1800, category: 'payroll'   },
      { name: 'Коммунальные',         amount:  180, category: 'utilities' },
      { name: 'Эквайринг + связь',    amount:  120, category: 'other'     },
    ],
    receivedOrder: {
      supplierIdx: 0,
      items: [
        { key: 'ООО АгроПоставка|Грудка куриная охл.',         qty: 90 },
        { key: 'ООО АгроПоставка|Моцарелла для пиццы 2 кг',    qty: 35 },
      ],
      daysAgo: 3,
      note:    'Стандарт',
    },
  },
  {
    name:    'Кофейня №3 (новая)',
    address: 'пр. Победителей 89',
    // Выручка ~2890 BYN — низкая, точка ещё раскручивается.
    revenue: [150, 180, 210, 170, 230, 260, 250, 160, 180, 200, 190, 230, 260, 220],
    fixed: [
      { name: 'Аренда помещения',     amount: 1800, category: 'rent'      },
      { name: 'ФОТ (1 сотрудник)',    amount: 1700, category: 'payroll'   },
      { name: 'Коммунальные',         amount:  220, category: 'utilities' },
      { name: 'Эквайринг + связь',    amount:  100, category: 'other'     },
    ],
    receivedOrder: {
      supplierIdx: 0,
      items: [
        { key: 'ООО АгроПоставка|Грудка куриная охл.',         qty: 80 },
        { key: 'ООО АгроПоставка|Моцарелла для пиццы 2 кг',    qty: 35 },
      ],
      daysAgo: 2,
      note:    'Базовая закупка',
    },
  },
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

  console.log('\n🏢 Настраиваю точки...');
  const existing = await getRecords();
  const existingDefault = existing.find(r => r.type === 'venue' && r.isDefault);
  const venueIds = [];

  // Первая точка — переименовываем существующую default-точку
  if (existingDefault) {
    await put(existingDefault.id, { name: VENUE_PROFILES[0].name, address: VENUE_PROFILES[0].address });
    venueIds.push(existingDefault.id);
    console.log(`   • ${VENUE_PROFILES[0].name} (переименована из default)`);
  } else {
    const created = await post({ type: 'venue', name: VENUE_PROFILES[0].name, address: VENUE_PROFILES[0].address, isDefault: true });
    venueIds.push(created.id);
    console.log(`   • ${VENUE_PROFILES[0].name}`);
  }
  // Точки 2 и 3 — новые
  for (let i = 1; i < VENUE_PROFILES.length; i++) {
    const created = await post({ type: 'venue', name: VENUE_PROFILES[i].name, address: VENUE_PROFILES[i].address });
    venueIds.push(created.id);
    console.log(`   • ${VENUE_PROFILES[i].name}`);
  }

  console.log('\n📦 Создаю товары склада (на флагмане)...');
  const productMap = new Map();
  for (const p of PRODUCTS) {
    const created = await post({ type: 'product', venueId: venueIds[0], ...p });
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
    venueId:      venueIds[0],
    supplierId:   supplierIds[0],
    supplierName: SUPPLIERS[0].name,
    status:       'draft',
    items:        items1,
    totalAmount:  total1,
    currency:     'BYN',
    desiredDate:  isoDateInDays(2),
    note:         'Стандартный недельный заказ',
  });
  console.log(`   • [Кофейня №1] Черновик у АгроПоставки на ${total1.toFixed(2)} BYN`);

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
    venueId:      venueIds[0],
    supplierId:   supplierIds[1],
    supplierName: SUPPLIERS[1].name,
    status:       'submitted',
    items:        items2,
    totalAmount:  total2,
    currency:     'BYN',
    desiredDate:  isoDateInDays(3),
    note:         'Переключились с АгроПоставки — экономия ~14% на бакалее',
  });
  console.log(`   • [Кофейня №1] Отправлена Козлову на ${total2.toFixed(2)} BYN`);

  // ── Per-venue financial data (revenue + costs + fixed expenses) ────────

  const firstDayOfMonth = (() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().slice(0, 10);
  })();

  for (let i = 0; i < VENUE_PROFILES.length; i++) {
    const profile  = VENUE_PROFILES[i];
    const venueId  = venueIds[i];

    console.log(`\n🏪 ${profile.name}:`);

    // Принятая заявка (попадает в P&L себестоимость)
    const orderItems = profile.receivedOrder.items.map(({ key, qty }) => {
      const c = CATALOG.find(c => `${SUPPLIERS[c.supplierIdx].name}|${c.itemName}` === key);
      if (!c) throw new Error(`Catalog item not found: ${key}`);
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
    const orderTotal = orderItems.reduce((s, x) => s + x.total, 0);
    await post({
      type:         'order',
      venueId,
      supplierId:   supplierIds[profile.receivedOrder.supplierIdx],
      supplierName: SUPPLIERS[profile.receivedOrder.supplierIdx].name,
      status:       'received',
      receivedAt:   Date.now() - profile.receivedOrder.daysAgo * 86_400_000,
      items:        orderItems,
      totalAmount:  orderTotal,
      currency:     'BYN',
      desiredDate:  isoDateInDays(-profile.receivedOrder.daysAgo),
      note:         profile.receivedOrder.note,
    });
    console.log(`   • Принятая заявка: ${orderTotal.toFixed(2)} BYN`);

    // Выручка за 14 дней
    let revenueSum = 0;
    for (let d = 0; d < profile.revenue.length; d++) {
      const amount = profile.revenue[d];
      await post({
        type:     'revenue_entry',
        venueId,
        date:     isoDateInDays(-(profile.revenue.length - d)),
        amount,
        currency: 'BYN',
        source:   'manual',
        note:     '',
      });
      revenueSum += amount;
    }
    console.log(`   • Выручка 14 дней: ${revenueSum} BYN`);

    // Постоянные расходы
    let fixedSum = 0;
    for (const e of profile.fixed) {
      await post({
        type:      'fixed_expense',
        venueId,
        name:      e.name,
        amount:    e.amount,
        currency:  'BYN',
        category:  e.category,
        startDate: firstDayOfMonth,
        endDate:   null,
      });
      fixedSum += e.amount;
    }
    console.log(`   • Постоянные расходы: ${fixedSum} BYN/мес (${profile.fixed.length} статей)`);
  }

  console.log('\n✅  Демо-данные загружены успешно.\n');
  console.log('   Подсказки для демо:');
  console.log('   • Поставщики → ООО АгроПоставка → Грудка/Мука — тренды + аналоги дешевле');
  console.log('   • Заявки — черновик + отправленная на Кофейне №1');
  console.log('   • Финансы → переключатель «Сравнение (3)» → таблица 3 точек со светофором');
  console.log('   • Точка 3 покажет красный алёрт (FC > 38% + отрицательная EBITDA)\n');
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
