/*
 * Onboarding checklist — чистая функция проверки готовности данных.
 * Вынесена из OnboardingChecklist.jsx, чтобы покрыть unit-тестами без JSX-парсера.
 */

const STORAGE_KEY = 'orakul_onboarding_dismissed';

export function buildChecklist(records) {
  const venues             = records.filter(r => r.type === 'venue');
  const suppliers          = records.filter(r => r.type === 'supplier');
  const hasSupplierItems   = records.some(r => r.type === 'supplier_item');
  const dishesWithPrice    = records.filter(r => r.type === 'dish' && Number(r.sellPrice) > 0);
  const dishesWithRecipe   = records.filter(r => r.type === 'dish' && Array.isArray(r.ingredients) && r.ingredients.length > 0);
  const sales              = records.filter(r => r.type === 'dish_sale');

  return [
    {
      id: 'venue',
      label: 'Создана точка',
      done: venues.length > 0,
      action: { tab: null, label: 'Точки создаются автоматически' },
    },
    {
      id: 'supplier',
      label: 'Добавлен поставщик с прайсом',
      done: suppliers.length > 0 && hasSupplierItems,
      action: { tab: 'suppliers', label: 'Поставщики → +' },
    },
    {
      id: 'dish',
      label: 'Блюдо с рецептом и ценой продажи',
      done: dishesWithPrice.length > 0 && dishesWithRecipe.length > 0,
      action: { tab: 'menu', label: 'Меню → + блюдо' },
    },
    {
      id: 'sale',
      label: 'Введены продажи хотя бы за один день',
      done: sales.length > 0,
      action: { tab: 'menu', label: 'Меню → 📋 Продажи дня' },
    },
  ];
}

export function isOnboardingDismissed() {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; }
}

export function dismissOnboarding() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
}

export function onboardingProgress(records) {
  const items = buildChecklist(records);
  const done  = items.filter(i => i.done).length;
  return { done, total: items.length, pct: Math.round(done / items.length * 100) };
}
