const TOKEN_KEY = 'orakul_token';

function token() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function req(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { clearToken(); window.location.reload(); return; }
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

export const api = {
  login: async (password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error('Неверный пароль');
    return res.json();
  },

  records: {
    list:   ()          => req('GET',    '/records'),
    create: (data)      => req('POST',   '/records', data),
    update: (id, data)  => req('PUT',    `/records/${id}`, data),
    remove: (id)        => req('DELETE', `/records/${id}`),
  },

  stats: () => req('GET', '/stats'),

  telegram: {
    getConfig:    ()            => req('GET',    '/telegram/config'),
    saveConfig:   (botToken)    => req('POST',   '/telegram/config', { botToken }),
    deleteConfig: ()            => req('DELETE', '/telegram/config'),
    testDigest:   ()            => req('POST',   '/telegram/test-digest'),
  },

  export: async () => {
    const res = await fetch('/api/export', {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) throw new Error('Ошибка экспорта');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `orakul-pilot-${new Date().toISOString().slice(0, 10)}.enc`;
    a.click();
    URL.revokeObjectURL(url);
  },

  import: async (text) => {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'text/plain',
      },
      body: text,
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Ошибка импорта');
    return res.json();
  },
};
