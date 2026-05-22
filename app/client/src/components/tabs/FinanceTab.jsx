import { useState, useMemo } from 'react';
import Modal from '../Modal.jsx';

const CURRENCY = 'BYN';
const DAY_MS   = 86_400_000;

const EXPENSE_CATEGORIES = [
  { id: 'rent',      label: 'Аренда',      icon: '🏠' },
  { id: 'payroll',   label: 'ФОТ',         icon: '👥' },
  { id: 'utilities', label: 'Коммунальные', icon: '💡' },
  { id: 'marketing', label: 'Маркетинг',   icon: '📣' },
  { id: 'other',     label: 'Прочее',      icon: '📋' },
];

const CATEGORY_BY_ID = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.id, c]));

// ── Date helpers ─────────────────────────────────────────────────────────────

function toIso(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1); x.setHours(0, 0, 0, 0);
  return x;
}

function endOfMonth(d) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1, 1);
  x.setHours(0, 0, 0, 0);
  return new Date(x.getTime() - 1);
}

function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function fmtMonth(d) {
  return new Date(d).toLocaleDateString('ru', { month: 'long', year: 'numeric' });
}

// ── Period selector ──────────────────────────────────────────────────────────

const PERIODS = [
  { id: 'this_month', label: 'Этот месяц' },
  { id: 'last_month', label: 'Прошлый месяц' },
  { id: 'd7',         label: '7 дней' },
  { id: 'd30',        label: '30 дней' },
];

function resolvePeriod(id) {
  const now = new Date();
  switch (id) {
    case 'this_month': return { start: startOfMonth(now), end: endOfMonth(now), label: fmtMonth(now) };
    case 'last_month': {
      const prev = addMonths(now, -1);
      return { start: startOfMonth(prev), end: endOfMonth(prev), label: fmtMonth(prev) };
    }
    case 'd7':  return { start: new Date(Date.now() - 7  * DAY_MS), end: now, label: 'Последние 7 дней' };
    case 'd30': return { start: new Date(Date.now() - 30 * DAY_MS), end: now, label: 'Последние 30 дней' };
    default:    return { start: startOfMonth(now), end: endOfMonth(now), label: fmtMonth(now) };
  }
}

// ── Math ─────────────────────────────────────────────────────────────────────

