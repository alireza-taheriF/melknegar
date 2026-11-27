// Single entry point for every /api/* request (see vercel.json rewrite).
import { assertConfigured } from '../lib/config.js';
import { HttpError, send } from '../lib/http.js';
import { matchRoute } from '../lib/routes.js';
import { ensureSeeded } from '../lib/seed.js';
import { setOidcToken } from '../lib/ai.js';

export const config = { maxDuration: 60 };

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients; cookies are SameSite=Strict anyway
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    assertConfigured();
    setOidcToken(req.headers['x-vercel-oidc-token']);
    const url = new URL(req.url, 'http://local');
    // Vercel rewrites /api/* here; recover the original path either way.
    const rewritten = url.searchParams.get('__path');
    url.searchParams.delete('__path');
    let path = url.pathname.replace(/\/+$/, '') || '/';
    if ((path === '/api/index' || path === '/api') && rewritten !== null) path = '/api/' + rewritten.replace(/^\/+/, '');
    const found = matchRoute(req.method, path);
    if (!found) throw new HttpError(404, 'مسیر پیدا نشد');
    const { route, params } = found;

    // CSRF defence for state-changing requests: same-origin + custom header.
    if (req.method !== 'GET' && !route.opts.noCsrf) {
      if (!sameOrigin(req) || req.headers['x-mn'] !== '1') throw new HttpError(403, 'درخواست نامعتبر');
    }

    await ensureSeeded();
    const result = await route.handler({ req, res, params, url });
    if (route.opts.raw || res.writableEnded) return;
    send(res, 200, result ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code || 'error' });
    console.error('api error', e);
    return send(res, 500, { error: 'خطای داخلی سرور؛ دوباره امتحان کنید', code: 'server_error' });
  }
}
