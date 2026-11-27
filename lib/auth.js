// Sessions, login, password policy, one-time links.
import { config } from './config.js';
import { sign, verify, hashPassword, verifyPassword, burnPasswordTime, randomToken, sha256 } from './crypto.js';
import { parseCookies, cookie, unauthorized, forbidden, bad, rateLimit, clientIp, HttpError } from './http.js';
import { loadUsers, mutateUsers, loginKeys } from './data.js';
import { normPhone, oneLine } from './util.js';
import { NO_WRITE } from './store.js';

const COOKIE = '__Host-mn_s';
const memFailures = new Map(); // loginKey -> count (per instance)

export function sessionCookie(user) {
  const maxAge = config.sessionDays * 86400;
  const token = sign({ u: user.id, sv: user.sv || 1, exp: Date.now() + maxAge * 1000 }, 'session');
  return cookie(COOKIE, token, { maxAge });
}

export function clearCookie() {
  return cookie(COOKIE, '', { maxAge: 0 });
}

export async function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const payload = verify(token, 'session');
  if (!payload) return null;
  const users = await loadUsers();
  const u = users.users[payload.u];
  if (!u || !u.active || (u.sv || 1) !== payload.sv) return null;
  return u;
}

export async function requireUser(req, { allowMustChange = false } = {}) {
  const u = await currentUser(req);
  if (!u) throw unauthorized();
  if (u.mustChange && !allowMustChange) throw new HttpError(403, 'ابتدا رمز عبور را تغییر دهید', 'must_change');
  return u;
}

export function requireStaff(u, level = 'admin') {
  const ok = level === 'superadmin' ? u.staff === 'superadmin' : u.staff === 'superadmin' || u.staff === 'admin';
  if (!ok) throw forbidden();
}

export function requireTenant(u) {
  if (!u.tenantId) throw forbidden('حساب شما به دفتر املاکی متصل نیست');
  return u.tenantId;
}

export function loginKeyFor(identifier) {
  const phone = normPhone(identifier);
  if (phone) return 'p:' + phone;
  const name = oneLine(identifier, 64).toLowerCase();
  return name ? 'u:' + name : '';
}

export async function login(req, identifier, password) {
  const ip = clientIp(req);
  rateLimit('login-ip:' + ip, 20, 10 * 60_000);
  const key = loginKeyFor(identifier);
  if (!key || !password || String(password).length > 200) throw bad('نام کاربری یا رمز عبور اشتباه است');
  rateLimit('login-key:' + key, 8, 10 * 60_000);

  const users = await loadUsers({ maxAge: 2000 });
  const uid = users.byLogin[key];
  const u = uid ? users.users[uid] : null;
  if (!u || !u.active) {
    await burnPasswordTime(password);
    throw bad('نام کاربری یا رمز عبور اشتباه است');
  }
  if (u.lockUntil && u.lockUntil > Date.now()) {
    throw new HttpError(423, 'به دلیل تلاش‌های ناموفق، حساب موقتاً قفل است. ۱۵ دقیقه بعد امتحان کنید.', 'locked');
  }
  const ok = await verifyPassword(password, u.pass);
  if (!ok) {
    const n = (memFailures.get(key) || 0) + 1;
    memFailures.set(key, n);
    if (n >= 10) {
      memFailures.delete(key);
      await mutateUsers((d) => {
        if (d.users[u.id]) d.users[u.id].lockUntil = Date.now() + 15 * 60_000;
      });
    }
    throw bad('نام کاربری یا رمز عبور اشتباه است');
  }
  memFailures.delete(key);
  await mutateUsers((d) => {
    const x = d.users[u.id];
    if (!x) return NO_WRITE;
    x.lastLoginAt = Date.now();
    delete x.lockUntil;
  });
  return u;
}

const COMMON = ['12345678', '123456789', '1234567890', 'password', 'qwertyui', '11111111', '00000000', '87654321', 'melknegar'];
export function checkPasswordPolicy(pw) {
  const s = String(pw || '');
  if (s.length < 8) throw bad('رمز عبور باید حداقل ۸ کاراکتر باشد');
  if (s.length > 128) throw bad('رمز عبور خیلی طولانی است');
  if (COMMON.includes(s.toLowerCase()) || /^(.)\1+$/.test(s)) throw bad('این رمز عبور خیلی ساده است');
}

export async function changePassword(user, current, next) {
  checkPasswordPolicy(next);
  if (!user.mustChange || current) {
    if (!(await verifyPassword(current, user.pass))) throw bad('رمز عبور فعلی اشتباه است');
  }
  const hash = await hashPassword(next);
  let updated;
  await mutateUsers((d) => {
    const x = d.users[user.id];
    if (!x) throw unauthorized();
    x.pass = hash;
    x.mustChange = false;
    x.sv = (x.sv || 1) + 1; // sign out every other session
    updated = x;
  });
  return updated;
}

// One-time magic login links (sent by the bot). Valid 10 minutes, single use.
export async function createMagicLink(userId) {
  const token = randomToken(24);
  await mutateUsers((d) => {
    const x = d.users[userId];
    if (!x) throw unauthorized();
    x.magic = { hash: sha256(token), exp: Date.now() + 10 * 60_000 };
  });
  return `${config.appUrl}/api/auth/magic?uid=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}

export async function consumeMagicLink(userId, token) {
  let user = null;
  await mutateUsers((d) => {
    const x = d.users[String(userId || '')];
    if (!x || !x.active || !x.magic || x.magic.exp < Date.now() || x.magic.hash !== sha256(String(token || ''))) return NO_WRITE;
    delete x.magic;
    user = x;
  });
  return user;
}

export function registerLogins(d, user) {
  for (const k of loginKeys(user)) {
    if (d.byLogin[k] && d.byLogin[k] !== user.id) throw bad(k.startsWith('p:') ? 'این شماره موبایل قبلاً ثبت شده است' : 'این نام کاربری قبلاً ثبت شده است');
  }
  for (const k of loginKeys(user)) d.byLogin[k] = user.id;
}
