import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { PLUGINS } from '../../plugins/index.js';

function calcDaysLeft(productId, stockEntries, current) {
  if (!current || current <= 0) return 0;
  const cutoff = Date.now() - 14 * 86_400_000;
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

function daysBetween(ts) {
  return Math.floor((Date.now() - ts) / 86_400_000);
}

export default function DataTab({ records, venues = [], onReload, showToast }) {
  const fileRef          = useRef();
  const [exporting,      setExporting]      = useState(false);
  const [importing,      setImporting]      = useState(false);
  const [tgSending,      setTgSending]      = useState(false);
  const [tgConfigured,   setTgConfigured]   = useState(null);   // null = loading
  const [tgTokenInput,   setTgTokenInput]   = useState('');
  const [tgTokenTouched, setTgTokenTouched] = useState(false);
  const [tgSavingConfig, setTgSavingConfig] = useState(false);
  const [openPluginId,   setOpenPluginId]   = useState(null);

  // load Telegram config status on mount
  useEffect(() => {
    api.telegram.getConfig()
      .then(({ configured }) => setTgConfigured(configured))
      .catch(() => setTgConfigured(false));
  }, []);

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
    const cutoff = Date.now() - 30 * 86_400_000;
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

    // Products with no recent data (>2 days)
    const staleProducts = products.filter(p => {
      const last = stockEntries.filter(e => e.productId === p.id).sort((a, b) => b.createdAt - a.createdAt)[0];
      return !last || daysBetween(last.createdAt) > 2;
    });

    // Average stops per day (last 7 days)
    const week    = Date.now() - 7 * 86_400_000;
    const weekStops = allStops.filter(s => s.createdAt >= week).length;
    const avgStopsPerDay = (weekStops / 7).toFixed(1);

    // Days-to-depletion alerts
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

  // ── Telegram ────────────────────────────────────────────────────────────────

  const tgTokenValid = /^\d+:[A-Za-z0-9_-]{35,}$/.test(tgTokenInput);
  const tgTokenError = tgTokenTouched && tgTokenInput && !tgTokenValid;

  async function handleTgSaveConfig() {
    setTgTokenTouched(true);
    if (!tgTokenInput.trim() || !tgTokenValid) return;
    setTgSavingConfig(true);
    try {
      await api.telegram.saveConfig(tgTokenInput.trim());
      setTgConfigured(true);
      setTgTokenInput('');
      showToast('Бот подключён ✓');
      await onReload();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setTgSavingConfig(false);
    }
  }

  async function handleTgDeleteConfig() {
    if (!confirm('Отключить Telegram-бота и удалить токен?')) return;
    try {
      await api.telegram.deleteConfig();
      setTgConfigured(false);
      showToast('Токен удалён');
      await onReload();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function handleTgTest() {
    setTgSending(true);
    try {
      await api.telegram.testDigest();
      showToast('Дайджест отправлен во все подключённые чаты ✓');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setTgSending(false);
    }
  }

  async function handleTgRemove(id) {
    try {
      await api.records.remove(id);
      await onReload();
      showToast('Чат отключён');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // ── Export / Import ─────────────────────────────────────────────────────────

  async function handleExport() {
    setExporting(true);
    try {
      await api.export();
      showToast('Файл скачан ✓');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const { count } = await api.import(text);
      showToast(`Импортировано ${count} записей ✓`);
      await onReload();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setImporting(false);
      fileRef.current.value = '';
    }
  }

  const { activeStops, topStops, availability, availableDishes, activeDishes, lastStockTs, stockAgeDays, staleProducts, products, avgStopsPerDay, allStops, dishes, dishesWithRecipe, recipePct, depletionAlerts, telegramChats } = metrics;

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
            Осталось: {dishes.length - dishesWithRecipe.length} блюд. Добавляйте рецепты постепенно — через карточку блюда в меню.
          </div>
        )}
      </div>

      {/* ── Интеграции (плагины) ── */}
      <div className="export-card">
        <h3>🔌 Интеграции</h3>
        <p style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 12 }}>
          Опциональные плагины импорта данных. Каждый можно включать/отключать независимо.
        </p>
        {PLUGINS.map(plugin => (
          <div
            key={plugin.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              marginBottom: 8,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: '#fff',
            }}
          >
            <div style={{ fontSize: 28 }}>{plugin.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{plugin.name}</div>
              <div style={{ fontSize: 12, color: 'var(--neutral)', marginTop: 2 }}>
                {plugin.description}
              </div>
            </div>
            <button
              className="btn btn-ghost"
              style={{ height: 36, padding: '0 12px', fontSize: 13 }}
              onClick={() => setOpenPluginId(plugin.id)}
            >
              Настроить →
            </button>
          </div>
        ))}
      </div>

      {(() => {
        const plugin = PLUGINS.find(p => p.id === openPluginId);
        if (!plugin) return null;
        const SettingsComponent = plugin.SettingsComponent;
        return (
          <SettingsComponent
            venues={venues}
            onClose={() => setOpenPluginId(null)}
            showToast={showToast}
          />
        );
      })()}

      {/* ── Telegram ── */}
      <div className="export-card">
        <h3>✈️ Telegram-уведомления</h3>

        {tgConfigured === null && (
          <div style={{ fontSize: 14, color: 'var(--neutral)' }}>Загрузка…</div>
        )}

        {tgConfigured === false && (
          <div className="tg-setup">
            <p className="tg-setup-hint">
              Подключи бота — и каждый день в 09:00 в выбранные чаты будет приходить дайджест склада.
            </p>
            <ol className="tg-steps">
              <li>Открой <strong>@BotFather</strong> в Telegram → <code>/newbot</code> → скопируй токен</li>
              <li>Вставь токен ниже и нажми «Подключить»</li>
              <li>Напиши своему боту <strong>/start</strong> — чат зарегистрируется автоматически</li>
            </ol>
            <div className="tg-token-form">
              <div>
                <input
                  type="text"
                  placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ"
                  value={tgTokenInput}
                  onChange={e => { setTgTokenInput(e.target.value); }}
                  onBlur={() => setTgTokenTouched(true)}
                  onKeyDown={e => e.key === 'Enter' && handleTgSaveConfig()}
                  className={tgTokenError ? 'input-error' : ''}
                />
                {tgTokenError && (
                  <div className="field-hint error tg-token-hint">Формат: 1234567890:ABCdef… (цифры, двоеточие, минимум 35 символов после)</div>
                )}
              </div>
              <button
                className="btn btn-primary"
                onClick={handleTgSaveConfig}
                disabled={tgSavingConfig}
              >
                {tgSavingConfig ? 'Проверяю…' : 'Подключить'}
              </button>
            </div>
          </div>
        )}

        {tgConfigured === true && (
          <>
            <div className="tg-status">
              <span className="tg-dot" /> Бот подключён
              <button className="tg-remove" style={{ marginLeft: 'auto' }} onClick={handleTgDeleteConfig}>
                Удалить токен
              </button>
            </div>

            {telegramChats.length === 0 ? (
              <div className="tg-empty">
                <p>Нет подключённых чатов.</p>
                <p style={{ fontSize: 13 }}>Напиши боту <strong>/start</strong> в личку или добавь его в группу и напиши <strong>/start</strong>.</p>
              </div>
            ) : (
              <div className="tg-chat-list" style={{ marginTop: 12 }}>
                {telegramChats.map(c => (
                  <div key={c.id} className="tg-chat-row">
                    <span className="tg-chat-name">💬 {c.chatTitle || c.chatId}</span>
                    <button className="tg-remove" onClick={() => handleTgRemove(c.id)}>Отключить</button>
                  </div>
                ))}
              </div>
            )}

            {telegramChats.length > 0 && (
              <>
                <div style={{ height: 12 }} />
                <button className="btn btn-primary" onClick={handleTgTest} disabled={tgSending}>
                  {tgSending ? '…' : '▶ Тестовый дайджест'}
                </button>
              </>
            )}
          </>
        )}

        <div style={{ fontSize: 12, color: 'var(--neutral)', marginTop: 12 }}>
          Дайджест — каждый день в 09:00. Команды: <strong>/digest</strong> — получить сейчас, <strong>/stop</strong> — отключить чат.
        </div>
      </div>

      {/* ── Export / Import ── */}
      <div className="export-card">
        <h3>💾 Резервная копия</h3>
        <p>Скачайте зашифрованный файл с всеми данными. Расшифровка возможна только с мастер-паролем.</p>
        <button className="btn btn-primary" onClick={handleExport} disabled={exporting || records.length === 0}>
          {exporting ? '…' : '⬇ Скачать .enc файл'}
        </button>
        <div style={{ height: 10 }} />
        <input ref={fileRef} type="file" accept=".enc" style={{ display: 'none' }} onChange={handleImport} />
        <button className="btn btn-ghost" onClick={() => fileRef.current.click()} disabled={importing}>
          {importing ? '…' : '⬆ Загрузить из файла'}
        </button>
      </div>

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
