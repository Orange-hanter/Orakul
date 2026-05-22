import { useMemo } from 'react';
import { nplural } from '../../utils/plural.js';
import { DAY_MS, daysBetween } from '../../utils/time.js';
import AuditCard from '../AuditCard.jsx';
import TelegramCard from '../data/TelegramCard.jsx';
import IntegrationsCard from '../data/IntegrationsCard.jsx';
import ExportImportCard from '../data/ExportImportCard.jsx';

function calcDaysLeft(productId, stockEntries, current) {
  if (!current || current <= 0) return 0;
  const cutoff = Date.now() - 14 * DAY_MS;
  const outflow = stockEntries
    .filter(e => e.productId === productId && e.createdAt >= cutoff && e.delta !== null)
    .filter(e => e.kind === 'writeoff' || (e.kind === 'inventory' && e.delta < 0))
    .reduce((sum, e) => sum + Math.abs(e.delta), 0);
  if (outflow === 0) return null;
  return Math.round(current / (outflow / 14));
}

function pct(n, total) {
  return total ? Math.round((n / total) * 100) : 0;
}

export default function DataTab({ records, venues = [], onReload, showToast }) {
  // ── KPI calculations ────────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const dishes      = records.filter(r => r.type === 'dish');
    const activeStops = records.filter(r => r.type === 'stop' && r.active);
    const allStops    = records.filter(r => r.type === 'stop');
    const products    = records.filter(r => r.type === 'product');
    const stockEntries = records.filter(r => r.type === 'stock_entry');

    const dishesWithRecipe = dishes.filter(d => (d.ingredients || []).length > 0);
    const recipePct = dishes.length ? pct(dishesWithRecipe.length, dishes.length) : 0;

    // Stop frequency per dish (last 30 days)
    const cutoff = Date.now() - 30 * DAY_MS;
    const recentStops = allStops.filter(s => s.createdAt >= cutoff);
    const freq = {};
    recentStops.forEach(s => { freq[s.dishName] = (freq[s.dishName] || 0) + 1; });
    const topStops = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Menu availability
    const activeDishes    = dishes.filter(d => d.active !== false).length;
    const stoppedDishIds  = new Set(activeStops.map(s => s.dishId));
    const availableDishes = dishes.filter(d => d.active !== false && !stoppedDishIds.has(d.id)).length;
    const availability    = activeDishes ? pct(availableDishes, activeDishes) : 100;

    // Stock freshness
    const lastStockTs  = stockEntries.length ? Math.max(...stockEntries.map(e => e.createdAt)) : null;
    const stockAgeDays = lastStockTs ? daysBetween(lastStockTs) : null;

    // Products with no recent data (>2 days). Avoid inner sort per product:
    // build a Map<productId, latestTs> in one pass.
    const lastTsByProduct = new Map();
    for (const e of stockEntries) {
      const cur = lastTsByProduct.get(e.productId);
      if (cur === undefined || cur < e.createdAt) lastTsByProduct.set(e.productId, e.createdAt);
    }
    const staleProducts = products.filter(p => {
      const ts = lastTsByProduct.get(p.id);
      return ts === undefined || daysBetween(ts) > 2;
    });

    // Average stops per day (last 7 days)
    const week    = Date.now() - 7 * DAY_MS;
    const weekStops = allStops.filter(s => s.createdAt >= week).length;
    const avgStopsPerDay = (weekStops / 7).toFixed(1);

    // Days-to-depletion alerts. Reuse latest-entry map.
    const entryByProduct = new Map();
    stockEntries.forEach(e => {
      const cur = entryByProduct.get(e.productId);
      if (!cur || cur.createdAt < e.createdAt) entryByProduct.set(e.productId, e);
    });
    const depletionAlerts = products
      .map(p => {
        const last = entryByProduct.get(p.id);
        if (!last) return null;
        const days = calcDaysLeft(p.id, stockEntries, last.resulting);
        if (days === null || days > 4) return null;
        return { p, days, current: last.resulting };
      })
      .filter(Boolean)
      .sort((a, b) => a.days - b.days);

    // Telegram chats
    const telegramChats = records.filter(r => r.type === 'telegram_chat');

    return { activeStops, topStops, availability, availableDishes, activeDishes, lastStockTs, stockAgeDays, staleProducts, products, avgStopsPerDay, allStops, dishes, dishesWithRecipe, recipePct, depletionAlerts, telegramChats };
  }, [records]);

  const { activeStops, topStops, availability, availableDishes, activeDishes, stockAgeDays, staleProducts, products, avgStopsPerDay, allStops, dishes, dishesWithRecipe, recipePct, depletionAlerts, telegramChats } = metrics;

  return (
    <>
      {/* ── Depletion alerts ── */}
      {depletionAlerts.length > 0 && (
        <div className="export-card depletion-card">
          <h3>⚠️ Скоро закончится</h3>
          <div className="depletion-list">
            {depletionAlerts.map(({ p, days, current }) => (
              <div key={p.id} className={`depletion-row ${days <= 1 ? 'critical' : days <= 3 ? 'warn' : 'ok'}`}>
                <div className="depletion-name">{p.name}</div>
                <div className="depletion-right">
                  <span className="depletion-stock">{current} {p.unit}</span>
                  <span className={`days-badge ${days <= 1 ? 'days-critical' : days <= 3 ? 'days-warn' : 'days-ok'}`}>
                    {days === 0 ? 'кончается' : `~${days} дн.`}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--neutral)', marginTop: 10 }}>
            На основе списаний за последние 14 дней
          </div>
        </div>
      )}

      {/* ── KPI: Menu availability ── */}
      <div className="export-card">
        <h3>📋 Доступность меню</h3>
        <div className="stat-grid">
          <div className="stat-item">
            <div className="stat-value" style={{ color: availability >= 90 ? 'var(--success)' : availability >= 70 ? 'var(--warning)' : 'var(--danger)' }}>
              {availability}%
            </div>
            <div className="stat-label">Доступно</div>
          </div>
          <div className="stat-item">
            <div className="stat-value" style={{ color: activeStops.length > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {activeStops.length}
            </div>
            <div className="stat-label">Активных стопов</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{activeDishes}</div>
            <div className="stat-label">Блюд в меню</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--neutral)' }}>
          Доступно блюд: {availableDishes} из {activeDishes}
        </div>
      </div>

      {/* ── KPI: Stop frequency ── */}
      <div className="export-card">
        <h3>🚫 Частота стопов</h3>
        <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 14 }}>
          <div className="stat-item">
            <div className="stat-value">{allStops.length}</div>
            <div className="stat-label">Всего стопов</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{avgStopsPerDay}</div>
            <div className="stat-label">Стопов/день (нед.)</div>
          </div>
        </div>
        {topStops.length > 0 && (
          <>
            <div className="section-label" style={{ marginBottom: 10 }}>Топ остановок за 30 дней</div>
            <ul className="top-list">
              {topStops.map((item, i) => (
                <li key={item.name} className="top-item">
                  <span className="top-rank">{['🥇','🥈','🥉','4️⃣','5️⃣'][i]}</span>
                  <span className="top-name">{item.name}</span>
                  <span className="top-count">{item.count} ×</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {topStops.length === 0 && (
          <div style={{ fontSize: 14, color: 'var(--neutral)' }}>Нет данных за последние 30 дней</div>
        )}
      </div>

      {/* ── KPI: Stock freshness ── */}
      <div className="export-card">
        <h3>📦 Актуальность склада</h3>
        <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="stat-item">
            <div className="stat-value" style={{ color: stockAgeDays === null ? 'var(--neutral)' : stockAgeDays === 0 ? 'var(--success)' : stockAgeDays <= 1 ? 'var(--warning)' : 'var(--danger)' }}>
              {stockAgeDays === null ? '—' : stockAgeDays === 0 ? 'Сегодня' : `${stockAgeDays} дн.`}
            </div>
            <div className="stat-label">Последний учёт</div>
          </div>
          <div className="stat-item">
            <div className="stat-value" style={{ color: staleProducts.length > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {staleProducts.length}
            </div>
            <div className="stat-label">Без данных {'>'}2 дней</div>
          </div>
        </div>
        {staleProducts.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--neutral)' }}>
            Устаревшие: {staleProducts.map(p => p.name).join(', ')}
          </div>
        )}
        {products.length === 0 && (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--neutral)' }}>Добавьте продукты во вкладке Склад</div>
        )}
      </div>

      {/* ── KPI: Recipe digitization ── */}
      <div className="export-card">
        <h3>🧬 Оцифровка рецептов</h3>
        <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="stat-item">
            <div className="stat-value" style={{ color: recipePct >= 80 ? 'var(--success)' : recipePct >= 40 ? 'var(--warning)' : 'var(--neutral)' }}>
              {recipePct}%
            </div>
            <div className="stat-label">Покрытие</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{dishesWithRecipe.length}<span style={{ fontSize: 16, color: 'var(--neutral)', fontWeight: 500 }}> / {dishes.length}</span></div>
            <div className="stat-label">Блюд с рецептом</div>
          </div>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${recipePct}%` }} />
        </div>
        {dishes.length > 0 && recipePct < 100 && (
          <div style={{ fontSize: 13, color: 'var(--neutral)', marginTop: 10 }}>
            Осталось: {nplural(dishes.length - dishesWithRecipe.length, ['блюдо', 'блюда', 'блюд'])}. Добавляйте рецепты постепенно — через карточку блюда в меню.
          </div>
        )}
      </div>

      <IntegrationsCard venues={venues} showToast={showToast} />

      <TelegramCard telegramChats={telegramChats} onReload={onReload} showToast={showToast} />

      <ExportImportCard recordCount={records.length} onReload={onReload} showToast={showToast} />

      {/* ── Audit log (O01) ── */}
      <AuditCard showToast={showToast} />

      {/* ── Info ── */}
      <div className="export-card">
        <h3>🔒 Шифрование</h3>
        <p style={{ marginBottom: 0 }}>
          AES-256-GCM · PBKDF2 · 100 000 итераций SHA-256<br />
          Сессия: JWT 24 ч в localStorage
        </p>
      </div>
    </>
  );
}
