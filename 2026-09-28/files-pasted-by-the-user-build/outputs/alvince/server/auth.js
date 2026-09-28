import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { db, publicUser } from './db.js';

const scrypt = promisify(scryptCallback);
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;
const COOKIE = 'alvince_session';
const PASSWORD = { N: 16384, r: 8, p: 1, length: 64 };

export function passwordPolicy(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 128 && Buffer.byteLength(password, 'utf8') <= 512;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, PASSWORD.length, { N: PASSWORD.N, r: PASSWORD.r, p: PASSWORD.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${PASSWORD.N}$${PASSWORD.r}$${PASSWORD.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const [algorithm, n, r, p, saltHex, hashHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || Number(n) !== PASSWORD.N || Number(r) !== PASSWORD.r || Number(p) !== PASSWORD.p || !/^[a-f0-9]{32}$/.test(saltHex || '') || !/^[a-f0-9]{128}$/.test(hashHex || '')) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: PASSWORD.N, r: PASSWORD.r, p: PASSWORD.p, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(expected, actual);
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const i = part.indexOf('=');
    if (i < 0) return ['', ''];
    try { return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())]; }
    catch { return ['', '']; }
  }).filter(([key]) => key));
}

export function createSession(userId, secure) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO sessions (token_hash, csrf_token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), csrfToken, userId, now + SESSION_MS, new Date().toISOString());
  return {
    csrfToken,
    cookie: `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure ? '; Secure' : ''}`,
  };
}

export function expireCookie(secure) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function readSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || token.length > 128) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = db.prepare('SELECT s.csrf_token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(tokenHash);
  if (!session) return null;
  if (session.expires_at <= Date.now() || session.disabled) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { user: publicUser(session), csrfToken: session.csrf_token, tokenHash };
}

export function destroySession(session) {
  if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.tokenHash);
}

export function newId() { return randomUUID(); }
