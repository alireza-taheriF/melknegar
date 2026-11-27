// Document store: every document is one encrypted JSON object.
// Backends: Upstash Redis (if configured), Vercel Blob (private), local files (dev/tests).
// Writes use compare-and-swap on an etag/version, so concurrent writers never
// silently overwrite each other: on conflict we reload and re-apply the change.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { encryptJson, decryptJson, opaqueName } from './crypto.js';
import { deepClone } from './util.js';

export class ConflictError extends Error {}

const stats = { reads: 0, writes: 0, conflicts: 0, since: Date.now(), backend: '' };
export function storeStats() {
  return { ...stats };
}

// ---------------------------------------------------------------- backends
function localBackend(dir) {
  const file = (name) => path.join(dir, name + '.json');
  return {
    name: 'local',
    async read(name) {
      try {
        const text = await fs.readFile(file(name), 'utf8');
        return { text, etag: crypto.createHash('sha1').update(text).digest('hex') };
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async write(name, text, etag) {
      await fs.mkdir(dir, { recursive: true });
      const cur = await this.read(name);
      if ((cur ? cur.etag : null) !== (etag || null)) throw new ConflictError('conflict');
      const tmp = file(name) + '.' + process.pid + '.tmp';
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, file(name));
      return crypto.createHash('sha1').update(text).digest('hex');
    },
  };
}

function blobBackend(token) {
  let sdk = null;
  const load = async () => (sdk ||= await import('@vercel/blob'));
  return {
    name: 'blob',
    async read(name) {
      const { get } = await load();
      const res = await get(name + '.json', { access: 'private', useCache: false, token });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      const text = await new Response(res.stream).text();
      return { text, etag: res.blob?.etag || null };
    },
    async write(name, text, etag) {
      const { put } = await load();
      try {
        const res = await put(name + '.json', text, {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
          ...(etag ? { ifMatch: etag } : {}),
          token,
        });
        return res?.etag || null;
      } catch (e) {
        const msg = `${e?.name || ''} ${e?.message || ''}`;
        if (/precondition|etag|412/i.test(msg)) throw new ConflictError('conflict');
        throw e;
      }
    },
  };
}

function redisBackend(url, token) {
  const call = async (cmd) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error('redis: ' + (json.error || res.status));
    return json.result;
  };
  // Value layout: "<version>|<ciphertext>"; CAS on version in one Lua call.
  const CAS = `local cur = redis.call('GET', KEYS[1])
local v = ''
if cur then v = string.match(cur, '^([^|]*)') end
if v ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2] .. '|' .. ARGV[3])
return 1`;
  return {
    name: 'redis',
    async read(name) {
      const raw = await call(['GET', 'mn:' + name]);
      if (!raw) return null;
      const i = raw.indexOf('|');
      return { etag: raw.slice(0, i), text: raw.slice(i + 1) };
    },
    async write(name, text, etag) {
      const next = crypto.randomBytes(8).toString('hex');
      const ok = await call(['EVAL', CAS, '1', 'mn:' + name, etag || '', next, text]);
      if (Number(ok) !== 1) throw new ConflictError('conflict');
      return next;
    },
  };
}

let backend = null;
let fallbackBlob = null;
function getBackend() {
  if (backend) return backend;
  if (config.redisUrl && config.redisToken) {
    backend = redisBackend(config.redisUrl, config.redisToken);
    if (config.blobToken) fallbackBlob = blobBackend(config.blobToken); // one-time migration source
  } else if (config.blobToken) backend = blobBackend(config.blobToken);
  else if (config.localDataDir) backend = localBackend(config.localDataDir);
  else throw new Error('No storage configured');
  stats.backend = backend.name;
  return backend;
}

// ---------------------------------------------------------------- cache
// Short-lived in-memory cache per function instance. Writes are always
// guarded by CAS, so a stale cache can only cost a retry, never data.
const cache = new Map(); // logical -> { data, etag, at }
const DEFAULT_TTL = 8000;

async function fetchDoc(logical) {
  const name = opaqueName(logical);
  const b = getBackend();
  stats.reads++;
  let got = await b.read(name);
  if (!got && fallbackBlob) {
    const old = await fallbackBlob.read(name);
    if (old) {
      try {
        const etag = await b.write(name, old.text, null);
        got = { text: old.text, etag };
      } catch {
        got = await b.read(name);
      }
    }
  }
  const entry = got
    ? { data: decryptJson(got.text, logical), etag: got.etag, at: Date.now() }
    : { data: null, etag: null, at: Date.now() };
  cache.set(logical, entry);
  return entry;
}

export async function load(logical, { maxAge = DEFAULT_TTL } = {}) {
  const hit = cache.get(logical);
  if (hit && Date.now() - hit.at < maxAge) return deepClone(hit.data);
  const entry = await fetchDoc(logical);
  return deepClone(entry.data);
}

// Apply fn to a draft of the document and save it. fn may return a value,
// which mutate() returns. If fn returns the symbol NO_WRITE nothing is saved.
export const NO_WRITE = Symbol('no-write');

export async function mutate(logical, fn, { init = () => ({}) } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let entry = cache.get(logical);
    if (!entry || attempt > 0 || Date.now() - entry.at > 60_000) entry = await fetchDoc(logical);
    const draft = entry.data ? deepClone(entry.data) : init();
    const out = await fn(draft);
    if (out === NO_WRITE) return undefined;
    const text = encryptJson(draft, logical);
    try {
      stats.writes++;
      const etag = await getBackend().write(opaqueName(logical), text, entry.etag);
      if (etag) cache.set(logical, { data: draft, etag, at: Date.now() });
      else cache.delete(logical);
      return out;
    } catch (e) {
      if (e instanceof ConflictError) {
        stats.conflicts++;
        await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Too many concurrent updates, try again');
}

export function _resetForTests() {
  cache.clear();
  backend = null;
}
