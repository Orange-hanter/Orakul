import { useState, useMemo } from 'react';
import Modal from './Modal.jsx';
import { toIsoDate, findSaleRecord } from '../utils/dishSales.js';
import { nplural } from '../utils/plural.js';

/*
 * Ввод дневных продаж по блюдам. Один record-тип `dish_sale` на (dishId, date)
 * — upsert (find existing → update, иначе create new). UI: дата + список
 * активных блюд с инпутом count.
 */

export default function DishSalesModal({ dishes, sales, onClose, onCreate, onUpdate, showToast }) {
  const [date,    setDate]    = useState(toIsoDate(new Date()));
  const [draft,   setDraft]   = useState({}); // { dishId: countString }
  const [saving,  setSaving]  = useState(false);

  // Подтянуть существующие count для выбранной даты.
  const existingByDish = useMemo(() => {
    const m = new Map();
    sales.filter(s => s.date === date).forEach(s => m.set(s.dishId, s));
    return m;
  }, [sales, date]);

  // Активные блюда в алфавитном порядке.
  const activeDishes = useMemo(
    () => dishes.filter(d => d.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [dishes]
  );

  // Сколько проставлено в текущей сессии (draft + existing).
  function currentCount(dishId) {
    if (draft[dishId] !== undefined) return draft[dishId];
    const existing = existingByDish.get(dishId);
    return existing ? String(existing.count) : '';
  }

  function setCount(dishId, v) {
    setDraft(prev => ({ ...prev, [dishId]: v }));
  }

  const totalCount = activeDishes
    .map(d => Number(currentCount(d.id)))
    .filter(n => Number.isFinite(n) && n > 0)
    .reduce((a, b) => a + b, 0);

  const filledCount = activeDishes
    .map(d => Number(currentCount(d.id)))
    .filter(n => Number.isFinite(n) && n > 0)
    .length;

  async function save() {
    setSaving(true);
    try {
      let created = 0;
      let updated = 0;
      for (const dish of activeDishes) {
        const newVal = currentCount(dish.id);
        // Пропускаем пустые поля
        if (newVal === '' || newVal === null || newVal === undefined) continue;
        const n = Number(newVal);
        if (!Number.isFinite(n) || n < 0) continue;

        const existing = findSaleRecord(sales, dish.id, date);
        if (existing) {
          // Update только если значение изменилось
          if (Number(existing.count) !== n) {
            await onUpdate(existing.id, { count: n, dishName: dish.name });
            updated++;
          }
        } else if (n > 0) {
          await onCreate({
            type:     'dish_sale',
            dishId:   dish.id,
            dishName: dish.name,
            date,
            count:    n,
            source:   'manual',
          });
          created++;
        }
      }
      if (created || updated) {
        showToast(`Сохранено: ${created} новых, ${updated} обновлено`);
      } else {
        showToast('Изменений нет');
      }
      onClose();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Продажи дня" onClose={onClose} onSave={save} saveLabel="Сохранить" saving={saving}>
      <div className="form-group">
        <label>Дата</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} max={toIsoDate(new Date())} />
      </div>

      <div style={{ fontSize: 12, color: 'var(--neutral)', marginBottom: 8 }}>
        Введите количество проданных порций. Пустое = не считается. Существующие записи на эту дату обновятся.
      </div>

      {activeDishes.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--neutral)', padding: 16, textAlign: 'center' }}>
          Нет активных блюд в меню.
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        {activeDishes.map(d => {
          const existing = existingByDish.get(d.id);
          return (
            <div key={d.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 0',
              borderBottom: '1px solid #f1f5f9',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: 'var(--neutral)' }}>
                  {d.category}{existing ? ` · уже введено: ${existing.count}` : ''}
                </div>
              </div>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={currentCount(d.id)}
                onChange={e => setCount(d.id, e.target.value)}
                placeholder="0"
                style={{ width: 90, height: 40, fontSize: 14, textAlign: 'right' }}
              />
              <span style={{ fontSize: 12, color: 'var(--neutral)', width: 32 }}>порц</span>
            </div>
          );
        })}
      </div>

      {filledCount > 0 && (
        <div style={{
          padding: 12, background: '#f8fafc', borderRadius: 8,
          display: 'flex', justifyContent: 'space-between', fontSize: 14,
        }}>
          <span>{nplural(filledCount, ['блюдо', 'блюда', 'блюд'])} с продажами</span>
          <strong>Итого: {totalCount} порц.</strong>
        </div>
      )}
    </Modal>
  );
}
