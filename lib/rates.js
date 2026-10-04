// TRM (pesos por dólar) para convertir retiros a USDT.
// Fuente principal: TRM oficial (Superintendencia Financiera, datos.gov.co). Respaldo: open.er-api.com.
// USDT se toma 1:1 con el dólar. En pruebas se puede fijar con TRM_OVERRIDE.

let cache = null; // { trm, source, at, until }
const TTL = 10 * 60_000;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function fromTrm() {
  const today = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10); // fecha de Colombia
  const url = 'https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde%20DESC&$where=' +
    encodeURIComponent(`vigenciadesde <= '${today}T23:59:59'`);
  const rows = await getJson(url);
  const v = Number(rows?.[0]?.valor);
  if (!(v > 500 && v < 20000)) throw new Error('TRM no válida');
  return { trm: v, source: 'TRM oficial' };
}

async function fromMarket() {
  const d = await getJson('https://open.er-api.com/v6/latest/USD');
  const v = Number(d?.rates?.COP);
  if (!(v > 500 && v < 20000)) throw new Error('tasa no válida');
  return { trm: v, source: 'Tasa del mercado' };
}

/** Devuelve { trm, source, at } o lanza error si no se pudo consultar ninguna fuente. */
export async function usdCop() {
  const fixed = Number(process.env.TRM_OVERRIDE);
  if (fixed > 0) return { trm: fixed, source: 'fija', at: new Date().toISOString() };
  if (cache && cache.until > Date.now()) return cache.value;
  let r;
  try { r = await fromTrm(); } catch { r = await fromMarket(); }
  const value = { ...r, at: new Date().toISOString() };
  cache = { value, until: Date.now() + TTL };
  return value;
}

/** Pesos → USDT, descontando el porcentaje (por defecto 3 %), redondeado hacia abajo a centavos. */
export function toUsdt(pesos, trm, discountPct) {
  return Math.floor((pesos / trm) * (1 - discountPct / 100) * 100) / 100;
}
