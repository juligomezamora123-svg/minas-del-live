import crypto from 'node:crypto';
import { query, one } from './db.js';
import {
  hashPassword, verifyPassword, makeSessionCookie, clearSessionCookie, sessionUser,
  encryptJson, decryptJson, randomDigits, hashCode, safeEqual, lockedFor, recordFail, clearFails,
} from './security.js';
import { sendMail, mailConfigured } from './email.js';
import { usdCop, toUsdt } from './rates.js';
import {
  WD_METHODS, DEFAULT_TEXTS, normConfig, normTexts, normMoney, normMoneyRead, normSupport,
  buildMap, sumPoints, wipeHit, newGameCode, publicGame, progressOf,
} from './game.js';

// ---------- utilidades ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const num = (v) => (typeof v === 'number' ? v : Number(v));

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Celular internacional: solo dígitos, de 7 a 15. Se aceptan espacios, guiones, paréntesis y el +. */
function normPhone(v) {
  const d = String(v || '').replace(/[^\d]/g, '');
  return d.length >= 7 && d.length <= 15 ? d : null;
}

function pubUser(u) {
  return { id: u.id, username: u.username, email: u.email, phone: u.phone, fullName: u.full_name, role: u.role, balance: num(u.balance), createdAt: u.created_at };
}

