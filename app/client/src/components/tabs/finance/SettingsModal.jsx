import { useState } from 'react';
import Modal from '../../Modal.jsx';

const CURRENCY = 'BYN';

const EXPENSE_CATEGORIES = [
  { id: 'rent',      label: 'Аренда',      icon: '🏠' },
  { id: 'payroll',   label: 'ФОТ',         icon: '👥' },
  { id: 'utilities', label: 'Коммунальные', icon: '💡' },
  { id: 'marketing', label: 'Маркетинг',   icon: '📣' },
  { id: 'other',     label: 'Прочее',      icon: '📋' },
];

export const CATEGORY_BY_ID = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.id, c]));

function toIso(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1); x.setHours(0, 0, 0, 0);
  return x;
}

function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${Math.round(Number(n)).toLocaleString('ru')} ${CURRENCY}`;
}

// ── Revenue entry form ───────────────────────────────────────────────────────

function RevenueForm({ initial, onClose, onSave }) {
  const [date,   setDate]   = useState(initial?.date   || toIso(new Date()));
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [note,   setNote]   = useState(initial?.note   || '');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!date || amount === '' || Number.isNaN(Number(amount))) return;
    setSaving(true);
    try {
      await onSave({
        type:     'revenue_entry',
        date,
        amount:   Number(amount),
        currency: CURRENCY,
        source:   'manual',
        note:     note.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initial ? 'Редактировать выручку' : 'Добавить выручку'}
      onClose={onClose}
      onSave={submit}
      saving={saving}
    >
      <div className="form-row">
        <div className="form-group">
          <label>Дата</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Сумма ({CURRENCY})</label>
          <input type="number" step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus />
        </div>
      </div>
      <div className="form-group">
        <label>Заметка</label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Опционально" />
      </div>
    </Modal>
  );
}

// ── Fixed expense form ───────────────────────────────────────────────────────

function ExpenseForm({ initial, onClose, onSave }) {
  const [name,      setName]      = useState(initial?.name      || '');
  const [amount,    setAmount]    = useState(initial?.amount    ?? '');
  const [category,  setCategory]  = useState(initial?.category  || 'rent');
  const [startDate, setStartDate] = useState(initial?.startDate || toIso(startOfMonth(new Date())));
  const [endDate,   setEndDate]   = useState(initial?.endDate   || '');
  const [saving,    setSaving]    = useState(false);

  async function submit() {
    if (!name.trim() || amount === '' || Number.isNaN(Number(amount))) return;
    setSaving(true);
    try {
      await onSave({
        type:      'fixed_expense',
        name:      name.trim(),
        amount:    Number(amount),
        currency:  CURRENCY,
        category,
        startDate,
        endDate:   endDate || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initial ? 'Редактировать расход' : 'Добавить постоянный расход'}
      onClose={onClose}
      onSave={submit}
      saving={saving}
    >
      <div className="form-group">
        <label>Название</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Аренда, ФОТ, и т.д." autoFocus />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Сумма в месяц</label>
          <input type="number" step="1" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="1500" />
        </div>
        <div className="form-group">
          <label>Категория</label>
          <select value={category} onChange={e => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map(c => (
              <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>С даты</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>По дату (опционально)</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ── Settings modal: revenue list + expenses list ─────────────────────────────

export default function SettingsModal({ revenueEntries, expenses, onClose, onCreate, onUpdate, onDelete, showToast }) {
  const [revenueForm, setRevenueForm] = useState(null);
  const [expenseForm, setExpenseForm] = useState(null);

  async function saveRevenue(data) {
    if (revenueForm?.initial) {
      await onUpdate(revenueForm.initial.id, data);
      showToast('Выручка обновлена');
    } else {
      await onCreate(data);
      showToast('Выручка добавлена');
    }
  }

  async function saveExpense(data) {
    if (expenseForm?.initial) {
      await onUpdate(expenseForm.initial.id, data);
      showToast('Расход обновлён');
    } else {
      await onCreate(data);
      showToast('Расход добавлен');
    }
  }

  async function removeRevenue(r) {
    if (!confirm(`Удалить запись «${fmtMoney(r.amount)} от ${r.date}»?`)) return;
    await onDelete(r.id);
    showToast('Запись удалена');
  }

  async function removeExpense(e) {
    if (!confirm(`Удалить расход «${e.name}»?`)) return;
    await onDelete(e.id);
    showToast('Расход удалён');
  }

  const sortedRevenue  = [...revenueEntries].sort((a, b) => b.date.localeCompare(a.date));
  const sortedExpenses = [...expenses].sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  return (
    <Modal title="Доходы и постоянные расходы" onClose={onClose}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Выручка (ручной ввод)
      </h3>
      {sortedRevenue.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 12 }}>Записей пока нет.</div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          {sortedRevenue.map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtMoney(r.amount)}</div>
                <div style={{ fontSize: 12, color: 'var(--neutral)' }}>
                  {r.date}{r.note ? ` · ${r.note}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 8px' }} onClick={() => setRevenueForm({ initial: r })}>✎</button>
                <button className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 8px', color: 'var(--danger)' }} onClick={() => removeRevenue(r)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-ghost btn-block" style={{ marginBottom: 24 }} onClick={() => setRevenueForm({ initial: null })}>
        + Добавить выручку
      </button>

      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Постоянные расходы (в месяц)
      </h3>
      {sortedExpenses.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 12 }}>Записей пока нет.</div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          {sortedExpenses.map(e => {
            const cat = CATEGORY_BY_ID[e.category] || CATEGORY_BY_ID.other;
            return (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{cat.icon} {e.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--neutral)' }}>
                    {fmtMoney(e.amount)} / мес · с {e.startDate}{e.endDate ? ` по ${e.endDate}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 8px' }} onClick={() => setExpenseForm({ initial: e })}>✎</button>
                  <button className="btn btn-ghost" style={{ height: 32, fontSize: 12, padding: '0 8px', color: 'var(--danger)' }} onClick={() => removeExpense(e)}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button className="btn btn-ghost btn-block" onClick={() => setExpenseForm({ initial: null })}>
        + Добавить расход
      </button>

      {revenueForm && (
        <RevenueForm
          initial={revenueForm.initial}
          onClose={() => setRevenueForm(null)}
          onSave={saveRevenue}
        />
      )}
      {expenseForm && (
        <ExpenseForm
          initial={expenseForm.initial}
          onClose={() => setExpenseForm(null)}
          onSave={saveExpense}
        />
      )}
    </Modal>
  );
}
