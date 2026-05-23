import { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [demoHint, setDemoHint] = useState(null);

  // Detect demo mode by reading the unauth /api/health endpoint. In demo,
  // the server returns { demo: true, demoPasswordHint: '...' }; in prod
  // neither field is present and the banner stays hidden.
  useEffect(() => {
    api.health()
      .then(h => { if (h?.demo && h?.demoPasswordHint) setDemoHint(h.demoPasswordHint); })
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const { token } = await api.login(password);
      onLogin(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function fillDemoPassword() {
    if (demoHint) setPassword(demoHint);
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">🔮</div>
        <h1 className="login-title">Orakul · Пилот</h1>
        <p className="login-sub">Сбор данных — защищённый доступ</p>

        {demoHint && (
          <div className="demo-banner">
            <div className="demo-banner-title">▶ Это демо</div>
            <div className="demo-banner-body">
              Данные синтетические, сбрасываются при перезапуске сервера.
              Сломать ничего нельзя.
            </div>
            <div className="demo-banner-pwd">
              <span className="demo-banner-label">Пароль:</span>
              <code className="demo-banner-code">{demoHint}</code>
              <button
                type="button"
                className="demo-banner-fill"
                onClick={fillDemoPassword}
                title="Вставить пароль в поле"
              >
                Вставить
              </button>
            </div>
          </div>
        )}

        {error && <div className="error">⚠️ {error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Пароль</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Введите пароль"
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading || !password}
          >
            {loading ? '...' : '→ Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
