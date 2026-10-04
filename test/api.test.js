import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.PGLITE_DIR = 'memory';
process.env.OWNER_SETUP_KEY = 'clave-de-prueba-123';
process.env.SESSION_SECRET = 'secreto-de-prueba-bastante-largo';
delete process.env.DATABASE_URL;
delete process.env.RESEND_API_KEY;

const { createServer } = await import('../dev.js');

let server, base;
const sent = []; // correos "enviados" (en desarrollo se imprimen)
const realLog = console.log;

before(async () => {
  console.log = (...a) => { const s = a.join(' '); if (s.includes('[correo de desarrollo]')) sent.push(s); else realLog(...a); };
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { console.log = realLog; server.close(); });

class Client {
  constructor() { this.cookie = ''; }
  async call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const pair = c.split(';')[0];
      if (/Max-Age=0/i.test(c)) this.cookie = ''; else this.cookie = pair;
    }
    let data = {};
    try { data = await res.json(); } catch { /* sin cuerpo */ }
    return { status: res.status, data };
  }
  get(p) { return this.call('GET', p); }
  post(p, b = {}) { return this.call('POST', p, b); }
  put(p, b = {}) { return this.call('PUT', p, b); }
  patch(p, b = {}) { return this.call('PATCH', p, b); }
  del(p) { return this.call('DELETE', p, {}); }
}

process.env.TRM_OVERRIDE = '4000';
const owner = new Client(), ana = new Client(), luis = new Client(), anon = new Client();
const lastCode = () => /Tu código es (\d{6})/.exec(sent.at(-1) || '')?.[1];

