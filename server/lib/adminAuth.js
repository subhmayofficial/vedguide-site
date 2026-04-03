import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'crypto';
import { parse as parseCookie } from 'cookie';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PASSWORD_HASH_FILE = path.join(DATA_DIR, 'admin-password.hash');
const SESSION_SECRET_FILE = path.join(DATA_DIR, '.session-secret');

export const COOKIE_NAME = 'vg_admin';
const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

const loginAttempts = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 12;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { mode: 0o700 });
  }
}

export function hasPasswordFile() {
  return fs.existsSync(PASSWORD_HASH_FILE);
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'base64');
    const expected = Buffer.from(parts[2], 'base64');
    const hash = scryptSync(String(password), salt, 64);
    return hash.length === expected.length && timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

export function savePasswordHash(hashStr) {
  ensureDataDir();
  fs.writeFileSync(PASSWORD_HASH_FILE, hashStr, { mode: 0o600 });
}

export function readPasswordHash() {
  if (!hasPasswordFile()) return '';
  return fs.readFileSync(PASSWORD_HASH_FILE, 'utf8').trim();
}

function getSessionSecret() {
  ensureDataDir();
  if (fs.existsSync(SESSION_SECRET_FILE)) {
    const b = fs.readFileSync(SESSION_SECRET_FILE);
    if (b.length >= 32) return b.subarray(0, 32);
  }
  const s = randomBytes(32);
  fs.writeFileSync(SESSION_SECRET_FILE, s, { mode: 0o600 });
  return s;
}

export function createSessionToken() {
  const payload = { v: 1, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC };
  const body = JSON.stringify(payload);
  const secret = getSessionSecret();
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return Buffer.from(`${body}::${sig}`, 'utf8').toString('base64url');
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('::');
    if (sep < 0) return null;
    const body = raw.slice(0, sep);
    const sigGot = raw.slice(sep + 2);
    const secret = getSessionSecret();
    const sigExp = createHmac('sha256', secret).update(body).digest('base64url');
    const bg = Buffer.from(sigGot, 'utf8');
    const be = Buffer.from(sigExp, 'utf8');
    if (bg.length !== be.length || !timingSafeEqual(bg, be)) {
      return null;
    }
    const payload = JSON.parse(body);
    if (payload.v !== 1 || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseSessionFromRequest(req) {
  const cookies = parseCookie(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  return verifySessionToken(token);
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf && typeof xf === 'string') return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function rateLimitLogin(ip) {
  const now = Date.now();
  let row = loginAttempts.get(ip);
  if (!row || row.reset < now) {
    row = { n: 0, reset: now + RATE_WINDOW_MS };
    loginAttempts.set(ip, row);
  }
  row.n += 1;
  if (row.n > RATE_MAX) return false;
  return true;
}

export function buildSessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookie() {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