async function getSite(key, norm) {
  const r = await one('SELECT value FROM site WHERE key = $1', [key]);
  let data = {};
  if (r) { try { data = JSON.parse(r.value); } catch { data = {}; } }
  return norm(data);
}
async function setSite(key, value) {
  await query(
    `INSERT INTO site (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, JSON.stringify(value)],
  );
}
const getConfig = (page) => getSite('config:' + page, normConfig);

async function publicSite() {
  const rows = await query(`SELECT key, value FROM site WHERE key IN ('texts','money','support')`);
  const raw = {};
  for (const r of rows) { try { raw[r.key] = JSON.parse(r.value); } catch { raw[r.key] = {}; } }
  return { texts: normTexts(raw.texts), money: normMoneyRead(raw.money), support: normSupport(raw.support) };
}

// ---------- registro de rutas ----------
const routes = [];
function route(method, pattern, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opts });
}

// =====================================================================
// CUENTAS
// =====================================================================
route('GET', '/api/me', async (ctx) => {
  const mailEnabled = mailConfigured();
  if (!ctx.user) return { user: null, site: await publicSite(), mailEnabled };
  const u = ctx.user;
  const counts = u.role === 'owner'
    ? one(`SELECT (SELECT count(*)::int FROM tickets WHERE admin_unread = 1) AS unread,
              (SELECT count(*)::int FROM withdrawals WHERE status = 'pending') AS pending`)
    : one('SELECT count(*)::int AS unread, 0 AS pending FROM tickets WHERE user_id = $1 AND player_unread = 1', [u.id]);
  const [site, c] = await Promise.all([publicSite(), counts]);
  return { user: pubUser(u), site, mailEnabled, unread: Number(c?.unread) || 0, pending: Number(c?.pending) || 0 };
});

route('POST', '/api/auth/register', async (ctx) => {
  const { username, email, phone, password } = ctx.body;
  const un = String(username || '').trim();
  const em = String(email || '').trim().toLowerCase();
  const ph = normPhone(phone);
  if (!USERNAME_RE.test(un)) fail(400, 'El usuario debe tener 3 a 20 letras, números o _.');
  if (!EMAIL_RE.test(em)) fail(400, 'Escribe un correo válido.');
  if (!ph) fail(400, 'Escribe un celular válido (de 7 a 15 dígitos, con código de país si es de otro país).');
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) fail(400, 'La clave debe tener entre 8 y 100 caracteres.');
  const wait = await lockedFor('reg:' + ctx.ip);
  if (wait) fail(429, `Demasiados registros desde esta conexión. Espera ${wait} segundos.`);
  if (await one('SELECT 1 AS x FROM users WHERE lower(username) = lower($1)', [un])) fail(409, 'Ese usuario ya existe.');
  if (await one('SELECT 1 AS x FROM users WHERE email = $1', [em])) fail(409, 'Ese correo ya tiene una cuenta.');
  const id = uid();
  const hash = await hashPassword(password);
  await query(
    `INSERT INTO users (id, username, email, phone, pass_hash, role, balance, created_at) VALUES ($1,$2,$3,$4,$5,'player',0,$6)`,
    [id, un, em, ph, hash, now()],
  );
  await recordFail('reg:' + ctx.ip, 10, 10 * 60_000);
  const user = await one('SELECT * FROM users WHERE id = $1', [id]);
  ctx.setCookie(makeSessionCookie(user));
  return { user: pubUser(user) };
});

// El dueño se crea una sola vez, con la clave secreta OWNER_SETUP_KEY que tú defines en Vercel.
route('POST', '/api/auth/owner', async (ctx) => {
  const { username, email, phone, password, setupKey } = ctx.body;
  const expected = process.env.OWNER_SETUP_KEY;
  if (!expected || expected.length < 8) fail(503, 'Falta configurar OWNER_SETUP_KEY (mínimo 8 caracteres) en el servidor.');
  const wait = await lockedFor('owner:' + ctx.ip);
  if (wait) fail(429, `Demasiados intentos. Espera ${wait} segundos.`);
  if (!safeEqual(String(setupKey || ''), expected)) {
    await recordFail('owner:' + ctx.ip, 5, 5 * 60_000);
    fail(403, 'La clave de configuración no es correcta.');
  }
  if (await one(`SELECT 1 AS x FROM users WHERE role = 'owner'`)) fail(409, 'Ya existe una cuenta de dueño.');
  const un = String(username || '').trim();
  const em = String(email || '').trim().toLowerCase();
  const ph = normPhone(phone);
  if (!USERNAME_RE.test(un)) fail(400, 'El usuario debe tener 3 a 20 letras, números o _.');
  if (!EMAIL_RE.test(em)) fail(400, 'Escribe un correo válido.');
  if (!ph) fail(400, 'Escribe un celular válido.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) fail(400, 'La clave debe tener entre 8 y 100 caracteres.');
  if (await one('SELECT 1 AS x FROM users WHERE lower(username) = lower($1) OR email = $2', [un, em])) fail(409, 'Ese usuario o correo ya existe.');
  const id = uid();
  await query(
    `INSERT INTO users (id, username, email, phone, pass_hash, role, balance, created_at) VALUES ($1,$2,$3,$4,$5,'owner',0,$6)`,
    [id, un, em, ph, await hashPassword(password), now()],
  );
  const user = await one('SELECT * FROM users WHERE id = $1', [id]);
  ctx.setCookie(makeSessionCookie(user));
  return { user: pubUser(user) };
});

route('GET', '/api/auth/owner-exists', async () => {
  return { exists: !!(await one(`SELECT 1 AS x FROM users WHERE role = 'owner'`)) };
});

route('POST', '/api/auth/login', async (ctx) => {
  const id = String(ctx.body.id || '').trim().toLowerCase();
  const password = String(ctx.body.password || '');
  if (!id || !password) fail(400, 'Escribe tu usuario o correo y tu clave.');
  const ipKey = 'loginip:' + ctx.ip;
  const [user, ipWait] = await Promise.all([
    one('SELECT * FROM users WHERE lower(username) = $1 OR email = $1', [id]),
    lockedFor(ipKey),
  ]);
  if (ipWait) fail(429, `Demasiados intentos desde esta conexión. Espera ${ipWait} segundos.`);
  const lockKey = 'login:' + (user ? user.id : id.slice(0, 80));
  const wait = await lockedFor(lockKey);
  if (wait) fail(429, `Demasiados intentos. Espera ${wait} segundos.`);
  const ok = user ? await verifyPassword(password, user.pass_hash) : (await verifyPassword(password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(43) + '='), false);
  if (!ok) {
    await recordFail(lockKey);
    await recordFail(ipKey, 30, 10 * 60_000);
    fail(401, 'Usuario o clave incorrectos.');
  }
  await clearFails(lockKey);
  ctx.setCookie(makeSessionCookie(user));
  return { user: pubUser(user) };
});

route('POST', '/api/auth/logout', async (ctx) => {
  ctx.setCookie(clearSessionCookie());
  return { ok: true };
});

// Recuperar la clave: se envía un código de 6 dígitos al correo. Caduca en 10 minutos y sirve una vez.
route('POST', '/api/auth/forgot', async (ctx) => {
  const em = String(ctx.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(em)) fail(400, 'Escribe un correo válido.');
  if (!mailConfigured() && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
    fail(503, 'La recuperación por correo todavía no está configurada. Escribe a soporte.');
  }
  const wait = await lockedFor('forgot:' + em);
  if (wait) fail(429, `Ya pediste un código. Espera ${wait} segundos para pedir otro.`);
  await recordFail('forgot:' + em, 3, 10 * 60_000);
  await recordFail('forgotip:' + ctx.ip, 10, 15 * 60_000);
  const user = await one('SELECT * FROM users WHERE email = $1', [em]);
  if (user) {
    const code = randomDigits(6);
    await query(
      `INSERT INTO reset_codes (user_id, code_hash, expires, attempts) VALUES ($1,$2,$3,0)
       ON CONFLICT (user_id) DO UPDATE SET code_hash = $2, expires = $3, attempts = 0`,
      [user.id, hashCode(code), Date.now() + 10 * 60_000],
    );
    const title = (await getSite('texts', normTexts)).title;
    try {
      await sendMail({
        to: user.email,
        subject: `Tu código para cambiar la clave · ${title}`,
        text: `Tu código es ${code}.\n\nSirve durante 10 minutos y una sola vez. Si no lo pediste tú, ignora este correo: tu clave no cambia.`,
        html: `<p>Tu código es:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>Sirve durante 10 minutos y una sola vez.<br>Si no lo pediste tú, ignora este correo: tu clave no cambia.</p>`,
      });
    } catch (e) {
      console.error('No se pudo enviar el correo de recuperación:', e.message);
      fail(502, 'No se pudo enviar el correo. Intenta de nuevo en unos minutos.');
    }
  }
  // misma respuesta exista o no el correo, para no revelar qué cuentas existen
  return { ok: true };
});

route('POST', '/api/auth/reset', async (ctx) => {
  const em = String(ctx.body.email || '').trim().toLowerCase();
  const code = String(ctx.body.code || '').replace(/\D/g, '');
  const password = String(ctx.body.password || '');
  if (password.length < 8 || password.length > 100) fail(400, 'La clave nueva debe tener entre 8 y 100 caracteres.');
  const lockKey = 'reset:' + em;
  const wait = await lockedFor(lockKey);
  if (wait) fail(429, `Demasiados intentos. Espera ${wait} segundos.`);
  const user = await one('SELECT * FROM users WHERE email = $1', [em]);
  const row = user ? await one('SELECT * FROM reset_codes WHERE user_id = $1', [user.id]) : null;
  const bad = () => { throw new HttpError(400, 'El código no es correcto o ya venció. Pide uno nuevo.'); };
  if (!row || row.expires < Date.now() || row.attempts >= 5) {
    if (row) await query('DELETE FROM reset_codes WHERE user_id = $1', [user.id]);
    await recordFail(lockKey);
    bad();
  }
  if (!safeEqual(hashCode(code), row.code_hash)) {
    await query('UPDATE reset_codes SET attempts = attempts + 1 WHERE user_id = $1', [user.id]);
    await recordFail(lockKey);
    bad();
  }
  await query('UPDATE users SET pass_hash = $1 WHERE id = $2', [await hashPassword(password), user.id]);
  await query('DELETE FROM reset_codes WHERE user_id = $1', [user.id]);
  await clearFails(lockKey);
  await clearFails('login:' + user.id);
  return { ok: true };
});

route('PATCH', '/api/me', { auth: true }, async (ctx) => {
  const u = ctx.user;
  const fullName = String(ctx.body.fullName ?? u.full_name).trim().slice(0, 60);
  const ph = normPhone(ctx.body.phone ?? u.phone);
  if (!ph) fail(400, 'Escribe un celular válido (de 7 a 15 dígitos).');
  let email = u.email;
  if (ctx.body.email !== undefined && String(ctx.body.email).trim().toLowerCase() !== u.email) {
    const em = String(ctx.body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(em)) fail(400, 'Escribe un correo válido.');
    const lockKey = 'pw:' + u.id;
    const wait = await lockedFor(lockKey);
    if (wait) fail(429, `Demasiados intentos. Espera ${wait} segundos.`);
    if (!(await verifyPassword(String(ctx.body.currentPassword || ''), u.pass_hash))) {
      await recordFail(lockKey);
      fail(403, 'Para cambiar el correo escribe tu clave actual.');
    }
    if (await one('SELECT 1 AS x FROM users WHERE email = $1 AND id <> $2', [em, u.id])) fail(409, 'Ese correo ya tiene una cuenta.');
    email = em;
  }
  await query('UPDATE users SET full_name = $1, phone = $2, email = $3 WHERE id = $4', [fullName, ph, email, u.id]);
  return { user: pubUser(await one('SELECT * FROM users WHERE id = $1', [u.id])) };
});

route('POST', '/api/me/password', { auth: true }, async (ctx) => {
  const u = ctx.user;
  const { current, next } = ctx.body;
  if (typeof next !== 'string' || next.length < 8 || next.length > 100) fail(400, 'La clave nueva debe tener entre 8 y 100 caracteres.');
  const lockKey = 'pw:' + u.id;
  const wait = await lockedFor(lockKey);
  if (wait) fail(429, `Demasiados intentos. Espera ${wait} segundos.`);
  if (!(await verifyPassword(String(current || ''), u.pass_hash))) {
    await recordFail(lockKey);
    fail(403, 'La clave actual no es correcta.');
  }
  await clearFails(lockKey);
  await query('UPDATE users SET pass_hash = $1 WHERE id = $2', [await hashPassword(next), u.id]);
  ctx.setCookie(makeSessionCookie(await one('SELECT * FROM users WHERE id = $1', [u.id]))); // esta sesión sigue; las demás se cierran
  return { ok: true };
});

// =====================================================================
// JUEGO (todo el reparto vive en el servidor)
// =====================================================================
function pageOf(ctx) {
  const page = String(ctx.query.page || ctx.body.page || 'player');
  if (page !== 'live' && page !== 'player') fail(400, 'Página no válida.');
  if (page === 'live' && ctx.user.role !== 'owner') fail(403, 'Solo el dueño puede jugar en esta página.');
  return page;
}

async function createGame(user, page) {
  const cfg = await getConfig(page);
  const map = buildMap(cfg);
  const id = uid();
  for (let i = 0; i < 5; i++) {
    try {
      await query(
        `INSERT INTO games (id, code, user_id, page, status, map, opened, cfg, version, created_at)
         VALUES ($1,$2,$3,$4,'active',$5,'[]',$6,0,$7)`,
        [id, newGameCode(), user.id, page, JSON.stringify(map), JSON.stringify(cfg), now()],
      );
      return one('SELECT * FROM games WHERE id = $1', [id]);
    } catch (e) {
      if (!/unique|duplicate/i.test(String(e.message))) throw e;
    }
  }
  fail(500, 'No se pudo crear el juego.');
}

async function activeGame(user, page) {
  let g = await one(`SELECT * FROM games WHERE user_id = $1 AND page = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [user.id, page]);
  if (g && JSON.parse(g.opened).length === 0) {
    // sin casillas destapadas: se reparte de nuevo con la configuración actual del administrador
    const cfg = await getConfig(page);
    if (JSON.stringify(cfg) !== g.cfg) {
      await query('DELETE FROM games WHERE id = $1', [g.id]);
      g = null;
    }
  }
  return g || createGame(user, page);
}

