import crypto from 'node:crypto';

// ---------- valores por defecto ----------
export const WD_METHODS = ['banco', 'breb', 'usdt', 'nequi', 'daviplata', 'otro'];
export const DEFAULT_BANKS = ['Bancolombia', 'Davivienda', 'Banco de Bogotá', 'Banco de Occidente', 'BBVA', 'Banco Popular', 'Banco Agrario'];

export const DEFAULT_TEXTS = {
  eyebrow: 'TikTok Live · Sorteo de regalos',
  title: 'Minas del Live',
  controlHeading: 'Panel de control',
  controlIntro: 'Configura por separado la página Jugar (tu live) y la Vista del jugador: premios, colores, reglas y textos.',
  prizesHeading: 'Premios del tablero',
  prizesSub: 'Reparte las casillas entre tus niveles de premio',
  stageHeading: 'Tablero en vivo',
  playerHeading: 'Tu tablero',
};

export function defaultTiers() {
  return [
    { key: 'mega', emoji: '🏆', label: 'Premio Mayor', count: 1, points: 1000000, wipeout: false, color: null },
    { key: 'grande', emoji: '🥇', label: 'Premio Grande', count: 3, points: 5000, wipeout: false, color: null },
    { key: 'mediano', emoji: '🥈', label: 'Premio Mediano', count: 15, points: 1000, wipeout: false, color: null },
    { key: 'pequeno', emoji: '🥉', label: 'Premio Chico', count: 29, points: 500, wipeout: false, color: null },
    { key: 'mina', emoji: '💣', label: 'Bomba', count: 52, points: -200, wipeout: false, color: null },
    { key: 'roja', emoji: '🔴', label: 'Bomba roja', count: 0, points: 0, wipeout: true, color: null },
  ];
}

export function defaultSettings() {
  return { wipeEndsGame: true, showTotal: true, showCellPoints: true, popAnimation: true, columns: 0, unit: 'pts', accent: '#FFC93C', bg: '#0B0509' };
}

// ---------- normalización (nunca se confía en lo que manda el navegador) ----------
const str = (v, d = '', max = 200) => (typeof v === 'string' ? v.slice(0, max) : d);
const int = (v, d, min, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);

export function normConfig(src) {
  src = src && typeof src === 'object' ? src : {};
  const rawTiers = Array.isArray(src.tiers) && src.tiers.length ? src.tiers.slice(0, 30) : defaultTiers();
  const seen = new Set();
  const tiers = rawTiers.map((t, i) => {
    t = t && typeof t === 'object' ? t : {};
    let key = str(t.key, '', 40).replace(/[^A-Za-z0-9_-]/g, '') || 't' + i;
    while (seen.has(key)) key += 'x';
    seen.add(key);
    return {
      key,
      emoji: str(t.emoji, '🎁', 8),
      label: str(t.label, 'Premio', 40),
      count: int(t.count, 0, 0, 1000),
      points: int(t.points, 0, -1_000_000_000, 1_000_000_000),
      wipeout: !!t.wipeout,
      color: typeof t.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : null,
    };
  });
  const s = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const d = defaultSettings();
  return {
    tiers,
    totalCells: int(src.totalCells, 100, 1, 1000),
    settings: {
      wipeEndsGame: s.wipeEndsGame === undefined ? d.wipeEndsGame : !!s.wipeEndsGame,
      showTotal: s.showTotal === undefined ? d.showTotal : !!s.showTotal,
      showCellPoints: s.showCellPoints === undefined ? d.showCellPoints : !!s.showCellPoints,
      popAnimation: s.popAnimation === undefined ? d.popAnimation : !!s.popAnimation,
      columns: int(s.columns, 0, 0, 40),
      unit: str(s.unit, d.unit, 12).trim() || d.unit,
      accent: hex(s.accent, d.accent),
      bg: hex(s.bg, d.bg),
    },
  };
}

export function normTexts(src) {
  src = src && typeof src === 'object' ? src : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_TEXTS)) out[k] = str(src[k], DEFAULT_TEXTS[k], k === 'controlIntro' ? 300 : 120);
  return out;
}

