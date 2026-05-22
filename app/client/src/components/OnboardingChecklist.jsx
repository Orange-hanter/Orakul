import { useState } from 'react';
import Modal from './Modal.jsx';
import { buildChecklist, dismissOnboarding } from '../utils/onboarding.js';

/*
 * F07 — Onboarding checklist.
 *
 * Показывается на первом запуске «свежей» инсталляции: пользователь видит
 * 4 шага, нужных чтобы Orakul начал давать реальные инсайты. Каждый шаг
 * автоматически отмечается ✅ когда условие выполнено в данных.
 *
 * Логика отображения/dismissal — в utils/onboarding.js.
 */

export default function OnboardingChecklist({ records, onClose, onJumpToTab }) {
  const [closing, setClosing] = useState(false);
  const items = buildChecklist(records);
  const doneCount = items.filter(i => i.done).length;
  const total = items.length;
  const pct = Math.round(doneCount / total * 100);

  function handleDismiss() {
    dismissOnboarding();
    setClosing(true);
    onClose();
  }

  function handleJump(tab) {
    if (tab && onJumpToTab) onJumpToTab(tab);
    onClose();
  }

  return (
    <Modal title="🧀 Добро пожаловать в Orakul!" onClose={onClose}>
      <div style={{ fontSize: 14, marginBottom: 16, color: 'var(--neutral)', lineHeight: 1.5 }}>
        Чтобы Orakul начал давать реальные рекомендации, нужны базовые данные.
        Заполните хотя бы 3 из 4 шагов:
      </div>

      <div style={{
        marginBottom: 16, padding: 10, background: '#f8fafc', borderRadius: 8,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Прогресс</span>
        <span style={{ fontSize: 14, color: pct >= 75 ? 'var(--success)' : 'var(--primary)' }}>
          {doneCount} из {total} · {pct}%
        </span>
      </div>

      <div style={{ marginBottom: 16 }}>
        {items.map(item => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: 12, marginBottom: 8,
            background: item.done ? '#dcfce7' : '#fff',
            border: `1px solid ${item.done ? 'var(--success)' : 'var(--border)'}`,
            borderRadius: 8,
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: 12,
              background: item.done ? 'var(--success)' : '#e2e8f0',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700,
            }}>
              {item.done ? '✓' : ''}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: item.done ? 'var(--primary)' : 'var(--primary)' }}>
                {item.label}
              </div>
              {!item.done && item.action?.tab && (
                <div style={{ fontSize: 12, color: 'var(--neutral)' }}>{item.action.label}</div>
              )}
            </div>
            {!item.done && item.action?.tab && (
              <button
                className="btn btn-ghost"
                style={{ height: 32, fontSize: 12, padding: '0 10px' }}
                onClick={() => handleJump(item.action.tab)}
              >
                Перейти →
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, color: 'var(--neutral)', marginBottom: 12 }}>
        💡 Когда 3 из 4 шагов будут готовы, появятся: ABC-анализ меню, P&L дашборд,
        алёрты по марже и Telegram-дайджест по складу.
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost btn-block" onClick={handleDismiss}>
          Не показывать
        </button>
        <button className="btn btn-primary btn-block" onClick={onClose}>
          Понятно
        </button>
      </div>
    </Modal>
  );
}
