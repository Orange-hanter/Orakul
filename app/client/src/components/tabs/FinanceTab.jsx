import { useState, useMemo } from 'react';
import {
  computeVenuePnL,
  foodCostColor,
  ebitdaColor,
} from '../../utils/pnl.js';
import SettingsModal, { CATEGORY_BY_ID } from './finance/SettingsModal.jsx';
import CompareView from './finance/CompareView.jsx';
import ABCMenuCard from './finance/ABCMenuCard.jsx';

const CURRENCY = 'BYN';
const DAY_MS   = 86_400_000;
// EXPENSE_CATEGORIES + CATEGORY_BY_ID живут в finance/SettingsModal.jsx
// (re-export CATEGORY_BY_ID для рендера категорий в P&L breakdown).

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
                <KpiCard label="Валовая маржа"  value={fmtPct(grossMarginPct)} sub={fmtMoney(grossProfit)} />
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

              <ABCMenuCard
                dishes={records.filter(r => r.type === 'dish')}
                sales={records.filter(r => r.type === 'dish_sale')}
                supplierItems={records.filter(r => r.type === 'supplier_item')}
                suppliers={records.filter(r => r.type === 'supplier')}
                period={period}
              />
            </>
          )
        )}

        {mode === 'compare' && (
          <CompareView pnlByVenue={pnlByVenue} totals={networkTotals} />
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
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