async function ownGame(ctx) {
  const g = await one('SELECT * FROM games WHERE id = $1 AND user_id = $2', [String(ctx.body.id || ''), ctx.user.id]);
  if (!g) fail(404, 'Juego no encontrado.');
  return g;
}

const gameOut = (g) => publicGame(g);

route('GET', '/api/game', { auth: true }, async (ctx) => {
  const page = pageOf(ctx);
  return { game: gameOut(await activeGame(ctx.user, page), ctx.user) };
});

route('POST', '/api/game/reveal', { auth: true }, async (ctx) => {
  const idx = ctx.body.idx;
  for (let attempt = 0; attempt < 4; attempt++) {
    const g = await ownGame(ctx);
    if (g.status !== 'active') fail(409, 'Este juego ya terminó.');
    const map = JSON.parse(g.map), opened = JSON.parse(g.opened), cfg = JSON.parse(g.cfg);
    if (!Number.isInteger(idx) || idx < 0 || idx >= map.length) fail(400, 'Casilla no válida.');
    if (opened.includes(idx)) fail(409, 'Esa casilla ya está destapada.');
    const next = [...opened, idx];
    const keys = next.map((i) => map[i]);
    const bomb = wipeHit(cfg, keys);
    const rows = await query(
      `UPDATE games SET opened = $1, version = version + 1, status = $2, lost = $3, ended_at = $4
       WHERE id = $5 AND version = $6 AND status = 'active' RETURNING *`,
      [JSON.stringify(next), bomb ? 'bomb' : 'active', bomb ? Math.max(0, sumPoints(cfg, keys)) : 0, bomb ? now() : null, g.id, g.version],
    );
    if (rows[0]) return { game: gameOut(rows[0], ctx.user) };
  }
  fail(409, 'El juego cambió al mismo tiempo. Intenta de nuevo.');
});

