/*
 * Fuzzy-матчинг для русских названий товаров.
 *
 * Подход: токенизация → нормализация (lowercase, без чисел и единиц) →
 * упрощённый стемминг (срез русских окончаний) → Jaccard-сходство.
 *
 * Это НЕ полный NLP-стеммер (типа pymorphy3) — он сознательно простой
 * и быстрый, подходит для коротких товарных названий. Для R3+ можно
 * заменить на natural / stemmer-ru / Yandex Cleopatra.
 */

// Единицы измерения и стоп-слова, которые игнорируем при сравнении
const UNIT_WORDS = new Set([
  'кг', 'г', 'гр', 'грамм',
  'л', 'мл', 'литр',
  'шт', 'упак', 'уп', 'пач', 'пачка',
  'кор', 'короб', 'бут', 'пак', 'банка',
  'дес', 'десяток',
]);

const STOP_WORDS = new Set([
  'от', 'до', 'для', 'без', 'по', 'из',
  'на', 'не', 'или', 'либо',
  'на', 'в', 'с',
  'гост', 'тм', 'тм.', 'тс',
]);

/**
 * Нормализация: lowercase, убрать пунктуацию и цифры, схлопнуть пробелы.
 */
export function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')                            // ё → е для устойчивости
    .replace(/[.,;:!?"«»()\/\\%]/g, ' ')           // пунктуация → пробел
    .replace(/\d+([.,]\d+)?/g, ' ')                // числа выкидываем
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Простой стеммер: срезает типовые русские окончания.
 * Не идеален лингвистически, но даёт стабильную форму для сравнения.
 *
 * Сознательно не трогает -ка/-ки (мука → мука, а не «м»), -ло (масло → масло),
 * чтобы не уничтожать корень коротких слов. Финальное единичное окончание
 * срезаем только если результат остаётся ≥ 3 букв.
 */
export function stem(token) {
  let s = token;
  // 3-буквенные окончания (падежи / прилагательные)
  s = s.replace(/(ами|ями|ыми|ого|его|ому|ему|ими)$/, '');
  // 2-буквенные (прилагательные + падежи существительных)
  s = s.replace(/(ая|ое|ой|ий|ый|ие|ые|ую|юю|их|ах|ям|ем|ов|ев|ам|ом)$/, '');
  // Финальная гласная — только для слов длиннее 3 символов
  if (s.length > 3) s = s.replace(/(а|я|ы|и|о|е|у|ю|ь|й)$/, '');
  return s;
}

/**
 * Токенизация: разбить на токены ≥ 3 символов, выкинуть единицы и стоп-слова,
 * вернуть массив стемов (порядок сохранён — первый токен обычно «корневое»
 * слово, важное для семантики: Мука X, Масло X, Сыр X).
 */
export function tokenize(name) {
  return normalizeName(name)
    .split(' ')
    .filter(t => t.length >= 3 && !UNIT_WORDS.has(t) && !STOP_WORDS.has(t))
    .map(stem)
    .filter(t => t.length >= 2);
}

/**
 * Сходство названий: Jaccard по стемам + бонус 0.2, если совпадает
 * корневой токен (первое значимое слово). Бонус помогает в типичном
 * случае «Мука X» ↔ «Мука Y» (детали разные, корень один).
 *
 * Возвращает число от 0 до 1.
 */
export function similarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  let score = union > 0 ? inter / union : 0;
  if (ta[0] === tb[0]) score = Math.min(1, score + 0.2);
  return score;
}

/**
 * Найти возможные аналоги item среди otherItems.
 * Возвращает массив { item, similarity, exact }, отсортированный по
 * similarity desc → price asc.
 *
 * @param item — текущая позиция (supplier_item)
 * @param otherItems — все остальные supplier_item (без item)
 * @param opts — { threshold = 0.3, sameUnit = true }
 */
export function findAnalogs(item, otherItems, opts = {}) {
  const threshold = opts.threshold ?? 0.3;
  const sameUnit  = opts.sameUnit  ?? true;

  return otherItems
    .filter(o => o.id !== item.id)
    .filter(o => o.supplierId !== item.supplierId)
    .filter(o => !sameUnit || o.unit === item.unit)
    .map(o => {
      const exact = !!(item.productId && o.productId && item.productId === o.productId);
      const sim   = exact ? 1.0 : similarity(item.itemName, o.itemName);
      return { item: o, similarity: sim, exact };
    })
    .filter(x => x.similarity >= threshold)
    .sort((a, b) => {
      // Сначала точные, затем по similarity desc, затем по цене asc
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      if (a.similarity !== b.similarity) return b.similarity - a.similarity;
      return (a.item.price ?? Infinity) - (b.item.price ?? Infinity);
    });
}
