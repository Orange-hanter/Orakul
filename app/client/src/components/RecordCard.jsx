const KPI_NAMES = {
  'BIZ-01': '% списаний к обороту',
  'BIZ-02': 'Отклонение закупок',
  'BIZ-03': 'Маржинальность меню',
  'BIZ-04': 'Часы на учёт (нед.)',
  'BIZ-05': 'Точность прогноза (MAPE)',
  'NSM-01': 'Принятие рекомендаций',
  'PROD-05': 'NPS',
};

const STATUS_LABELS = {
  pending:     '⏳ Ожидание',
  in_progress: '🔄 В работе',
  blocked:     '🚫 Блокер',
  review:      '👁 Ревью',
  done:        '✅ Готово',
  cancelled:   '✕ Отменено',
};

const CAT_LABELS = {
  positive: '👍 Позитив',
  negative: '👎 Проблема',
  neutral:  '📝 Нейтрально',
};

function fmt(date) {
  return new Date(date).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function KpiCard({ r, onClick, onDelete }) {
  const kpiName = KPI_NAMES[r.kpiId] || r.kpiId;
  const hasBoth = r.value !== '' && r.baseline !== '' && r.baseline != null;
  const delta   = hasBoth ? +(r.value - r.baseline).toFixed(2) : null;
  // For most KPIs: lower is better (% losses, MAPE, hours). For NSM-01, NPS, BIZ-03: higher is better.
  const higherIsBetter = ['NSM-01', 'PROD-05', 'BIZ-03'].includes(r.kpiId);
  const deltaClass = delta === null ? '' : (delta === 0 ? 'delta-neu' : (delta < 0 === !higherIsBetter ? 'delta-pos' : 'delta-neg'));
  const deltaSign  = delta > 0 ? '+' : '';

  return (
    <div className="card" onClick={onClick}>
      <div className="card-header">
        <div>
          <div className="card-date">{fmt(r.date)} · {r.pilotPoint || '—'}</div>
          <div className="card-title">{kpiName}</div>
        </div>
        <button className="card-delete" onClick={e => { e.stopPropagation(); onDelete(); }}>🗑</button>
      </div>
      <div className="card-body">
        <div className="kpi-row">
          <span className="kpi-value">{r.value ?? '—'}</span>
          <span className="kpi-unit">{r.unit}</span>
          {delta !== null && (
            <span className={deltaClass}>{deltaSign}{delta} vs {r.baseline}</span>
          )}
        </div>
        {r.notes && <div style={{ marginTop: 6, fontSize: 13, color: '#64748b' }}>{r.notes}</div>}
      </div>
      <div className="card-footer">
        <span className="badge badge-kpi">{r.kpiId}</span>
      </div>
    </div>
  );
}

function ObservationCard({ r, onClick, onDelete }) {
  return (
    <div className="card" onClick={onClick}>
      <div className="card-header">
        <div>
          <div className="card-date">{fmt(r.date)} · {r.author || '—'}</div>
        </div>
        <button className="card-delete" onClick={e => { e.stopPropagation(); onDelete(); }}>🗑</button>
      </div>
      <div className="card-body" style={{ fontSize: 14 }}>{r.text}</div>
      <div className="card-footer">
        <span className={`badge badge-${r.category}`}>{CAT_LABELS[r.category]}</span>
      </div>
    </div>
  );
}

function TaskCard({ r, onClick, onDelete }) {
  return (
    <div className="card" onClick={onClick}>
      <div className="card-header">
        <div>
          <div className="card-date">{fmt(r.date)}</div>
          <div className="card-title">{r.taskId}</div>
        </div>
        <button className="card-delete" onClick={e => { e.stopPropagation(); onDelete(); }}>🗑</button>
      </div>
      {r.taskName && <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>{r.taskName}</div>}
      {r.comment && <div className="card-body">{r.comment}</div>}
      <div className="card-footer">
        <span className={`badge badge-${r.status}`}>{STATUS_LABELS[r.status]}</span>
      </div>
    </div>
  );
}

export default function RecordCard({ record, onClick, onDelete }) {
  if (record.type === 'kpi')  return <KpiCard         r={record} onClick={onClick} onDelete={onDelete} />;
  if (record.type === 'obs')  return <ObservationCard r={record} onClick={onClick} onDelete={onDelete} />;
  if (record.type === 'task') return <TaskCard        r={record} onClick={onClick} onDelete={onDelete} />;
  return null;
}

export { KPI_NAMES, STATUS_LABELS, CAT_LABELS };
