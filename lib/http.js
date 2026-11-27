// HTTP helpers for Node (req, res) handlers.
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (msg = 'درخواست نامعتبر است') => new HttpError(400, msg, 'bad_request');
export const unauthorized = (msg = 'ابتدا وارد شوید') => new HttpError(401, msg, 'unauthorized');
export const forbidden = (msg = 'دسترسی ندارید') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'پیدا نشد') => new HttpError(404, msg, 'not_found');
export const tooMany = (msg = 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره امتحان کنید') => new HttpError(429, msg, 'rate_limited');

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function redirect(res, location, headers = {}) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end();
}

// Read the request body with a hard size cap. Vercel may have parsed it
// already (req.body); otherwise stream it ourselves.
export async function readJson(req, limit = 512 * 1024) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    if (JSON.stringify(req.body).length > limit) throw new HttpError(413, 'حجم داده زیاد است');
    return req.body;
  }
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else {
    raw = await new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, 'حجم داده زیاد است'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  if (raw.length > limit) throw new HttpError(413, 'حجم داده زیاد است');
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw bad('JSON نامعتبر است');
  }
}

export function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookie(name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict', 'Secure'];
  if (httpOnly) parts.push('HttpOnly');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
}

// In-memory sliding-window limiter (per function instance). Cheap first line
// of defence; persistent lockouts live on the account record.
const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const t = Date.now();
  let arr = buckets.get(key);
  if (!arr) buckets.set(key, (arr = []));
  while (arr.length && t - arr[0] > windowMs) arr.shift();
  if (arr.length >= limit) throw tooMany();
  arr.push(t);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (!v.length || t - v[v.length - 1] > windowMs) buckets.delete(k);
  }
}
