import { useState } from 'react';
import Modal from '../Modal.jsx';

export default function SupplierForm({ initial, onClose, onSave }) {
  const [name,    setName]    = useState(initial?.name    || '');
  const [contact, setContact] = useState(initial?.contact || '');
  const [email,            setEmail]            = useState(initial?.email            || '');
  const [telegramUsername, setTelegramUsername] = useState(initial?.telegramUsername || '');
  const [viberPhone,       setViberPhone]       = useState(initial?.viberPhone       || '');
  const [tags,    setTags]    = useState((initial?.tags || []).join(', '));
  const [status,  setStatus]  = useState(initial?.status  || 'active');
  const [note,    setNote]    = useState(initial?.note    || '');
  const [saving,  setSaving]  = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Telegram: убираем ведущий @ если юзер его ввёл — диплинк работает без него.
      const tgClean = telegramUsername.trim().replace(/^@/, '');
      await onSave({
        type:    'supplier',
        name:    name.trim(),
        contact: contact.trim(),
        email:            email.trim()  || null,
        telegramUsername: tgClean       || null,
        viberPhone:       viberPhone.trim() || null,
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
        <label>Контакт <span className="label-hint">(ФИО, телефон, прочее)</span></label>
        <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Иван Петров, +375 29 123 45 67" />
      </div>
      <div className="form-group">
        <label>Email <span className="label-hint">(для отправки заявок)</span></label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="orders@supplier.by"
        />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Telegram</label>
          <input
            value={telegramUsername}
            onChange={e => setTelegramUsername(e.target.value)}
            placeholder="@username или +375..."
          />
        </div>
        <div className="form-group">
          <label>Viber</label>
          <input
            value={viberPhone}
            onChange={e => setViberPhone(e.target.value)}
            placeholder="+375291234567"
          />
        </div>
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