test('el dueño se crea con la clave de configuración y solo una vez', async () => {
  let r = await anon.post('/api/auth/owner', { username: 'dueno', email: 'dueno@x.com', phone: '+57 300 111 2233', password: 'claveSegura1', setupKey: 'incorrecta' });
  assert.equal(r.status, 403);
  r = await owner.post('/api/auth/owner', { username: 'dueno', email: 'dueno@x.com', phone: '+57 300 111 2233', password: 'claveSegura1', setupKey: 'clave-de-prueba-123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'owner');
  r = await anon.post('/api/auth/owner', { username: 'otro', email: 'otro@x.com', phone: '3001112233', password: 'claveSegura1', setupKey: 'clave-de-prueba-123' });
  assert.equal(r.status, 409);
});

test('registro valida los datos y no repite usuario ni correo', async () => {
  let r = await ana.post('/api/auth/register', { username: 'ab', email: 'ana@x.com', phone: '3015551212', password: 'secreto123' });
  assert.equal(r.status, 400);
  r = await ana.post('/api/auth/register', { username: 'ana_1', email: 'mal', phone: '3015551212', password: 'secreto123' });
  assert.equal(r.status, 400);
  r = await ana.post('/api/auth/register', { username: 'ana_1', email: 'ana@x.com', phone: '12', password: 'secreto123' });
  assert.equal(r.status, 400);
  r = await ana.post('/api/auth/register', { username: 'ana_1', email: 'ana@x.com', phone: '3015551212', password: 'corta' });
  assert.equal(r.status, 400);
  r = await ana.post('/api/auth/register', { username: 'ana_1', email: 'ana@x.com', phone: '+1 (415) 555-0100', password: 'secreto123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'player');
  assert.equal(r.data.user.phone, '14155550100');
  assert.equal(r.data.user.passHash, undefined);
  r = await luis.post('/api/auth/register', { username: 'ANA_1', email: 'otro@x.com', phone: '3015551212', password: 'secreto123' });
  assert.equal(r.status, 409);
  r = await luis.post('/api/auth/register', { username: 'luis', email: 'ana@x.com', phone: '3015551212', password: 'secreto123' });
  assert.equal(r.status, 409);
  r = await luis.post('/api/auth/register', { username: 'luis', email: 'luis@x.com', phone: '3015551212', password: 'secreto123' });
  assert.equal(r.status, 200);
});

test('sesión: /api/me, logout, login por usuario o correo, bloqueo por intentos', async () => {
  let r = await anon.get('/api/me');
  assert.equal(r.data.user, null);
  assert.ok(r.data.site.texts.title);
  r = await ana.get('/api/me');
  assert.equal(r.data.user.username, 'ana_1');
  await ana.post('/api/auth/logout');
  r = await ana.get('/api/me');
  assert.equal(r.data.user, null);
  r = await ana.post('/api/auth/login', { id: 'ANA@x.com', password: 'secreto123' });
  assert.equal(r.status, 200);
  const evil = new Client();
  for (let i = 0; i < 5; i++) assert.equal((await evil.post('/api/auth/login', { id: 'luis', password: 'mala' + i })).status, 401);
  r = await evil.post('/api/auth/login', { id: 'luis', password: 'secreto123' });
  assert.equal(r.status, 429, 'tras 5 fallos la cuenta se bloquea aunque la clave sea correcta');
});

test('recuperar clave por correo: código de 6 dígitos de un solo uso', async () => {
  const c = new Client();
  let r = await c.post('/api/auth/forgot', { email: 'noexiste@x.com' });
  assert.equal(r.status, 200, 'misma respuesta para un correo que no existe');
  assert.equal(sent.length, 0, 'y no se envía nada');
  r = await c.post('/api/auth/forgot', { email: 'ana@x.com' });
  assert.equal(r.status, 200);
  const code = lastCode();
  assert.match(code, /^\d{6}$/);
  r = await c.post('/api/auth/reset', { email: 'ana@x.com', code: '000000', password: 'nuevaClave99' });
  assert.equal(r.status, 400);
  r = await c.post('/api/auth/reset', { email: 'ana@x.com', code, password: 'corta' });
  assert.equal(r.status, 400);
  r = await c.post('/api/auth/reset', { email: 'ana@x.com', code, password: 'nuevaClave99' });
  assert.equal(r.status, 200);
  r = await c.post('/api/auth/reset', { email: 'ana@x.com', code, password: 'otraClave99' });
  assert.equal(r.status, 400, 'el código ya no sirve');
  assert.equal((await ana.get('/api/me')).data.user, null, 'las sesiones anteriores se cierran al cambiar la clave');
  assert.equal((await ana.post('/api/auth/login', { id: 'ana_1', password: 'secreto123' })).status, 401);
  assert.equal((await ana.post('/api/auth/login', { id: 'ana_1', password: 'nuevaClave99' })).status, 200);
});

test('seguridad básica: sin sesión, sin permisos y sin peticiones de otros sitios', async () => {
  assert.equal((await anon.get('/api/game?page=player')).status, 401);
  assert.equal((await ana.get('/api/admin/players')).status, 403);
  assert.equal((await ana.put('/api/admin/config/player', { config: {} })).status, 403);
  assert.equal((await ana.get('/api/game?page=live')).status, 403, 'un jugador no entra al juego del dueño');
  assert.equal((await anon.call('POST', '/api/auth/login', { id: 'a', password: 'b' }, { Origin: 'https://sitio-malo.com' })).status, 403);
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
  assert.equal((await anon.get('/api/no-existe')).status, 404);
});

test('el dueño configura premios; el jugador no ve cuántos hay ni el reparto', async () => {
  const cfg = {
    totalCells: 20,
    tiers: [
      { key: 'oro', emoji: '🏆', label: 'Oro', count: 5, points: 1000, wipeout: false },
      { key: 'mina', emoji: '💣', label: 'Bomba', count: 14, points: -100, wipeout: false },
      { key: 'roja', emoji: '🔴', label: 'Roja', count: 1, points: 0, wipeout: true },
    ],
    settings: { wipeEndsGame: true, unit: 'pts' },
  };
  let r = await owner.put('/api/admin/config/player', { config: cfg });
  assert.equal(r.status, 200);
  assert.equal(r.data.config.totalCells, 20);
  r = await owner.put('/api/admin/site', { money: { pointValue: 2, minWithdraw: 100, methods: { banco: true, breb: true, usdt: true, nequi: true } } });
  assert.equal(r.data.money.pointValue, 2);
  assert.equal(r.data.money.payoutHours, 12, 'por defecto el pago se acredita en 12 horas');
  r = await ana.get('/api/game?page=player');
  assert.equal(r.status, 200);
  const g = r.data.game;
  assert.equal(g.totalCells, 20);
  assert.equal(g.tiers.length, 3);
  assert.ok(g.tiers.every((t) => t.count === undefined), 'el jugador no ve las cantidades');
  assert.equal(g.map, undefined);
  assert.match(g.code, /^JG-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.deepEqual(g.opened, []);
  r = await owner.get('/api/game?page=player');
  assert.ok(r.data.game.tiers.every((t) => t.count === undefined), 'ni el dueño recibe las cantidades en las páginas de juego');
  assert.equal(r.data.game.totals, undefined);
  r = await owner.get('/api/admin/progress/player');
  assert.equal(r.data.progress.tiers.reduce((a, t) => a + t.total, 0), 20, 'el avance por premio sale solo en la ruta de administrador');
  assert.equal(r.data.progress.openedCount, 0);
  assert.equal((await ana.get('/api/admin/progress/player')).status, 403);
  assert.equal((await anon.get('/api/admin/progress/player')).status, 401);
});

// Juega hasta destapar una casilla de premio positivo sin bomba roja, probando varias partidas.
async function playToCash(client, wantGain = true) {
  for (let tries = 0; tries < 60; tries++) {
    let r = await client.get('/api/game?page=player');
    let game = r.data.game;
    for (let i = 0; i < game.totalCells; i++) {
      r = await client.post('/api/game/reveal', { id: game.id, idx: i });
      game = r.data.game;
      if (game.status === 'bomb') break;
      if (wantGain && game.points >= 1000) {
        r = await client.post('/api/game/cash', { id: game.id });
        return { cash: r, game: r.data.game };
      }
    }
    await client.post('/api/game/restart', { id: game.id });
  }
  throw new Error('no se logró una partida con ganancia');
}

test('juego: destapar, no repetir casilla, cobrar suma saldo en pesos, no cobrar dos veces', async () => {
  let r = await luis.get('/api/game?page=player');
  const id = r.data.game.id;
  assert.equal((await luis.post('/api/game/reveal', { id, idx: -1 })).status, 400);
  assert.equal((await luis.post('/api/game/reveal', { id, idx: 99 })).status, 400);
  assert.equal((await luis.post('/api/game/reveal', { id, idx: 'x' })).status, 400);
  assert.equal((await luis.post('/api/game/cash', { id })).status, 400, 'no se puede cobrar sin destapar');
  r = await luis.post('/api/game/reveal', { id, idx: 3 });
  assert.equal(r.data.game.opened.length, 1);
  assert.equal((await luis.post('/api/game/reveal', { id, idx: 3 })).status, 409);
  assert.equal((await ana.post('/api/game/reveal', { id, idx: 4 })).status, 404, 'no se juega la partida de otro');

  const { cash, game } = await playToCash(ana);
  assert.equal(game.status, 'cashed');
  assert.ok(game.points >= 1000);
  assert.equal(game.pesos, game.points * 2);
  assert.equal(cash.data.balance, game.pesos);
  assert.equal((await ana.post('/api/game/cash', { id: game.id })).status, 409);
  assert.equal((await ana.post('/api/game/reveal', { id: game.id, idx: 19 })).status, 409);
  assert.equal((await ana.get('/api/me')).data.user.balance, game.pesos);
});

test('la bomba roja termina el juego y no da saldo', async () => {
  for (let tries = 0; tries < 80; tries++) {
    let r = await luis.get('/api/game?page=player');
    let game = r.data.game;
    for (let i = 0; i < game.totalCells && game.status === 'active'; i++) {
      if (game.opened.some((o) => o.idx === i)) continue;
      game = (await luis.post('/api/game/reveal', { id: game.id, idx: i })).data.game;
    }
    if (game.status === 'bomb') {
      assert.equal((await luis.post('/api/game/cash', { id: game.id })).status, 409);
      assert.equal((await luis.get('/api/me')).data.user.balance, 0);
      return;
    }
    await luis.post('/api/game/restart', { id: game.id });
  }
  assert.fail('no cayó una bomba roja en 80 partidas');
});

test('reiniciar guarda el juego anterior en el historial con su código', async () => {
  let r = await luis.get('/api/game?page=player');
  const first = r.data.game;
  if (first.status === 'active' && first.opened.length === 0) await luis.post('/api/game/reveal', { id: first.id, idx: 0 });
  r = await luis.get('/api/game?page=player');
  const cur = r.data.game;
  r = await luis.post('/api/game/restart', { id: cur.id });
  assert.notEqual(r.data.game.code, cur.code);
  r = await luis.get('/api/history');
  assert.ok(r.data.games.some((g) => g.code === cur.code));
  assert.equal(new Set(r.data.games.map((g) => g.code)).size, r.data.games.length, 'cada código es único');
});

const BANK = { bank: 'Bancolombia', acctType: 'Ahorros', number: '1234567890', holder: 'Ana Prueba', doc: '1234567' };

test('retiros: valida datos, descuenta el saldo, permite montos parciales y cifra los datos', async () => {
  const before = (await ana.get('/api/me')).data.user.balance;
  assert.ok(before >= 2000);
  assert.equal((await ana.post('/api/withdrawals', { amount: 50, method: 'banco', details: BANK })).status, 400, 'bajo el mínimo');
  assert.equal((await ana.post('/api/withdrawals', { amount: 500, method: 'banco', details: { ...BANK, number: '12' } })).status, 400);
  assert.equal((await ana.post('/api/withdrawals', { amount: 500, method: 'usdt', details: { wallet: 'ABC' } })).status, 400);
  assert.equal((await ana.post('/api/withdrawals', { amount: 500, method: 'daviplata', details: { number: '3001112233', holder: 'x' } })).status, 400, 'medio apagado');
  assert.equal((await ana.post('/api/withdrawals', { amount: before + 1, method: 'banco', details: BANK })).status, 400, 'más que el saldo');
  let r = await ana.post('/api/withdrawals', { amount: 500, method: 'banco', details: BANK });
  assert.equal(r.status, 200);
  assert.equal(r.data.balance, before - 500);
  r = await ana.post('/api/withdrawals', { amount: 300, method: 'usdt', details: { wallet: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.balance, before - 800);
  assert.deepEqual([r.data.conversion.trm, r.data.conversion.discount, r.data.conversion.usdt], [4000, 3, 0.07], '300 pesos / 4000 menos 3 %, hacia abajo');
  assert.equal((await ana.get('/api/usdt-rate')).data.trm, 4000);
  assert.equal((await anon.get('/api/usdt-rate')).status, 401);
  assert.equal((await ana.get('/api/withdrawals')).data.withdrawals.find((w) => w.method === 'usdt').details.conversion.usdt, 0.07, 'queda guardado para el dueño');
  r = await ana.post('/api/withdrawals', { amount: 200, method: 'breb', details: { keyType: 'Correo', key: 'ana@x.com', holder: 'Ana' } });
  assert.equal(r.status, 200);
  r = await ana.get('/api/withdrawals');
  assert.equal(r.data.withdrawals.length, 3);
  assert.equal(r.data.withdrawals.find((w) => w.method === 'banco').details.number, '1234567890');
  assert.equal((await luis.get('/api/withdrawals')).data.withdrawals.length, 0, 'cada quien ve solo los suyos');
});

test('solo el dueño aprueba o rechaza; rechazar devuelve el saldo; no se resuelve dos veces', async () => {
  let r = await owner.get('/api/withdrawals');
  const list = r.data.withdrawals;
  assert.equal(list.length, 3);
  assert.ok(list.every((w) => w.status === 'pending' && w.email === 'ana@x.com'));
  const bank = list.find((w) => w.method === 'banco');
  const usdt = list.find((w) => w.method === 'usdt');
  assert.equal((await ana.post(`/api/withdrawals/${bank.id}/paid`)).status, 403);
  assert.equal((await ana.post(`/api/withdrawals/${bank.id}/reject`)).status, 403);
  assert.equal((await owner.post(`/api/withdrawals/${bank.id}/paid`)).status, 200);
  assert.equal((await owner.post(`/api/withdrawals/${bank.id}/paid`)).status, 409);
  assert.equal((await owner.post(`/api/withdrawals/${bank.id}/reject`)).status, 409, 'uno pagado no se puede rechazar');
  const bal = (await ana.get('/api/me')).data.user.balance;
  assert.equal((await owner.post(`/api/withdrawals/${usdt.id}/reject`)).status, 200);
  assert.equal((await ana.get('/api/me')).data.user.balance, bal + 300);
  assert.equal((await owner.post(`/api/withdrawals/${usdt.id}/reject`)).status, 409, 'no se devuelve el saldo dos veces');
  r = await ana.get('/api/withdrawals');
  assert.deepEqual(r.data.withdrawals.map((w) => w.status).sort(), ['paid', 'pending', 'rejected']);
});

test('los datos de pago no quedan en texto plano en la base de datos', async () => {
  const { query } = await import('../lib/db.js');
  const rows = await query('SELECT details_enc FROM withdrawals');
  assert.ok(rows.length >= 3);
  for (const row of rows) {
    assert.ok(!row.details_enc.includes('1234567890'));
    assert.ok(!row.details_enc.includes('TQn9Y2'));
    assert.ok(!row.details_enc.includes('ana@x.com'));
  }
});

test('soporte: jugador escribe, el dueño responde y resuelve; mensaje sin sesión', async () => {
  let r = await ana.post('/api/tickets', { text: 'Mi retiro no ha llegado' });
  assert.equal(r.status, 200);
  const id = r.data.ticket.id;
  assert.equal((await owner.get('/api/me')).data.unread, 1);
  r = await owner.get('/api/tickets');
  assert.equal(r.data.tickets.length, 1);
  assert.equal(r.data.tickets[0].adminUnread, true);
  assert.equal((await luis.post(`/api/tickets/${id}/reply`, { text: 'intruso' })).status, 403);
  assert.equal((await owner.post(`/api/tickets/${id}/reply`, { text: 'Ya lo revisamos' })).status, 200);
  assert.equal((await ana.get('/api/me')).data.unread, 1);
  r = await ana.get('/api/tickets');
  assert.equal(r.data.tickets[0].msgs.length, 2);
  assert.equal(r.data.tickets[0].msgs[1].from, 'admin');
  assert.equal((await ana.post(`/api/tickets/${id}/read`)).status, 200);
  assert.equal((await ana.get('/api/me')).data.unread, 0);
  assert.equal((await ana.post(`/api/tickets/${id}/reply`, { text: 'gracias' })).status, 200);
  assert.equal((await owner.post(`/api/tickets/${id}/toggle`)).status, 200);
  assert.equal((await ana.post(`/api/tickets/${id}/reply`, { text: 'más' })).status, 409, 'resuelto: no se sigue escribiendo');
  r = await anon.post('/api/tickets/guest', { name: 'Pedro', contact: 'pedro@x.com', text: 'No puedo entrar' });
  assert.equal(r.status, 200);
  r = await owner.get('/api/tickets');
  const guest = r.data.tickets.find((t) => t.guest);
  assert.ok(guest);
  assert.equal((await owner.post(`/api/tickets/${guest.id}/reply`, { text: 'hola' })).status, 400);
  assert.equal((await anon.post('/api/tickets/guest', { name: '', contact: '', text: 'x' })).status, 400);
});

test('perfil: cambia datos, no el usuario; cambiar correo y clave piden la clave actual', async () => {
  let r = await ana.patch('/api/me', { fullName: 'Ana Pérez', phone: '3019998877', username: 'hacker' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.username, 'ana_1');
  assert.equal(r.data.user.fullName, 'Ana Pérez');
  assert.equal((await ana.patch('/api/me', { phone: '12' })).status, 400);
  assert.equal((await ana.patch('/api/me', { email: 'nuevo@x.com' })).status, 403);
  assert.equal((await ana.patch('/api/me', { email: 'luis@x.com', currentPassword: 'nuevaClave99' })).status, 409);
  assert.equal((await ana.patch('/api/me', { email: 'nuevo@x.com', currentPassword: 'nuevaClave99' })).status, 200);
  assert.equal((await ana.post('/api/me/password', { current: 'mala', next: 'otraClave123' })).status, 403);
  assert.equal((await ana.post('/api/me/password', { current: 'nuevaClave99', next: 'corta' })).status, 400);
  assert.equal((await ana.post('/api/me/password', { current: 'nuevaClave99', next: 'claveTercera1' })).status, 200);
  assert.equal((await ana.get('/api/me')).data.user.username, 'ana_1', 'la sesión actual sigue activa');
  assert.equal((await new Client().post('/api/auth/login', { id: 'nuevo@x.com', password: 'claveTercera1' })).status, 200);
});

test('administrador: lista y elimina jugadores (no con retiros pendientes)', async () => {
  let r = await owner.get('/api/admin/players');
  assert.equal(r.data.players.length, 2);
  const ana_ = r.data.players.find((p) => p.username === 'ana_1');
  assert.equal((await owner.del(`/api/admin/players/${ana_.id}`)).status, 409, 'tiene un retiro pendiente');
  const luis_ = r.data.players.find((p) => p.username === 'luis');
  assert.equal((await owner.del(`/api/admin/players/${luis_.id}`)).status, 200);
  assert.equal((await owner.get('/api/admin/players')).data.players.length, 1);
});

test('el dueño restablece la clave de un jugador con una clave temporal', async () => {
  const list = (await owner.get('/api/admin/players')).data.players;
  const ana_ = list.find((p) => p.username === 'ana_1');
  assert.equal((await ana.post('/api/admin/players/' + ana_.id + '/reset-password', {})).status, 403, 'un jugador no puede');
  assert.equal((await owner.post('/api/admin/players/nadie/reset-password', {})).status, 404);
  const r = await owner.post('/api/admin/players/' + ana_.id + '/reset-password', {});
  assert.equal(r.status, 200);
  assert.match(r.data.password, /^[A-Za-z0-9]{10}$/);
  assert.equal((await ana.get('/api/me')).data.user, null, 'su sesión anterior se cerró');
  assert.equal((await ana.post('/api/auth/login', { id: 'ana_1', password: 'nuevaClave99' })).status, 401);
  assert.equal((await ana.post('/api/auth/login', { id: 'ana_1', password: r.data.password })).status, 200);
  assert.equal((await anon.get('/api/me')).data.mailEnabled, false);
});

test('el dueño juega en la página Jugar y cobra a su saldo', async () => {
  await owner.put('/api/admin/config/live', { config: { totalCells: 10, tiers: [{ key: 'a', emoji: '⭐', label: 'A', count: 10, points: 500, wipeout: false }], settings: {} } });
  let r = await owner.get('/api/game?page=live');
  assert.equal(r.data.game.page, 'live');
  const id = r.data.game.id;
  await owner.post('/api/game/reveal', { id, idx: 0 });
  await owner.post('/api/game/reveal', { id, idx: 1 });
  r = await owner.post('/api/game/cash', { id });
  assert.equal(r.data.game.points, 1000);
  assert.equal(r.data.balance, 2000);
  r = await owner.post('/api/withdrawals', { amount: 1000, method: 'banco', page: 'live', details: BANK });
  assert.equal(r.status, 200);
  r = await owner.get('/api/withdrawals?mine=1');
  assert.equal(r.data.withdrawals[0].page, 'live');
});

test('la ruta reescrita por Vercel (/api/index?__p=...) llega al mismo lugar', async () => {
  let r = await anon.get('/api/index?__p=auth/owner-exists');
  assert.equal(r.status, 200);
  assert.equal(r.data.exists, true);
  r = await owner.get('/api/index?__p=withdrawals&mine=1');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.withdrawals));
  assert.equal((await anon.get('/api/index?__p=no/existe')).status, 404);
});

test('cuentas inscritas: se guardan completas, se usan sin pedir datos y son privadas', async () => {
  let r = await owner.post('/api/accounts', { method: 'banco', details: { ...BANK, number: '12' } });
  assert.equal(r.status, 400, 'datos incompletos no se inscriben');
  r = await owner.post('/api/accounts', { method: 'banco', details: BANK });
  assert.equal(r.status, 200);
  assert.match(r.data.account.label, /Bancolombia · Ahorros ····7890 · Ana Prueba/);
  const id = r.data.account.id;
  assert.equal((await owner.post('/api/accounts', { method: 'banco', details: BANK })).data.already, true, 'la misma cuenta no se duplica');
  r = await owner.post('/api/accounts', { method: 'breb', details: { keyType: 'Correo', key: 'dueno@x.com', holder: 'Dueño' } });
  assert.equal(r.status, 200);
  r = await owner.get('/api/accounts');
  assert.equal(r.data.accounts.length, 2);
  assert.ok(!JSON.stringify(r.data).includes('1234567890'), 'la lista no trae el número completo');
  assert.equal((await ana.get('/api/accounts')).data.accounts.length, 0, 'cada quien ve solo las suyas');
  assert.equal((await ana.post('/api/withdrawals', { amount: 100, accountId: id })).status, 404, 'no se usa la cuenta de otro');

  const before = (await owner.get('/api/me')).data.user.balance;
  r = await owner.post('/api/withdrawals', { amount: 100, accountId: id, page: 'live' });
  assert.equal(r.status, 200);
  assert.equal(r.data.balance, before - 100);
  const w = (await owner.get('/api/withdrawals?mine=1')).data.withdrawals[0];
  assert.equal(w.method, 'banco');
  assert.equal(w.details.number, '1234567890', 'el retiro lleva los datos completos de la cuenta inscrita');

  r = await owner.post('/api/withdrawals', { amount: 100, method: 'nequi', details: { number: '3001112233', holder: 'Dueño' }, saveAccount: true });
  assert.equal(r.status, 200);
  assert.match(r.data.saved.label, /Nequi ····2233/);
  assert.equal((await owner.get('/api/accounts')).data.accounts.length, 3);

  assert.equal((await ana.del('/api/accounts/' + id)).status, 404);
  assert.equal((await owner.del('/api/accounts/' + id)).status, 200);
  assert.equal((await owner.post('/api/withdrawals', { amount: 100, accountId: id })).status, 404, 'cuenta eliminada');
});
