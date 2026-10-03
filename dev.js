// Servidor para probar en tu computador: node dev.js  →  http://localhost:3000
// Usa la misma lógica que Vercel (lib/app.js) y una base de datos local (.data/pglite).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './lib/app.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/')) return handle(req, res);
    let file = path.normalize(path.join(root, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`Minas del Live en http://localhost:${port}`));
}