route('POST', '/api/game/cash', { auth: true }, async (ctx) => {
  const g = await ownGame(ctx);
  if (g.status !== 'active') fail(409, 'Este juego ya terminó.');
  const cfg = JSON.parse(g.cfg), map = JSON.parse(g.map);
  const keys = JSON.parse(g.opened).map((i) => map[i]);
  if (keys.length === 0) fail(400, 'Destapa al menos una casilla antes de cobrar.');
  const points = sumPoints(cfg, keys);
  const money = await getSite('money', normMoneyRead);
  const pesos = Math.max(0, points) * money.pointValue;
  const rows = await query(
    `WITH g AS (
       UPDATE games SET status = 'cashed', points = $3::float8, pesos = $4::float8, ended_at = $5, version = version + 1
       WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING user_id, pesos
     )
     UPDATE users SET balance = balance + (SELECT pesos FROM g) WHERE id = (SELECT user_id FROM g) RETURNING balance`,
    [g.id, ctx.user.id, points, pesos, now()],
  );
  if (!rows[0]) fail(409, 'Este juego ya terminó.');
  const fresh = await one('SELECT * FROM games WHERE id = $1', [g.id]);
  return { game: gameOut(fresh, ctx.user), balance: num(rows[0].balance) };
});

route('POST', '/api/game/restart', { auth: true }, async (ctx) => {
  const g = await ownGame(ctx);
  if (g.status === 'active') {
    const opened = JSON.parse(g.opened);
    if (opened.length > 0) {
      const cfg = JSON.parse(g.cfg), map = JSON.parse(g.map);
      await query(
        `UPDATE games SET status = 'reset', lost = $1, ended_at = $2, version = version + 1 WHERE id = $3 AND status = 'active'`,
        [Math.max(0, sumPoints(cfg, opened.map((i) => map[i]))), now(), g.id],
      );
    } else {
      await query(`DELETE FROM games WHERE id = $1 AND status = 'active'`, [g.id]);
    }
  }
  return { game: gameOut(await createGame(ctx.user, g.page), ctx.user) };
});

