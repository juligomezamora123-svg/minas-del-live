// Base de datos Postgres.
//  - En Vercel: Neon (variable DATABASE_URL), por HTTP, sin conexiones abiertas.
//  - En tu computador, sin DATABASE_URL: PGlite (un Postgres embebido que guarda en .data/pglite).
// Todo se guarda como texto / float8 para que ambos devuelvan exactamente los mismos tipos.

let ready = null;

async function open() {
  if (process.env.DATABASE_URL) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    return async (text, params = []) => await sql.query(text, params);
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const mode = process.env.PGLITE_DIR;
  let db;
  if (mode === 'memory') {
    db = new PGlite();
  } else {
    const fs = await import('node:fs');
    const dir = mode || '.data/pglite';
    fs.mkdirSync(dir, { recursive: true });
    db = new PGlite(dir);
  }
  await db.waitReady;
  return async (text, params = []) => (await db.query(text, params)).rows;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id text PRIMARY KEY,
     username text NOT NULL,
     email text NOT NULL UNIQUE,
     phone text NOT NULL DEFAULT '',
     full_name text NOT NULL DEFAULT '',
     pass_hash text NOT NULL,
     role text NOT NULL DEFAULT 'player',
     balance float8 NOT NULL DEFAULT 0,
     created_at text NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username))`,
  `CREATE TABLE IF NOT EXISTS site (
     key text PRIMARY KEY,
     value text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS games (
     id text PRIMARY KEY,
     code text NOT NULL UNIQUE,
     user_id text NOT NULL,
     page text NOT NULL,
     status text NOT NULL,
     map text NOT NULL,
     opened text NOT NULL DEFAULT '[]',
     cfg text NOT NULL,
     version int NOT NULL DEFAULT 0,
     points float8 NOT NULL DEFAULT 0,
     pesos float8 NOT NULL DEFAULT 0,
     lost float8 NOT NULL DEFAULT 0,
     created_at text NOT NULL,
     ended_at text
   )`,
  `CREATE INDEX IF NOT EXISTS games_user ON games (user_id, page, status)`,
  `CREATE TABLE IF NOT EXISTS withdrawals (
     id text PRIMARY KEY,
     user_id text NOT NULL,
     username text NOT NULL,
     page text NOT NULL,
     game_code text,
     amount float8 NOT NULL,
     method text NOT NULL,
     details_enc text NOT NULL,
     status text NOT NULL DEFAULT 'pending',
     created_at text NOT NULL,
     resolved_at text
   )`,
  `CREATE INDEX IF NOT EXISTS withdrawals_user ON withdrawals (user_id)`,
  `CREATE TABLE IF NOT EXISTS tickets (
     id text PRIMARY KEY,
     user_id text,
     username text NOT NULL,
     email text NOT NULL DEFAULT '',
     phone text NOT NULL DEFAULT '',
     contact text NOT NULL DEFAULT '',
     guest int NOT NULL DEFAULT 0,
     subject text NOT NULL,
     status text NOT NULL DEFAULT 'open',
     admin_unread int NOT NULL DEFAULT 1,
     player_unread int NOT NULL DEFAULT 0,
     created_at text NOT NULL,
     updated_at text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS ticket_msgs (
     id text PRIMARY KEY,
     ticket_id text NOT NULL,
     from_role text NOT NULL,
     body text NOT NULL,
     created_at text NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ticket_msgs_ticket ON ticket_msgs (ticket_id)`,
  `CREATE TABLE IF NOT EXISTS reset_codes (
     user_id text PRIMARY KEY,
     code_hash text NOT NULL,
     expires float8 NOT NULL,
     attempts int NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
     key text PRIMARY KEY,
     n int NOT NULL DEFAULT 0,
     until float8 NOT NULL DEFAULT 0,
     updated float8 NOT NULL DEFAULT 0
   )`,
];

async function migrate(q) {
  for (const stmt of SCHEMA) await q(stmt);
}

export async function query(text, params) {
  if (!ready) {
    ready = open().then(async (q) => { await migrate(q); return q; });
    ready.catch(() => { ready = null; });
  }
  const q = await ready;
  return q(text, params);
}

export async function one(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}
