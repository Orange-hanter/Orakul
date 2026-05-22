import { useEffect, useState } from 'react';
import { api } from '../api.js';

/*
 * O01 — журнал операций. Грузим последние 200 записей через /api/audit,
 * показываем компактно: иконка операции + тип + имя + время.
 *
 * Цель: ответ на вопрос «кто/когда удалил этого поставщика» без копания
 * в логах сервера. UI — read-only; ничего не правится отсюда.
 */

const OP_META = {
  create: { icon: '➕', color: 'var(--success)', label: 'создал' },
  update: { icon: '✎',  color: 'var(--accent)',  label: 'изменил' },
  delete: { icon: '✕',  color: 'var(--danger)',  label: 'удалил' },
};

const TYPE_LABEL = {
  product:               'продукт',
  dish:                  'блюдо',
  stop:                  'стоп',
  stock_entry:           'движение склада',
  supplier:              'поставщик',
  supplier_item:         'позиция поставщика',
  supplier_price_history:'история цены',
  dish_sale:             'продажа блюда',
  order:                 'заявка',
  revenue_entry:         'выручка',
  fixed_expense:         'пост. расход',
  venue:                 'точка',
  telegram_chat:         'TG-чат',
  recommendation_action: 'действие по рек.',
};

function relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'только что';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`;
  const d = new Date(ts);
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AuditCard({ showToast }) {
  const [entries, setEntries] = useState(null); // null=loading
  const [filterOp, setFilterOp] = useState('all');
  const [expanded, setExpanded] = useState(false);

  async function load(op = filterOp) {
    setEntries(null);
    try {
      const params = op === 'all' ? {} : { op };
      const data = await api.audit({ limit: 200, ...params });
      setEntries(data);
    } catch (e) {
      showToast?.(e.message, 'error');
      setEntries([]);
    }
  }

  useEffect(() => { if (expanded) load(); /* eslint-disable-next-line */ }, [expanded]);
  useEffect(() => { if (expanded) load(filterOp); /* eslint-disable-next-line */ }, [filterOp]);

  return (
    <div className="export-card">
      <h3>📜 Журнал операций</h3>
      {!expanded ? (
        <>
          <p style={{ marginBottom: 0 }}>История создания/изменения/удаления записей. Помогает разобраться, откуда взялась запись или когда её удалили.</p>
          <button
            className="btn btn-ghost btn-block"
            style={{ marginTop: 10 }}
            onClick={() => setExpanded(true)}
          >
            Показать журнал
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {['all', 'create', 'update', 'delete'].map(op => (
              <button
                key={op}
                type="button"
                className={`btn btn-ghost ${filterOp === op ? 'active' : ''}`}
                style={{
                  height: 28, padding: '0 10px', fontSize: 12,
                  background: filterOp === op ? 'var(--primary)' : undefined,
                  color: filterOp === op ? '#fff' : undefined,
                }}
                onClick={() => setFilterOp(op)}
              >
                {op === 'all' ? 'Все' : op === 'create' ? '➕ Создания' : op === 'update' ? '✎ Изменения' : '✕ Удаления'}
              </button>
            ))}
          </div>

          {entries === null ? (
            <div style={{ fontSize: 13, color: 'var(--neutral)' }}>Загрузка…</div>
          ) : entries.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--neutral)' }}>Журнал пуст</div>
          ) : (
            <div style={{
              maxHeight: 360, overflowY: 'auto',
              border: '1px solid var(--border)', borderRadius: 6,
              background: '#fff',
            }}>
              {entries.map((e, i) => {
                const meta = OP_META[e.op] || OP_META.update;
                const typeLabel = TYPE_LABEL[e.recordType] || e.recordType;
                return (
                  <div key={i} style={{
                    padding: '8px 10px',
                    borderBottom: i < entries.length - 1 ? '1px solid var(--border)' : 'none',
                    fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ color: meta.color, fontWeight: 700, marginRight: 4 }}>{meta.icon}</span>
                        <strong>{meta.label}</strong>{' '}
                        <span style={{ color: 'var(--neutral)' }}>{typeLabel}</span>
                        {e.name && <span style={{ marginLeft: 4 }}>«{e.name}»</span>}
                      </div>
                      <span style={{ color: 'var(--neutral)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {relTime(e.ts)}
                      </span>
                    </div>
                    {e.op === 'update' && Array.isArray(e.changed) && e.changed.length > 0 && (
                      <div style={{ marginTop: 2, color: 'var(--neutral)', fontSize: 11 }}>
                        поля: {e.changed.slice(0, 6).join(', ')}{e.changed.length > 6 ? '…' : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--neutral)' }}>
            Показано последние {entries?.length ?? 0} операций
            {(entries?.length ?? 0) >= 200 && ' (max)'}.
            Для долгой истории — экспорт .enc и `data/audit.jsonl` на сервере.
          </div>
        </>
      )}
    </div>
  );
}
