import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({ title, onClose, onSave, saveLabel = 'Сохранить', saving = false, disabled = false, children }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return createPortal(
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          {onSave && (
            <button className="btn btn-primary" onClick={onSave} disabled={saving || disabled}>
              {saving ? '...' : saveLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