function fmtMoney(n, currency = CURRENCY) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${Math.round(Number(n)).toLocaleString('ru')} ${currency}`;
}

function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

// Считаем долю расхода, попадающую в период.
// Помесячная сумма пропорционально дням пересечения.
function fixedExpenseInPeriod(expense, start, end) {
  const expStart = expense.startDate ? new Date(expense.startDate) : new Date(0);
  const expEnd   = expense.endDate   ? new Date(expense.endDate)   : new Date('2099-12-31');
  const periodStart = start > expStart ? start : expStart;
  const periodEnd   = end   < expEnd   ? end   : expEnd;
  if (periodEnd < periodStart) return 0;
  const days = (periodEnd.getTime() - periodStart.getTime()) / DAY_MS + 1;
  // 30 дней — стандартный месяц для пропорции (для месяцев с 28/31 это даёт ±5%, для MVP приемлемо)
  return (Number(expense.amount) || 0) * (days / 30);
}

// ── Settings modal (revenue list + expenses list) ────────────────────────────

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

function SettingsView({ revenueEntries, expenses, onClose, onCreate, onUpdate, onDelete, showToast }) {
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

  const sortedRevenue = [...revenueEntries].sort((a, b) => b.date.localeCompare(a.date));
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
                <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtMoney(r.amount, r.currency)}</div>
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
      <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 24 }} onClick={() => setRevenueForm({ initial: null })}>
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
                    {fmtMoney(e.amount, e.currency)} / мес · с {e.startDate}{e.endDate ? ` по ${e.endDate}` : ''}
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
      <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => setExpenseForm({ initial: null })}>
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

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }) {
  return (
    <div className="card" style={{ flex: '1 1 calc(50% - 8px)', minWidth: 140 }}>
      <div style={{ fontSize: 11, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: accent || 'var(--primary)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--neutral)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── P&L row ──────────────────────────────────────────────────────────────────

function Row({ label, value, indent = 0, bold = false, separator = false, accent }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      padding: '8px 0',
      paddingLeft: indent * 16,
      borderBottom: separator ? '1.5px solid #e2e8f0' : '1px solid #f1f5f9',
      fontSize: bold ? 15 : 14,
      fontWeight: bold ? 700 : 500,
      color: accent || (bold ? 'var(--primary)' : '#374151'),
    }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────────

export default function FinanceTab({ records, onCreate, onUpdate, onDelete, showToast }) {
  const [periodId,     setPeriodId]     = useState('this_month');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const period = useMemo(() => resolvePeriod(periodId), [periodId]);

  const revenueEntries = useMemo(
    () => records.filter(r => r.type === 'revenue_entry'),
    [records]
  );

  const fixedExpenses = useMemo(
    () => records.filter(r => r.type === 'fixed_expense'),
    [records]
  );

  const receivedOrders = useMemo(
    () => records.filter(r => r.type === 'order' && r.status === 'received'),
    [records]
  );

  // ── Aggregations for selected period ─────────────────────────────────────

  const revenueInPeriod = useMemo(() => {
    const start = period.start.getTime();
    const end   = period.end.getTime();
    return revenueEntries
      .filter(r => {
        const d = new Date(r.date).getTime();
        return d >= start && d <= end;
      })
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }, [revenueEntries, period]);

  const variableCostsInPeriod = useMemo(() => {
    const start = period.start.getTime();
    const end   = period.end.getTime();
    return receivedOrders
      .filter(o => {
        const ts = o.receivedAt || o.updatedAt || o.createdAt;
        return ts >= start && ts <= end;
      })
      .reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
  }, [receivedOrders, period]);

  const fixedByCategory = useMemo(() => {
    const acc = {};
    fixedExpenses.forEach(e => {
      const amount = fixedExpenseInPeriod(e, period.start, period.end);
      if (amount <= 0) return;
      const catId = e.category || 'other';
      if (!acc[catId]) acc[catId] = { id: catId, total: 0, items: [] };
      acc[catId].total += amount;
      acc[catId].items.push({ name: e.name, amount });
    });
    return Object.values(acc).sort((a, b) => b.total - a.total);
  }, [fixedExpenses, period]);

  const fixedTotal  = fixedByCategory.reduce((s, c) => s + c.total, 0);
  const grossProfit = revenueInPeriod - variableCostsInPeriod;
  const ebitda      = grossProfit - fixedTotal;

  const foodCostPct   = revenueInPeriod > 0 ? (variableCostsInPeriod / revenueInPeriod) * 100 : null;
  const grossMarginPct = revenueInPeriod > 0 ? (grossProfit         / revenueInPeriod) * 100 : null;
  const ebitdaPct      = revenueInPeriod > 0 ? (ebitda              / revenueInPeriod) * 100 : null;

  function ebitdaAccent() {
    if (ebitda > 0) return 'var(--success)';
    if (ebitda < 0) return 'var(--danger)';
    return null;
  }

  function foodCostAccent() {
    if (foodCostPct === null) return null;
    if (foodCostPct > 38)     return 'var(--danger)';
    if (foodCostPct > 32)     return '#b45309';
    return 'var(--success)';
  }

  async function handleCreate(data) { return onCreate(data); }
  async function handleUpdate(id, data) { return onUpdate(id, data); }
  async function handleDelete(id) { return onDelete(id); }

  const hasAnyData = revenueEntries.length > 0 || fixedExpenses.length > 0 || receivedOrders.length > 0;

  return (
    <>
      <div style={{ padding: '12px 16px', display: 'flex', gap: 8, borderBottom: '1px solid #e2e8f0' }}>
        <select
          value={periodId}
          onChange={e => setPeriodId(e.target.value)}
          style={{ flex: 1, height: 40 }}
        >
          {PERIODS.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <button
          className="btn btn-ghost"
          style={{ height: 40, padding: '0 14px' }}
          onClick={() => setSettingsOpen(true)}
        >
          ⚙ Доходы / расходы
        </button>
      </div>

      <div style={{ padding: 16, paddingBottom: 100 }}>
        <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 12 }}>
          {period.label}
        </div>

        {!hasAnyData ? (
          <div className="empty">
            <div className="empty-icon">📈</div>
            <p>Финансовых данных пока нет</p>
            <small>Добавьте выручку и постоянные расходы через «⚙ Доходы / расходы»</small>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
              <KpiCard
                label="Выручка"
                value={fmtMoney(revenueInPeriod)}
              />
              <KpiCard
                label="Food Cost %"
                value={fmtPct(foodCostPct)}
                sub="≤ 32% — норма"
                accent={foodCostAccent()}
              />
              <KpiCard
                label="Валовая маржа"
                value={fmtPct(grossMarginPct)}
                sub={`${fmtMoney(grossProfit)} BYN`}
              />
              <KpiCard
                label="EBITDA"
                value={fmtMoney(ebitda)}
                sub={fmtPct(ebitdaPct)}
                accent={ebitdaAccent()}
              />
            </div>

            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Отчёт P&L
              </h3>

              <Row label="Выручка (ручной ввод)"  value={fmtMoney(revenueInPeriod)} indent={1} />
              <Row label="ИТОГО ВЫРУЧКА"          value={fmtMoney(revenueInPeriod)} bold separator />

              <Row label="Закупки (принятые заявки)" value={fmtMoney(variableCostsInPeriod)} indent={1} />
              <Row label="ИТОГО СЕБЕСТОИМОСТЬ"      value={fmtMoney(variableCostsInPeriod)} bold />
              <Row label="Food Cost %"               value={fmtPct(foodCostPct)} indent={1} accent={foodCostAccent()} separator />

              <Row label="ВАЛОВАЯ ПРИБЫЛЬ"  value={fmtMoney(grossProfit)} bold accent={grossProfit > 0 ? 'var(--success)' : 'var(--danger)'} />
              <Row label="Валовая маржа %"  value={fmtPct(grossMarginPct)} indent={1} separator />

              {fixedByCategory.map(c => {
                const meta = CATEGORY_BY_ID[c.id] || CATEGORY_BY_ID.other;
                return (
                  <Row key={c.id} label={`${meta.icon} ${meta.label}`} value={fmtMoney(c.total)} indent={1} />
                );
              })}
              {fixedByCategory.length === 0 && (
                <Row label="Постоянных расходов нет" value="—" indent={1} />
              )}
              <Row label="ИТОГО ПОСТОЯННЫЕ РАСХОДЫ" value={fmtMoney(fixedTotal)} bold separator />

              <Row label="EBITDA (операц. прибыль)" value={fmtMoney(ebitda)} bold accent={ebitdaAccent()} />
              <Row label="EBITDA %"                  value={fmtPct(ebitdaPct)} indent={1} accent={ebitdaAccent()} />
            </div>

            <div style={{ marginTop: 16, padding: 12, background: '#fef9c3', borderRadius: 8, fontSize: 12, color: '#854d0e' }}>
              💡 Себестоимость считается из заявок в статусе «Принята» в выбранном периоде. Постоянные расходы — пропорционально дням периода (30 дней = месячная сумма).
            </div>
          </>
        )}
      </div>

      {settingsOpen && (
        <SettingsView
          revenueEntries={revenueEntries}
          expenses={fixedExpenses}
          onClose={() => setSettingsOpen(false)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          showToast={showToast}
        />
      )}
    </>
  );
}
