import { useState } from 'react';
import { PLUGINS } from '../../plugins/index.js';

export default function IntegrationsCard({ venues, showToast }) {
  const [openPluginId, setOpenPluginId] = useState(null);

  const plugin = PLUGINS.find(p => p.id === openPluginId);
  const SettingsComponent = plugin?.SettingsComponent;

  return (
    <>
      <div className="export-card">
        <h3>🔌 Интеграции</h3>
        <p style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 12 }}>
          Опциональные плагины импорта данных. Каждый можно включать/отключать независимо.
        </p>
        {PLUGINS.map(p => (
          <div
            key={p.id}
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
            <div style={{ fontSize: 28 }}>{p.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--neutral)', marginTop: 2 }}>
                {p.description}
              </div>
            </div>
            <button
              className="btn btn-ghost"
              style={{ height: 36, padding: '0 12px', fontSize: 13 }}
              onClick={() => setOpenPluginId(p.id)}
            >
              Настроить →
            </button>
          </div>
        ))}
      </div>

      {SettingsComponent && (
        <SettingsComponent
          venues={venues}
          onClose={() => setOpenPluginId(null)}
          showToast={showToast}
        />
      )}
    </>
  );
}
