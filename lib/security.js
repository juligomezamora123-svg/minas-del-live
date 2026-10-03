import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { one, query } from './db.js';

const scrypt = promisify(crypto.scrypt);

// ---------- secretos ----------
function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error('Falta la variable SESSION_SECRET (mínimo 16 caracteres).');
  }
  return 'clave-solo-para-desarrollo-local-no-usar-en-produccion';
}

// ---------- claves ----------
export async function hashPassword(pass) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pass, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pass, stored) {
  try {
    const [kind, saltB64, keyB64] = String(stored).split('$');
    if (kind !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const key = await scrypt(pass, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// ---------- sesión: cookie firmada ----------
const COOKIE = 'minas_session';
const SESSION_MS = 1000 * 60 * 60 * 24 * 14;

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function mac(data) { return crypto.createHmac('sha256', secret()).update(data).digest('base64url'); }

/** pv = huella de la clave actual: si cambia la clave, las sesiones viejas dejan de servir. */
export function passVersion(passHash) {
  return crypto.createHash('sha256').update(String(passHash)).digest('base64url').slice(0, 10);
}

export function makeSessionCookie(user) {
  const payload = b64u(JSON.stringify({ u: user.id, pv: passVersion(user.pass_hash), exp: Date.now() + SESSION_MS }));
  const token = `${payload}.${mac(payload)}`;
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Devuelve la fila del usuario de la sesión, o null. */
export async function sessionUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const good = mac(payload);
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!data || data.exp < Date.now()) return null;
  const user = await one('SELECT * FROM users WHERE id = $1', [data.u]);
  if (!user || passVersion(user.pass_hash) !== data.pv) return null;
  return user;
}

// ---------- cifrado de datos de pago (AES-256-GCM) ----------
function dataKey() {
  const k = process.env.DATA_KEY;
  if (k) {
    const buf = Buffer.from(k, 'base64');
    if (buf.length === 32) return buf;
    throw new Error('DATA_KEY debe ser 32 bytes en base64.');
  }
  return crypto.createHash('sha256').update('datos:' + secret()).digest();
}

export function encryptJson(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}

export function decryptJson(text) {
  try {
    const [iv, tag, ct] = String(text).split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', dataKey(), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
  } catch {
    return {};
  }
}

// ---------- códigos ----------
export function randomDigits(n) {
  let s = '';
  while (s.length < n) s += crypto.randomInt(0, 10);
  return s;
}

export function hashCode(code) {
  return crypto.createHmac('sha256', secret()).update('codigo:' + String(code)).digest('base64url');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- límite de intentos (guardado en la base de datos) ----------
/** Segundos que faltan de bloqueo para esta llave (0 = libre). */
export async function lockedFor(key) {
  const r = await one('SELECT until FROM rate_limits WHERE key = $1', [key]);
  return r && r.until > Date.now() ? Math.ceil((r.until - Date.now()) / 1000) : 0;
}

/** Cuenta un fallo; tras `max` fallos bloquea `lockMs`. */
export async function recordFail(key, max = 5, lockMs = 60_000) {
  const now = Date.now();
  const r = await one('SELECT n, until, updated FROM rate_limits WHERE key = $1', [key]);
  let n = r && now - r.updated < 15 * 60_000 ? r.n + 1 : 1;
  let until = 0;
  if (n >= max) { until = now + lockMs; n = 0; }
  await query(
    `INSERT INTO rate_limits (key, n, until, updated) VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE SET n = $2, until = $3, updated = $4`,
    [key, n, until, now],
  );
}

export async function clearFails(key) {
  await query('DELETE FROM rate_limits WHERE key = $1', [key]);
}
