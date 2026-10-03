import { handle } from '../lib/app.js';

// Vercel manda todas las rutas /api/... a esta única función (ver "rewrites" en vercel.json).
export default function handler(req, res) {
  return handle(req, res);
}
