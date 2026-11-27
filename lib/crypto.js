// Encryption at rest, password hashing and signed tokens.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);

// Root key: MASTER_KEY if set, otherwise derived from the private Blob store
// token, which only this Vercel project holds. Do not rotate that token
// without first pinning MASTER_KEY to the derived value.
let rootKey = null;
function masterKey() {
  if (rootKey) return rootKey;
  if (config.masterKey) {
    const raw = Buffer.from(config.masterKey, 'base64');
    if (raw.length !== 32) throw new Error('MASTER_KEY must be 32 bytes base64');
    rootKey = raw;
  } else if (config.blobToken) {
    rootKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(config.blobToken), Buffer.from('melknegar-root-v1'), Buffer.from('root'), 32));
  } else throw new Error('MASTER_KEY is not set');
  return rootKey;
}

// Derive purpose-specific subkeys so one secret never serves two roles.
const subkeyCache = new Map();
export function subkey(purpose) {
  if (!subkeyCache.has(purpose)) {
    subkeyCache.set(purpose, Buffer.from(crypto.hkdfSync('sha256', masterKey(), Buffer.alloc(0), Buffer.from('melknegar:' + purpose), 32)));
  }
  return subkeyCache.get(purpose);
}

// AES-256-GCM, with the storage key as additional authenticated data so a
// ciphertext cannot be moved to a different document.
export function encryptJson(obj, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', subkey('storage'), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') });
}

export function decryptJson(text, aad) {
  const box = JSON.parse(text);
  if (box.v !== 1) throw new Error('unknown envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', subkey('storage'), Buffer.from(box.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

// Storage object names are HMACs so the bucket layout reveals nothing.
export function opaqueName(logical) {
  return crypto.createHmac('sha256', subkey('names')).update(logical).digest('hex').slice(0, 40);
}

// ---- Passwords (scrypt) -------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(String(password).normalize('NFKC'), salt, 32, SCRYPT);
  return `s1$${SCRYPT.N}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [ver, n, saltB64, hashB64] = String(stored || '').split('$');
    if (ver !== 's1') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const dk = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
    return crypto.timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

// A fixed dummy hash, used so unknown usernames cost the same time as real ones.
let dummyHash = null;
export async function burnPasswordTime(password) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}

// ---- Signed tokens --------------------------------------------------------
export function sign(payload, purpose = 'session') {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', subkey('sig:' + purpose)).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify(token, purpose = 'session') {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', subkey('sig:' + purpose)).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('base64url');
}
