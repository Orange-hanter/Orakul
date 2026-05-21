import { useState } from 'react';
import { setToken as storeToken, clearToken } from './api.js';
import Login from './components/Login.jsx';
import Main  from './components/Main.jsx';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('orakul_token'));

  function handleLogin(t) {
    storeToken(t);
    setToken(t);
  }

  function handleLogout() {
    clearToken();
    setToken(null);
  }

  if (!token) return <Login onLogin={handleLogin} />;
  return <Main onLogout={handleLogout} />;
}
