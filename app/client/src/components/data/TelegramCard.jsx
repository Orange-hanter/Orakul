import { useEffect, useState } from 'react';
import { api } from '../../api.js';

export default function TelegramCard({ telegramChats, onReload, showToast }) {
  const [tgConfigured,   setTgConfigured]   = useState(null);   // null = loading
  const [tgTokenInput,   setTgTokenInput]   = useState('');
  const [tgTokenTouched, setTgTokenTouched] = useState(false);
  const [tgSavingConfig, setTgSavingConfig] = useState(false);
  const [tgSending,      setTgSending]      = useState(false);

  useEffect(() => {
    api.telegram.getConfig()
      .then(({ configured }) => setTgConfigured(configured))
      .catch(() => setTgConfigured(false));
  }, []);

  const tgTokenValid = /^\d+:[A-Za-z0-9_-]{35,}$/.test(tgTokenInput);
  const tgTokenError = tgTokenTouched && tgTokenInput && !tgTokenValid;

  async function handleSaveConfig() {
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

  async function handleDeleteConfig() {
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

  async function handleTest() {
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

  async function handleRemoveChat(id) {
    try {
      await api.records.remove(id);
      await onReload();
      showToast('Чат отключён');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  return (
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
                onKeyDown={e => e.key === 'Enter' && handleSaveConfig()}
                className={tgTokenError ? 'input-error' : ''}
              />
              {tgTokenError && (
                <div className="field-hint error tg-token-hint">Формат: 1234567890:ABCdef… (цифры, двоеточие, минимум 35 символов после)</div>
              )}
            </div>
            <button
              className="btn btn-primary btn-block"
              onClick={handleSaveConfig}
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
            <button className="tg-remove" style={{ marginLeft: 'auto' }} onClick={handleDeleteConfig}>
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
                  <button className="tg-remove" onClick={() => handleRemoveChat(c.id)}>Отключить</button>
                </div>
              ))}
            </div>
          )}

          {telegramChats.length > 0 && (
            <>
              <div style={{ height: 12 }} />
              <button className="btn btn-primary btn-block" onClick={handleTest} disabled={tgSending}>
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
  );
}
