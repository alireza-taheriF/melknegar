// Local dev server: serves public/ and routes /api/* to the same handler as Vercel.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.LOCAL_DATA_DIR ||= path.join(root, '.data');
process.env.MASTER_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.APP_URL ||= 'http://localhost:' + (process.env.PORT || 3000);
const { default: handler } = await import('../api/index.js');

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handler(req, res);
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(root, 'public', path.normalize(p));
  if (!file.startsWith(path.join(root, 'public'))) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (!path.extname(p)) return fs.readFile(path.join(root, 'public', p + '.html'), (e2, d2) => { if (e2) { res.statusCode = 404; return res.end('not found'); } res.setHeader('Content-Type', types['.html']); res.end(d2); });
      res.statusCode = 404; return res.end('not found');
    }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(process.env.PORT || 3000, () => console.log('dev on', process.env.APP_URL));
