import { useState } from 'react';
import Modal from '../Modal.jsx';

export default function SupplierForm({ initial, onClose, onSave }) {
  const [name,    setName]    = useState(initial?.name    || '');
  const [contact, setContact] = useState(initial?.contact || '');
  const [tags,    setTags]    = useState((initial?.tags || []).join(', '));
  const [status,  setStatus]  = useState(initial?.status  || 'active');
  const [note,    setNote]    = useState(initial?.note    || '');
  const [saving,  setSaving]  = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        type:    'supplier',
        name:    name.trim(),
        contact: contact.trim(),
        tags:    tags.split(',').map(t => t.trim()).filter(Boolean),
        status,
        note:    note.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initial ? 'Редактировать поставщика' : 'Новый поставщик'}
      onClose={onClose}
      onSave={submit}
      saving={saving}
    >
      <div className="form-group">
        <label>Название</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="ООО АгроПоставка" autoFocus />
      </div>
      <div className="form-group">
        <label>Контакт</label>
        <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Иван Петров, +375 29 123 45 67" />
      </div>
      <div className="form-group">
        <label>Категории (через запятую)</label>
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="мясо, молочка, бакалея" />
      </div>
      <div className="form-group">
        <label>Статус</label>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="active">Активен</option>
          <option value="paused">Приостановлен</option>
        </select>
      </div>
      <div className="form-group">
        <label>Заметка</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} />
      </div>
    </Modal>
  );
}
