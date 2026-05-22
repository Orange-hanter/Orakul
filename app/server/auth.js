/*
 * Auth: JWT middleware + login route with per-IP brute-force throttle and
 * timing-safe password comparison.
 *
 * Single-instance pilot, so an in-process Map is the right fit — no Redis.
 */
import crypto from 'node:crypto';
import jwt    from 'jsonwebtoken';
import { SECRET, PASS_HASH } from './config.js';

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS    = 15 * 60 * 1000;
const loginAttempts = new Map(); // ip → { count, firstAttemptAt }

function clientIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || (now - entry.firstAttemptAt) > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
  } else {
    entry.count++;
  }
}

function isLoginBlocked(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if ((Date.now() - entry.firstAttemptAt) > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

// Hash both sides so we never branch on input length.
function timingSafeEqualString(a, b) {
  const aHash = crypto.createHash('sha256').update(String(a)).digest();
  return crypto.timingSafeEqual(aHash, b);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}

export function register(app) {
  app.post('/api/auth/login', (req, res) => {
    const ip = clientIp(req);
    if (isLoginBlocked(ip)) {
      return res.status(429).json({ error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    }
    const password = req.body?.password;
    if (!password || !timingSafeEqualString(password, PASS_HASH)) {
      recordLoginFailure(ip);
      return res.status(401).json({ error: 'Wrong password' });
    }
    loginAttempts.delete(ip);
    const token = jwt.sign({ ok: true }, SECRET, { expiresIn: '24h' });
    res.json({ token });
  });
}
