import { useState } from 'react';
import Modal from './Modal.jsx';

function VenueForm({ initial, onClose, onSave }) {
  const [name,    setName]    = useState(initial?.name    || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [saving,  setSaving]  = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        type:    'venue',
        name:    name.trim(),
        address: address.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initial ? 'Редактировать точку' : 'Новая точка'}
      onClose={onClose}
      onSave={submit}
      saving={saving}
    >
      <div className="form-group">
        <label>Название</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Кофейня на пр. Мира"
          autoFocus
        />
      </div>
      <div className="form-group">
        <label>Адрес (опционально)</label>
        <input
          value={address}
          onChange={e => setAddress(e.target.value)}
          placeholder="г. Минск, пр. Мира 12"
        />
      </div>
    </Modal>
  );
}

export default function VenueSelector({ venues, currentVenueId, onSelect, onCreate, onUpdate, onClose, showToast }) {
  const [venueForm, setVenueForm] = useState(null); // { initial: venue|null }

  async function saveVenue(data) {
    if (venueForm?.initial) {
      await onUpdate(venueForm.initial.id, data);
      showToast('Точка обновлена');
    } else {
      const created = await onCreate(data);
      showToast('Точка добавлена');
      if (created?.id) onSelect(created.id);
    }
  }

  function pick(id) {
    onSelect(id);
    onClose();
  }

  return (
    <>
      <Modal title="Точки" onClose={onClose}>
        {venues.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--neutral)', marginBottom: 12 }}>
            Точек пока нет. Добавьте первую.
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            {venues.map(v => (
              <div
                key={v.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  marginBottom: 8,
                  border: `1.5px solid ${currentVenueId === v.id ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8,
                  background: currentVenueId === v.id ? '#eff6ff' : '#fff',
                }}
              >
                <input
                  type="radio"
                  name="venue"
                  checked={currentVenueId === v.id}
                  onChange={() => pick(v.id)}
                  style={{ width: 20, height: 20 }}
                />
                <div
                  style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  onClick={() => pick(v.id)}
                >
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {v.name}
                    {v.isDefault && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--neutral)', fontWeight: 400 }}>· основная</span>}
                  </div>
                  {v.address && <div style={{ fontSize: 12, color: 'var(--neutral)' }}>{v.address}</div>}
                </div>
                <button
                  className="btn btn-ghost"
                  style={{ height: 32, fontSize: 12, padding: '0 8px' }}
                  onClick={(e) => { e.stopPropagation(); setVenueForm({ initial: v }); }}
                  title="Редактировать"
                >
                  ✎
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          className="btn btn-ghost"
          style={{ width: '100%' }}
          onClick={() => setVenueForm({ initial: null })}
        >
          + Добавить точку
        </button>
      </Modal>

      {venueForm && (
        <VenueForm
          initial={venueForm.initial}
          onClose={() => setVenueForm(null)}
          onSave={saveVenue}
        />
      )}
    </>
  );
}