route('GET', '/api/history', { auth: true }, async (ctx) => {
  const rows = await query(`SELECT * FROM games WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [ctx.user.id]);
  return {
    games: rows.map((g) => {
      const pg = publicGame(g);
      return { code: g.code, page: g.page, status: g.status, opened: pg.opened.length, totalCells: pg.totalCells, points: pg.points, pesos: g.pesos, lost: g.lost, createdAt: g.created_at, endedAt: g.ended_at };
    }),
  };
});

// =====================================================================
// RETIROS
// =====================================================================
// strict = inscribir una cuenta: la cuenta bancaria exige número, tipo de cuenta, nombre del titular e identificación
function cleanDetails(method, d, money, strict = false) {
  d = d && typeof d === 'object' ? d : {};
  const s = (v, max = 60) => String(v ?? '').trim().slice(0, max);
  const digits = (v) => String(v ?? '').replace(/\D/g, '');
  if (!WD_METHODS.includes(method) || !money.methods[method]) fail(400, 'Ese medio de pago no está disponible.');
  if (method === 'banco') {
    const bank = s(d.bank, 40), number = digits(d.number), holder = s(d.holder), doc = digits(d.doc);
    if (!bank) fail(400, 'Escribe el banco.');
    if (!/^\d{6,20}$/.test(number)) fail(400, 'El número de cuenta debe tener entre 6 y 20 dígitos.');
    if (!holder) fail(400, 'Escribe el nombre del titular.');
    if (strict && d.acctType !== 'Ahorros' && d.acctType !== 'Corriente') fail(400, 'Elige el tipo de cuenta: Ahorros o Corriente.');
    const needDoc = money.askDoc || strict;
    if (needDoc && !/^\d{5,15}$/.test(doc)) fail(400, strict ? 'Para inscribir la cuenta escribe la identificación del titular (solo números).' : 'El documento debe tener solo números.');
    const out = { bank, acctType: d.acctType === 'Corriente' ? 'Corriente' : 'Ahorros', number, holder };
    if (needDoc || /^\d{5,15}$/.test(doc)) out.doc = doc;
    return out;
  }
  if (method === 'breb') {
    const key = s(d.key, 40), holder = s(d.holder);
    if (key.length < 3) fail(400, 'Escribe tu llave Bre-B.');
    if (!holder) fail(400, 'Escribe el nombre del titular.');
    const types = ['Celular', 'Correo', 'Documento', 'Alfanumérica'];
    return { keyType: types.includes(d.keyType) ? d.keyType : 'Celular', key, holder };
  }
  if (method === 'usdt') {
    const wallet = s(d.wallet, 40);
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet)) fail(400, 'La dirección TRC-20 debe empezar por T y tener 34 caracteres.');
    return { wallet, network: 'TRC-20' };
  }
  if (method === 'nequi' || method === 'daviplata') {
    const number = digits(d.number), holder = s(d.holder);
    if (!/^\d{10}$/.test(number)) fail(400, 'El celular debe tener 10 dígitos.');
    if (!holder) fail(400, 'Escribe el nombre del titular.');
    return { number, holder };
  }
  const holder = s(d.holder), other = s(d.other, 200);
  if (!holder) fail(400, 'Escribe el nombre del titular.');
  if (!other) fail(400, 'Escribe los datos para pagarte.');
  return { holder, other };
}

// ---------- cuentas inscritas para retirar ----------
const MAX_ACCOUNTS = 15;
const tail = (v, n) => String(v || '').slice(-n);
function acctLabel(method, d) {
  if (method === 'banco') return `${d.bank} · ${d.acctType} ····${tail(d.number, 4)} · ${d.holder}`;
  if (method === 'breb') return `Bre-B (${d.keyType}) ····${tail(d.key, 3)} · ${d.holder}`;
  if (method === 'usdt') return `USDT TRC-20 ${String(d.wallet).slice(0, 4)}…${tail(d.wallet, 4)}`;
  if (method === 'nequi') return `Nequi ····${tail(d.number, 4)} · ${d.holder}`;
  if (method === 'daviplata') return `Daviplata ····${tail(d.number, 4)} · ${d.holder}`;
  return `Otro medio · ${d.holder}`;
}

async function saveAccount(userId, method, details) {
  const rows = await query('SELECT * FROM payout_accounts WHERE user_id = $1', [userId]);
  const same = JSON.stringify(details);
  const dup = rows.find((r) => r.method === method && JSON.stringify(decryptJson(r.details_enc)) === same);
  if (dup) return { id: dup.id, label: dup.label, method, dup: true };
  if (rows.length >= MAX_ACCOUNTS) fail(400, `Ya tienes ${MAX_ACCOUNTS} cuentas inscritas. Elimina alguna para agregar otra.`);
  const id = uid(), label = acctLabel(method, details);
  await query(
    'INSERT INTO payout_accounts (id, user_id, method, label, details_enc, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, userId, method, label, encryptJson(details), now()],
  );
  return { id, label, method };
}

route('GET', '/api/accounts', { auth: true }, async (ctx) => {
  const rows = await query('SELECT id, method, label, created_at FROM payout_accounts WHERE user_id = $1 ORDER BY created_at ASC', [ctx.user.id]);
  return { accounts: rows.map((r) => ({ id: r.id, method: r.method, label: r.label, createdAt: r.created_at })) };
});

route('POST', '/api/accounts', { auth: true }, async (ctx) => {
  const money = await getSite('money', normMoneyRead);
  const method = String(ctx.body.method || '');
  const details = cleanDetails(method, ctx.body.details, money, true);
  const a = await saveAccount(ctx.user.id, method, details);
  return { account: { id: a.id, method: a.method, label: a.label }, already: !!a.dup };
});

route('DELETE', '/api/accounts/:id', { auth: true }, async (ctx) => {
  const rows = await query('DELETE FROM payout_accounts WHERE id = $1 AND user_id = $2 RETURNING id', [ctx.params.id, ctx.user.id]);
  if (!rows[0]) fail(404, 'Esa cuenta ya no existe.');
  return { ok: true };
});

function wdOut(w, viewer) {
  return {
    id: w.id, userId: w.user_id, username: w.username, page: w.page, amount: num(w.amount), method: w.method,
    status: w.status, createdAt: w.created_at, resolvedAt: w.resolved_at,
    details: decryptJson(w.details_enc),
    email: viewer === 'owner' ? w.email : undefined,
  };
}

route('POST', '/api/withdrawals', { auth: true }, async (ctx) => {
  const money = await getSite('money', normMoneyRead);
  const amount = Math.floor(Number(ctx.body.amount));
  if (!(amount >= 1)) fail(400, 'Escribe cuántos pesos quieres retirar.');
  if (amount < money.minWithdraw) fail(400, `El retiro mínimo es $${money.minWithdraw}.`);
  let method = String(ctx.body.method || '');
  let details;
  if (ctx.body.accountId) {
    // cuenta ya inscrita: no se piden los datos otra vez
    const acct = await one('SELECT * FROM payout_accounts WHERE id = $1 AND user_id = $2', [String(ctx.body.accountId), ctx.user.id]);
    if (!acct) fail(404, 'Esa cuenta inscrita ya no existe. Elige otra o escribe los datos.');
    method = acct.method;
    try { details = cleanDetails(method, decryptJson(acct.details_enc), money); }
    catch (e) { if (e instanceof HttpError) fail(400, e.message + ' Elimina esa cuenta e inscríbela de nuevo.'); throw e; }
  } else {
    details = cleanDetails(method, ctx.body.details, money, !!ctx.body.saveAccount);
  }
  const savedCopy = JSON.stringify(details); // lo que se guarda como cuenta inscrita (sin la conversión)
  let page = 'player';
  if (ctx.user.role === 'owner' && ctx.body.page === 'live') page = 'live';
  // USDT: se convierte con la TRM del momento del envío, menos el descuento configurado (3 % por defecto)
  if (method === 'usdt') {
    let q;
    try { q = await usdCop(); } catch (e) { console.error('No se pudo consultar la TRM:', e.message); fail(503, 'No se pudo consultar la TRM ahora. Intenta de nuevo en un momento.'); }
    const usdt = toUsdt(amount, q.trm, money.usdtDiscount);
    if (!(usdt >= 0.01)) fail(400, 'El monto es muy bajo para convertirlo a USDT.');
    details.conversion = { trm: q.trm, source: q.source, discount: money.usdtDiscount, usdt, at: q.at };
  }
  const rows = await query(
    `WITH upd AS (
       UPDATE users SET balance = balance - $3::float8 WHERE id = $2 AND balance >= $3::float8 RETURNING id, username
     )
     INSERT INTO withdrawals (id, user_id, username, page, game_code, amount, method, details_enc, status, created_at)
     SELECT $1::text, upd.id, upd.username, $4::text, NULL, $3::float8, $5::text, $6::text, 'pending', $7::text FROM upd
     RETURNING id`,
    [uid(), ctx.user.id, amount, page, method, encryptJson(details), now()],
  );
  if (!rows[0]) fail(400, 'No tienes saldo suficiente para ese monto.');
  let saved = null;
  if (ctx.body.saveAccount && !ctx.body.accountId) {
    try { saved = await saveAccount(ctx.user.id, method, JSON.parse(savedCopy)); } catch { /* si ya llegó al límite, el retiro igual sale */ }
  }
  const me = await one('SELECT balance FROM users WHERE id = $1', [ctx.user.id]);
  return { ok: true, balance: num(me.balance), conversion: details.conversion || null, saved: saved ? { id: saved.id, label: saved.label } : null };
});

// Vista previa de la conversión a USDT (la cifra final la calcula el servidor al enviar)
route('GET', '/api/usdt-rate', { auth: true }, async () => {
  const money = await getSite('money', normMoneyRead);
  let q;
  try { q = await usdCop(); } catch { fail(503, 'No se pudo consultar la TRM ahora.'); }
  return { trm: q.trm, source: q.source, discount: money.usdtDiscount };
});

route('GET', '/api/withdrawals', { auth: true }, async (ctx) => {
  const isOwner = ctx.user.role === 'owner';
  let rows;
  if (isOwner && ctx.query.mine !== '1') {
    rows = await query(`SELECT w.*, u.email FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id ORDER BY w.created_at DESC LIMIT 300`);
  } else {
    rows = await query(`SELECT w.*, u.email FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id WHERE w.user_id = $1 ORDER BY w.created_at DESC LIMIT 100`, [ctx.user.id]);
  }
  return { withdrawals: rows.map((w) => wdOut(w, isOwner ? 'owner' : 'self')) };
});

route('POST', '/api/withdrawals/:id/paid', { auth: 'owner' }, async (ctx) => {
  const rows = await query(`UPDATE withdrawals SET status = 'paid', resolved_at = $2 WHERE id = $1 AND status = 'pending' RETURNING id`, [ctx.params.id, now()]);
  if (!rows[0]) fail(409, 'Esta solicitud ya fue resuelta.');
  return { ok: true };
});

route('POST', '/api/withdrawals/:id/reject', { auth: 'owner' }, async (ctx) => {
  const rows = await query(
    `WITH w AS (
       UPDATE withdrawals SET status = 'rejected', resolved_at = $2 WHERE id = $1 AND status = 'pending' RETURNING user_id, amount
     )
     UPDATE users SET balance = balance + (SELECT amount FROM w) WHERE id = (SELECT user_id FROM w) RETURNING id`,
    [ctx.params.id, now()],
  );
  if (!rows[0]) fail(409, 'Esta solicitud ya fue resuelta.');
  return { ok: true };
});

// =====================================================================
// SOPORTE
// =====================================================================
async function ticketsOut(rows) {
  if (!rows.length) return [];
  const ids = rows.map((t) => t.id);
  const msgs = await query(`SELECT * FROM ticket_msgs WHERE ticket_id = ANY($1::text[]) ORDER BY created_at ASC`, [ids]);
  return rows.map((t) => ({
    id: t.id, username: t.username, email: t.email, phone: t.phone, contact: t.contact, guest: !!t.guest,
    subject: t.subject, status: t.status, adminUnread: !!t.admin_unread, playerUnread: !!t.player_unread,
    createdAt: t.created_at, updatedAt: t.updated_at,
    msgs: msgs.filter((m) => m.ticket_id === t.id).map((m) => ({ from: m.from_role, text: m.body, at: m.created_at })),
  }));
}

async function newTicket({ user, name, contact, text }) {
  const body = String(text || '').trim().slice(0, 600);
  if (body.length < 3) fail(400, 'Escribe tu mensaje.');
  const id = uid(), t = now();
  await query(
    `INSERT INTO tickets (id, user_id, username, email, phone, contact, guest, subject, status, admin_unread, player_unread, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',1,0,$9,$9)`,
    [id, user ? user.id : null, user ? user.username : name, user ? user.email : '', user ? user.phone : '', user ? '' : contact, user ? 0 : 1, body.slice(0, 50), t],
  );
  await query(`INSERT INTO ticket_msgs (id, ticket_id, from_role, body, created_at) VALUES ($1,$2,'player',$3,$4)`, [uid(), id, body, t]);
  return id;
}

route('GET', '/api/tickets', { auth: true }, async (ctx) => {
  const rows = ctx.user.role === 'owner'
    ? await query(`SELECT * FROM tickets ORDER BY updated_at DESC LIMIT 200`)
    : await query(`SELECT * FROM tickets WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`, [ctx.user.id]);
  return { tickets: await ticketsOut(rows) };
});

route('POST', '/api/tickets', { auth: true }, async (ctx) => {
  if (ctx.user.role === 'owner') fail(400, 'El dueño recibe los mensajes en Administrador → Soporte.');
  const wait = await lockedFor('tk:' + ctx.user.id);
  if (wait) fail(429, `Espera ${wait} segundos antes de enviar otra consulta.`);
  await recordFail('tk:' + ctx.user.id, 10, 5 * 60_000);
  const id = await newTicket({ user: ctx.user, text: ctx.body.text });
  const rows = await query('SELECT * FROM tickets WHERE id = $1', [id]);
  return { ticket: (await ticketsOut(rows))[0] };
});

route('POST', '/api/tickets/guest', async (ctx) => {
  const name = String(ctx.body.name || '').trim().slice(0, 40);
  const contact = String(ctx.body.contact || '').trim().slice(0, 80);
  if (!name || !contact) fail(400, 'Escribe tu usuario o nombre y un correo o celular para responderte.');
  const wait = await lockedFor('guest:' + ctx.ip);
  if (wait) fail(429, `Demasiados mensajes. Espera ${wait} segundos.`);
  await recordFail('guest:' + ctx.ip, 5, 15 * 60_000);
  await newTicket({ user: null, name, contact, text: ctx.body.text });
  return { ok: true };
});

route('POST', '/api/tickets/:id/reply', { auth: true }, async (ctx) => {
  const t = await one('SELECT * FROM tickets WHERE id = $1', [ctx.params.id]);
  if (!t) fail(404, 'Consulta no encontrada.');
  const isOwner = ctx.user.role === 'owner';
  if (!isOwner && t.user_id !== ctx.user.id) fail(403, 'No es tu consulta.');
  const text = String(ctx.body.text || '').trim().slice(0, 600);
  if (!text) fail(400, 'Escribe tu mensaje.');
  if (isOwner && t.guest) fail(400, 'Este mensaje llegó sin sesión: contáctalo con sus datos.');
  if (!isOwner && t.status !== 'open') fail(409, 'Esta consulta está resuelta. Crea una nueva.');
  const stamp = now();
  await query(`INSERT INTO ticket_msgs (id, ticket_id, from_role, body, created_at) VALUES ($1,$2,$3,$4,$5)`, [uid(), t.id, isOwner ? 'admin' : 'player', text, stamp]);
  await query(
    isOwner
      ? `UPDATE tickets SET updated_at = $2, player_unread = 1, admin_unread = 0 WHERE id = $1`
      : `UPDATE tickets SET updated_at = $2, admin_unread = 1 WHERE id = $1`,
    [t.id, stamp],
  );
  return { ok: true };
});

route('POST', '/api/tickets/:id/read', { auth: true }, async (ctx) => {
  if (ctx.user.role === 'owner') await query('UPDATE tickets SET admin_unread = 0 WHERE id = $1', [ctx.params.id]);
  else await query('UPDATE tickets SET player_unread = 0 WHERE id = $1 AND user_id = $2', [ctx.params.id, ctx.user.id]);
  return { ok: true };
});

route('POST', '/api/tickets/:id/toggle', { auth: 'owner' }, async (ctx) => {
  await query(
    `UPDATE tickets SET status = CASE WHEN status = 'open' THEN 'closed' ELSE 'open' END, updated_at = $2, admin_unread = 0 WHERE id = $1`,
    [ctx.params.id, now()],
  );
  return { ok: true };
});

// =====================================================================
// ADMINISTRADOR
// =====================================================================
route('GET', '/api/admin/config/:page', { auth: 'owner' }, async (ctx) => {
  if (!['live', 'player'].includes(ctx.params.page)) fail(400, 'Página no válida.');
  return { config: await getConfig(ctx.params.page) };
});

route('PUT', '/api/admin/config/:page', { auth: 'owner' }, async (ctx) => {
  if (!['live', 'player'].includes(ctx.params.page)) fail(400, 'Página no válida.');
  const cfg = normConfig(ctx.body.config);
  await setSite('config:' + ctx.params.page, cfg);
  return { config: cfg };
});

route('GET', '/api/admin/progress/:page', { auth: 'owner' }, async (ctx) => {
  if (!['live', 'player'].includes(ctx.params.page)) fail(400, 'Página no válida.');
  const g = await one(`SELECT * FROM games WHERE user_id = $1 AND page = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [ctx.user.id, ctx.params.page]);
  return { progress: g ? progressOf(g) : null };
});

route('GET', '/api/admin/site', { auth: 'owner' }, async () => publicSite());

route('PUT', '/api/admin/site', { auth: 'owner' }, async (ctx) => {
  const b = ctx.body;
  if (b.texts) await setSite('texts', normTexts(b.texts));
  if (b.money) await setSite('money', normMoney(b.money));
  if (b.support) await setSite('support', normSupport(b.support));
  return publicSite();
});

route('GET', '/api/admin/players', { auth: 'owner' }, async () => {
  const rows = await query(
    `SELECT u.*, (SELECT count(*)::int FROM withdrawals w WHERE w.user_id = u.id) AS wd_count,
            (SELECT count(*)::int FROM games g WHERE g.user_id = u.id) AS game_count
     FROM users u WHERE u.role = 'player' ORDER BY u.created_at DESC LIMIT 500`,
  );
  return { players: rows.map((u) => ({ ...pubUser(u), withdrawals: u.wd_count, games: u.game_count })) };
});

// Restablecer la clave de un jugador (mientras no haya correo configurado): el dueño recibe una clave temporal para dársela.
route('POST', '/api/admin/players/:id/reset-password', { auth: 'owner' }, async (ctx) => {
  const u = await one(`SELECT * FROM users WHERE id = $1 AND role = 'player'`, [ctx.params.id]);
  if (!u) fail(404, 'Jugador no encontrado.');
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let temp = '';
  for (let i = 0; i < 10; i++) temp += alphabet[crypto.randomInt(0, alphabet.length)];
  await query('UPDATE users SET pass_hash = $1 WHERE id = $2', [await hashPassword(temp), u.id]); // sus sesiones abiertas se cierran
  await query('DELETE FROM reset_codes WHERE user_id = $1', [u.id]);
  await clearFails('login:' + u.id);
  await clearFails('pw:' + u.id);
  return { username: u.username, password: temp };
});

route('DELETE', '/api/admin/players/:id', { auth: 'owner' }, async (ctx) => {
  const u = await one(`SELECT * FROM users WHERE id = $1 AND role = 'player'`, [ctx.params.id]);
  if (!u) fail(404, 'Jugador no encontrado.');
  if (await one(`SELECT 1 AS x FROM withdrawals WHERE user_id = $1 AND status = 'pending'`, [u.id])) {
    fail(409, 'Tiene retiros pendientes. Resuélvelos antes de eliminar la cuenta.');
  }
  await query('DELETE FROM games WHERE user_id = $1', [u.id]);
  await query('DELETE FROM reset_codes WHERE user_id = $1', [u.id]);
  await query('DELETE FROM payout_accounts WHERE user_id = $1', [u.id]);
  await query('DELETE FROM users WHERE id = $1', [u.id]);
  return { ok: true };
});

// =====================================================================
// ENTRADA ÚNICA
// =====================================================================
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      if (Number(req.headers['content-length']) > 100_000) fail(413, 'Datos demasiado grandes.');
      return req.body;
    }
    try { return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body)); } catch { fail(400, 'Datos no válidos.'); }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 100_000) fail(413, 'Datos demasiado grandes.');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Datos no válidos.'); }
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket?.remoteAddress || 'local';
}

function send(res, status, data, extraHeaders) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (extraHeaders && extraHeaders.length) res.setHeader('Set-Cookie', extraHeaders);
  res.end(JSON.stringify(data));
}

export async function handle(req, res) {
  const cookies = [];
  try {
    const url = new URL(req.url, 'http://local');
    // Vercel reenvía /api/... a /api/index?__p=...; aquí se recupera la ruta original
    const rewritten = url.searchParams.get('__p');
    if (rewritten !== null) {
      url.searchParams.delete('__p');
      if (/^\/api\/index(\.js)?$/.test(url.pathname)) url.pathname = '/api/' + rewritten;
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';
    const route_ = routes.find((r) => r.method === method && r.re.test(path));
    if (!route_) return send(res, 404, { error: 'No encontrado.' });

    // protección contra peticiones de otros sitios (CSRF)
    if (method !== 'GET') {
      const ct = String(req.headers['content-type'] || '');
      if (!ct.includes('application/json')) fail(415, 'Tipo de contenido no permitido.');
      const origin = req.headers.origin;
      if (origin) {
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
        let oh = '';
        try { oh = new URL(origin).host; } catch { /* origen inválido */ }
        if (oh !== host) fail(403, 'Origen no permitido.');
      }
    }

    const m = route_.re.exec(path);
    const params = {};
    route_.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
    const query_ = Object.fromEntries(url.searchParams.entries());

    const user = await sessionUser(req);
    if (route_.opts.auth && !user) fail(401, 'Inicia sesión para continuar.');
    if (route_.opts.auth === 'owner' && user.role !== 'owner') fail(403, 'Solo el dueño puede hacer esto.');

    const ctx = { req, body, query: query_, params, user, ip: clientIp(req), setCookie: (c) => cookies.push(c) };
    const out = await route_.handler(ctx);
    return send(res, 200, out ?? { ok: true }, cookies);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message }, cookies);
    console.error('Error interno:', e);
    return send(res, 500, { error: 'Algo salió mal en el servidor. Intenta de nuevo.' });
  }
}

export { DEFAULT_TEXTS };
