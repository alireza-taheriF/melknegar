// Shared helpers: ids, Persian text normalization, validation primitives.
import crypto from 'node:crypto';

export const now = () => Date.now();

export function id(prefix = '') {
  // 12 random bytes -> 16 url-safe chars; collision-safe for this scale.
  return prefix + crypto.randomBytes(12).toString('base64url');
}

export function shortCode(len = 6) {
  // Human friendly code without ambiguous chars.
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toEnDigits(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

// Normalize Arabic letter variants to Persian and collapse whitespace.
export function normText(input, max = 2000) {
  if (input === null || input === undefined) return '';
  let s = String(input)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '') // strip bidi controls (spoofing)
    .trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

export function oneLine(input, max = 200) {
  return normText(input, max).replace(/\s+/g, ' ');
}

// Iranian mobile normalization -> 09xxxxxxxxx or '' if invalid.
export function normPhone(input) {
  let s = toEnDigits(input).replace(/[^\d+]/g, '');
  if (s.startsWith('+98')) s = '0' + s.slice(3);
  else if (s.startsWith('0098')) s = '0' + s.slice(4);
  else if (s.startsWith('98') && s.length === 12) s = '0' + s.slice(2);
  else if (s.length === 10 && s.startsWith('9')) s = '0' + s;
  return /^09\d{9}$/.test(s) ? s : '';
}

// Any phone (landline allowed) for property owners; digits only, 5..14.
export function normAnyPhone(input) {
  const mobile = normPhone(input);
  if (mobile) return mobile;
  const s = toEnDigits(input).replace(/[^\d]/g, '');
  return s.length >= 5 && s.length <= 14 ? s : '';
}

export function toInt(input, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (input === null || input === undefined || input === '') return null;
  const n = typeof input === 'number' ? input : Number(toEnDigits(input).replace(/[,\s٬،]/g, ''));
  if (!Number.isFinite(n)) return null;
  const v = Math.round(n);
  if (v < min || v > max) return null;
  return v;
}

export function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function deepClone(v) {
  return v === undefined ? undefined : structuredClone(v);
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}
