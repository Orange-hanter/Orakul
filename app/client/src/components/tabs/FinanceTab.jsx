import { useState, useMemo } from 'react';
import Modal from '../Modal.jsx';
import {
  computeVenuePnL,
  fixedExpenseInPeriod,
  foodCostColor,
  ebitdaColor,
} from '../../utils/pnl.js';

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

// fixedExpenseInPeriod, computeVenuePnL, foodCostColor, ebitdaColor вынесены
// в src/utils/pnl.js для покрытия unit-тестами (см. tests/pnl.test.mjs).

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

// computeVenuePnL / foodCostColor / ebitdaColor → src/utils/pnl.js (для тестов)

// ── Main tab ─────────────────────────────────────────────────────────────────

export default function FinanceTab({ records, allRecords = [], venues = [], currentVenueId, onCreate, onUpdate, onDelete, showToast }) {
  const [periodId,     setPeriodId]     = useState('this_month');
  const [mode,         setMode]         = useState('single'); // 'single' | 'compare'
  const [settingsOpen, setSettingsOpen] = useState(false);

  const period = useMemo(() => resolvePeriod(periodId), [periodId]);

  // ── Single-venue mode: используем уже отфильтрованные records ───────────

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

  const pnl = useMemo(() => computeVenuePnL(records, period), [records, period]);
  const { revenue: revenueInPeriod, variableCosts: variableCostsInPeriod,
          fixedByCategory, fixedTotal, grossProfit, ebitda,
          foodCostPct, grossMarginPct, ebitdaPct } = pnl;

  function ebitdaAccent()   { return ebitdaColor(ebitda); }
  function foodCostAccent() { return foodCostColor(foodCostPct); }

  async function handleCreate(data) { return onCreate(data); }
  async function handleUpdate(id, data) { return onUpdate(id, data); }
  async function handleDelete(id) { return onDelete(id); }

  const hasAnyData = revenueEntries.length > 0 || fixedExpenses.length > 0 || receivedOrders.length > 0;

  // ── Compare-venues mode: считаем P&L для каждой точки ────────────────────

  const pnlByVenue = useMemo(() => {
    if (mode !== 'compare') return [];
    return venues.map(v => {
      const venueRecords = allRecords.filter(r => r.venueId === v.id);
      return { venue: v, pnl: computeVenuePnL(venueRecords, period) };
    });
  }, [mode, venues, allRecords, period]);

  const networkTotals = useMemo(() => {
    if (mode !== 'compare') return null;
    const totals = pnlByVenue.reduce((acc, x) => ({
      revenue:       acc.revenue       + x.pnl.revenue,
      variableCosts: acc.variableCosts + x.pnl.variableCosts,
      fixedTotal:    acc.fixedTotal    + x.pnl.fixedTotal,
      grossProfit:   acc.grossProfit   + x.pnl.grossProfit,
      ebitda:        acc.ebitda        + x.pnl.ebitda,
    }), { revenue: 0, variableCosts: 0, fixedTotal: 0, grossProfit: 0, ebitda: 0 });
    return {
      ...totals,
      foodCostPct:    totals.revenue > 0 ? (totals.variableCosts / totals.revenue) * 100 : null,
      grossMarginPct: totals.revenue > 0 ? (totals.grossProfit   / totals.revenue) * 100 : null,
      ebitdaPct:      totals.revenue > 0 ? (totals.ebitda        / totals.revenue) * 100 : null,
    };
  }, [mode, pnlByVenue]);

  const canCompare = venues.length >= 2;

  return (
    <>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid #e2e8f0' }}>
        {canCompare && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`btn ${mode === 'single' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1, height: 36, fontSize: 13 }}
              onClick={() => setMode('single')}
            >
              Одна точка
            </button>
            <button
              className={`btn ${mode === 'compare' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1, height: 36, fontSize: 13 }}
              onClick={() => setMode('compare')}
            >
              Сравнение ({venues.length})
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={periodId}
            onChange={e => setPeriodId(e.target.value)}
            style={{ flex: 1, height: 40 }}
          >
            {PERIODS.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          {mode === 'single' && (
            <button
              className="btn btn-ghost"
              style={{ height: 40, padding: '0 14px' }}
              onClick={() => setSettingsOpen(true)}
            >
              ⚙ Доходы / расходы
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: 16, paddingBottom: 100 }}>
        <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 12 }}>
          {period.label}
        </div>

        {mode === 'single' && (
          !hasAnyData ? (
            <div className="empty">
              <div className="empty-icon">📈</div>
              <p>Финансовых данных пока нет</p>
              <small>Добавьте выручку и постоянные расходы через «⚙ Доходы / расходы»</small>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
                <KpiCard label="Выручка"        value={fmtMoney(revenueInPeriod)} />
                <KpiCard label="Food Cost %"    value={fmtPct(foodCostPct)}    sub="≤ 32% — норма" accent={foodCostAccent()} />
                <KpiCard label="Валовая маржа"  value={fmtPct(grossMarginPct)} sub={`${fmtMoney(grossProfit)} BYN`} />
                <KpiCard label="EBITDA"         value={fmtMoney(ebitda)}       sub={fmtPct(ebitdaPct)} accent={ebitdaAccent()} />
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
          )
        )}

        {mode === 'compare' && (
          <CompareView pnlByVenue={pnlByVenue} totals={networkTotals} />
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

// ── Compare view ─────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { id: 'name',        label: 'По названию (А→Я)',    dir:  1, key: x => x.venue.name },
  { id: 'revenue',     label: 'По выручке ↓',          dir: -1, key: x => x.pnl.revenue },
  { id: 'foodCostPct', label: 'По Food Cost % ↓',      dir: -1, key: x => x.pnl.foodCostPct ?? -Infinity },
  { id: 'ebitda',      label: 'По EBITDA ↓',           dir: -1, key: x => x.pnl.ebitda },
  { id: 'ebitdaPct',   label: 'По EBITDA % ↓',         dir: -1, key: x => x.pnl.ebitdaPct ?? -Infinity },
];

function CompareView({ pnlByVenue, totals }) {
  const [sortId, setSortId] = useState('name');

  if (pnlByVenue.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">🏪</div>
        <p>Нет точек для сравнения</p>
        <small>Добавьте вторую точку в селекторе сверху</small>
      </div>
    );
  }

  const sortOption = SORT_OPTIONS.find(s => s.id === sortId) || SORT_OPTIONS[0];
  const sorted = [...pnlByVenue].sort((a, b) => {
    const ka = sortOption.key(a);
    const kb = sortOption.key(b);
    if (typeof ka === 'string') return ka.localeCompare(kb, 'ru') * sortOption.dir;
    return ((ka || 0) - (kb || 0)) * sortOption.dir;
  });

  const worstFoodCost = Math.max(...sorted
    .map(x => x.pnl.foodCostPct)
    .filter(v => v !== null && Number.isFinite(v))
  );

  const negativeEbitda = sorted.filter(x => x.pnl.ebitda < 0);

  // Метрики строк
  const metrics = [
    { key: 'revenue',        label: 'Выручка',         fmt: v => fmtMoney(v) },
    { key: 'variableCosts',  label: 'Себестоимость',   fmt: v => fmtMoney(v) },
    { key: 'foodCostPct',    label: 'Food Cost %',     fmt: v => fmtPct(v), color: foodCostColor },
    { key: 'grossProfit',    label: 'Валовая прибыль', fmt: v => fmtMoney(v), color: ebitdaColor },
    { key: 'grossMarginPct', label: 'Валовая маржа %', fmt: v => fmtPct(v) },
    { key: 'fixedTotal',     label: 'Постоянные',      fmt: v => fmtMoney(v) },
    { key: 'ebitda',         label: 'EBITDA',          fmt: v => fmtMoney(v), color: ebitdaColor, bold: true },
    { key: 'ebitdaPct',      label: 'EBITDA %',        fmt: v => fmtPct(v),  color: ebitdaColor, bold: true },
  ];

  // Стиль для sticky-ячейки. boxShadow создаёт «занавес» между sticky и
  // прокручиваемой областью — без него граница теряется при горизонтальном
  // скролле под некоторыми браузерными движками.
  const stickyShadow = '2px 0 0 -1px var(--border), 8px 0 8px -8px rgba(15,23,42,0.12)';

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
          Сортировка
        </span>
        <select
          value={sortId}
          onChange={e => setSortId(e.target.value)}
          style={{ flex: 1, maxWidth: 240, height: 36, fontSize: 13 }}
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 100 + sorted.length * 120 + 110 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, zIndex: 2, background: '#f8fafc', padding: '10px 12px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: 'var(--neutral)', textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 130, boxShadow: stickyShadow }}>
                Метрика
              </th>
              {sorted.map(x => (
                <th key={x.venue.id} style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, minWidth: 110, background: '#f8fafc' }}>
                  {x.venue.name}
                </th>
              ))}
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, background: '#eff6ff', minWidth: 110 }}>
                Σ Сеть
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => (
              <tr key={m.key} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff', padding: '8px 12px', fontWeight: m.bold ? 700 : 500, color: m.bold ? 'var(--primary)' : '#374151', boxShadow: stickyShadow }}>
                  {m.label}
                </td>
                {sorted.map(x => {
                  const value = x.pnl[m.key];
                  const color = m.color ? m.color(value) : null;
                  return (
                    <td key={x.venue.id} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: m.bold ? 700 : 500, color: color || (m.bold ? 'var(--primary)' : '#374151') }}>
                      {m.fmt(value)}
                    </td>
                  );
                })}
                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, background: '#eff6ff', color: m.color ? m.color(totals?.[m.key]) || 'var(--primary)' : 'var(--primary)' }}>
                  {m.fmt(totals?.[m.key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(worstFoodCost > 38 || negativeEbitda.length > 0) && (
        <div style={{ marginTop: 16 }}>
          {sorted
            .filter(x => x.pnl.foodCostPct !== null && x.pnl.foodCostPct > 38)
            .map(x => (
              <div key={`fc-${x.venue.id}`} style={{ padding: 12, background: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#b91c1c', marginBottom: 8 }}>
                🔴 <strong>{x.venue.name}</strong>: Food Cost {fmtPct(x.pnl.foodCostPct)} — выше нормы (порог 38%)
              </div>
            ))}
          {negativeEbitda.map(x => (
            <div key={`eb-${x.venue.id}`} style={{ padding: 12, background: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#b91c1c', marginBottom: 8 }}>
              🔴 <strong>{x.venue.name}</strong>: EBITDA отрицательная ({fmtMoney(x.pnl.ebitda)})
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, padding: 12, background: '#fef9c3', borderRadius: 8, fontSize: 12, color: '#854d0e' }}>
        💡 Σ Сеть — суммы по точкам; проценты пересчитаны от сетевой выручки (взвешенное среднее). Прокрутите таблицу горизонтально, если точек много.
      </div>
    </>
  );
}