export function normMoney(src) {
  src = src && typeof src === 'object' ? src : {};
  const ms = src.methods && typeof src.methods === 'object' ? src.methods : { banco: true, breb: true, usdt: true };
  const methods = {};
  for (const k of WD_METHODS) methods[k] = !!ms[k];
  if (!WD_METHODS.some((k) => methods[k])) methods.banco = true;
  const banks = Array.isArray(src.banks)
    ? src.banks.map((b) => str(b, '', 40).trim()).filter(Boolean).slice(0, 40)
    : DEFAULT_BANKS.slice();
  return {
    pointValue: int(src.pointValue, 1, 1, 1_000_000),
    minWithdraw: int(src.minWithdraw, 0, 0, 1_000_000_000),
    payoutHours: int(src.payoutHours, 12, 0, 720),
    usdtDiscount: Number.isFinite(Number(src.usdtDiscount)) && src.usdtDiscount !== '' && src.usdtDiscount !== null ? Math.min(50, Math.max(0, Math.round(Number(src.usdtDiscount) * 100) / 100)) : 3,
    methods,
    banks,
    askDoc: src.askDoc === undefined ? true : !!src.askDoc,
    title: str(src.title, '', 40).trim() || '🏦 Retirar a cuenta bancaria o cripto',
    note: str(src.note, '', 200),
  };
}

export function normSupport(src) {
  src = src && typeof src === 'object' ? src : {};
  return { hours: str(src.hours, '', 80), message: str(src.message, '', 200), email: str(src.email, '', 80).trim() };
}

// ---------- lógica del juego (todo se decide en el servidor) ----------
/** Reparto respetando las cantidades; lo que falte se rellena al azar con premios que tengan cantidad. */
export function buildMap(cfg) {
  const pool = [];
  for (const t of cfg.tiers) for (let i = 0; i < t.count; i++) pool.push(t.key);
  if (pool.length > cfg.totalCells) pool.length = cfg.totalCells;
  const withCount = cfg.tiers.filter((t) => t.count > 0);
  const fill = withCount.length ? withCount : cfg.tiers;
  while (pool.length < cfg.totalCells) pool.push(fill[crypto.randomInt(0, fill.length)].key);
  for (let k = pool.length - 1; k > 0; k--) {
    const j = crypto.randomInt(0, k + 1);
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  return pool;
}

export function tierOf(cfg, key) {
  return cfg.tiers.find((t) => t.key === key) || null;
}

/** Puntos acumulados hasta (sin incluir) una bomba roja; con la regla apagada la bomba solo borra lo anterior. */
export function sumPoints(cfg, keys) {
  let total = 0;
  for (const key of keys) {
    const t = tierOf(cfg, key);
    if (t && t.wipeout) {
      if (cfg.settings.wipeEndsGame) break;
      total = 0;
      continue;
    }
    total += t ? t.points : 0;
  }
  return total;
}

export function wipeHit(cfg, keys) {
  return cfg.settings.wipeEndsGame && keys.some((k) => { const t = tierOf(cfg, k); return !!(t && t.wipeout); });
}

export function newGameCode() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alpha[crypto.randomInt(0, alpha.length)];
  return `JG-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Lo que ve el navegador de una partida: nunca el reparto completo, solo las casillas ya destapadas. */
export function publicGame(row) {
  const cfg = JSON.parse(row.cfg);
  const map = JSON.parse(row.map);
  const opened = JSON.parse(row.opened);
  const keys = opened.map((i) => map[i]);
  const tiers = cfg.tiers.map((t) => ({ ...t, count: undefined })); // nadie ve cuántos premios hay de cada tipo
  const status = row.status;
  const sum = status === 'cashed' ? row.points : sumPoints(cfg, keys);
  return {
    id: row.id,
    code: row.code,
    page: row.page,
    status,
    totalCells: map.length,
    tiers,
    settings: cfg.settings,
    opened: opened.map((idx) => ({ idx, key: map[idx] })),
    points: sum,
    pesos: row.pesos,
    lost: row.lost,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

/** Avance por premio de un juego (solo para la pantalla del administrador). */
export function progressOf(row) {
  const cfg = JSON.parse(row.cfg), map = JSON.parse(row.map), opened = JSON.parse(row.opened);
  return {
    code: row.code, page: row.page, status: row.status, totalCells: map.length, openedCount: opened.length,
    tiers: cfg.tiers.map((t) => ({
      key: t.key, emoji: t.emoji, label: t.label, color: t.color, wipeout: t.wipeout, points: t.points,
      total: map.filter((k) => k === t.key).length,
      opened: opened.filter((i) => map[i] === t.key).length,
    })),
  };
}
