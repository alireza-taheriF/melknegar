// All API routes. Each handler gets (ctx) and returns a JSON-able value.
import { config } from './config.js';
import { HttpError, bad, forbidden, notFound, readJson, send, redirect, rateLimit, clientIp } from './http.js';
import { login, requireUser, requireStaff, requireTenant, sessionCookie, clearCookie, changePassword, consumeMagicLink, registerLogins, checkPasswordPolicy } from './auth.js';
import { loadUsers, mutateUsers, loadPlatform, mutatePlatform, loadTenant, mutateTenant, publicUser } from './data.js';
import { listAll, createRecords, updateProperty, deleteProperty, updateClient, deleteClient, summarize } from './agency.js';
import { matchScore, topMatches } from './domain.js';
import { extractFromText, extractFromAudio, extractFromImage, aiEnabled, MASHHAD_HOODS } from './ai.js';
import { CATALOG, ORDER_STATUS, cleanOrderInput, publicOrderView } from './services.js';
import { connectBot, disconnectBot, botInfo, createLinkToken, handleUpdate, notifyNewOrder, notifyAdmins, setNotifyUsernames, notifyStatus } from './bots.js';
import { hashPassword } from './crypto.js';
import { storeStats, NO_WRITE } from './store.js';
import { id, oneLine, normPhone, toEnDigits, pick } from './util.js';
import crypto from 'node:crypto';

const routes = [];
const on = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, opts });
};

export function matchRoute(method, path) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
  }
  return null;
}

function tempPassword() {
  const a = '23456789abcdefghjkmnpqrstuvwxyz';
  const b = crypto.randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += a[b[i] % a.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

const decodeB64 = (data, max) => {
  const s = String(data || '').replace(/^data:[^,]*,/, '');
  if (!s || s.length > Math.ceil((max * 4) / 3) + 8) throw new HttpError(413, 'فایل خیلی بزرگ است');
  return Buffer.from(s, 'base64');
};

// ------------------------------------------------------------------ auth
on('POST', '/api/auth/login', async ({ req, res }) => {
  const body = await readJson(req, 4096);
  const u = await login(req, body.identifier, body.password);
  const users = await loadUsers();
  const plat = await loadPlatform();
  res.setHeader('Set-Cookie', sessionCookie(users.users[u.id] || u));
  return { user: publicUser(u, plat.tenants[u.tenantId]) };
});

// Public self-signup: a new agency + its owner account, signed in immediately.
on('POST', '/api/auth/signup', async ({ req, res }) => {
  const ip = clientIp(req);
  rateLimit('signup-ip:' + ip, 3, 60 * 60_000);
  rateLimit('signup-global', 60, 24 * 60 * 60_000);
  const body = await readJson(req, 4096);
  if (body.website) throw bad('ثبت‌نام انجام نشد'); // honeypot
  const startedAt = Number(body.startedAt || 0);
  if (!startedAt || Date.now() - startedAt < 4000) throw bad('لطفاً فرم را کامل پر کنید');
  const agency = oneLine(body.agency, 80);
  const name = oneLine(body.name, 80);
  const phone = normPhone(body.phone);
  const city = oneLine(body.city || 'مشهد', 40);
  if (agency.length < 2) throw bad('نام املاکی را وارد کنید');
  if (name.length < 2) throw bad('نام و نام خانوادگی را وارد کنید');
  if (!phone) throw bad('شماره موبایل معتبر وارد کنید (مثل ۰۹۱۵۱۲۳۴۵۶۷)');
  checkPasswordPolicy(body.password);
  const hash = await hashPassword(String(body.password));
  const tenantId = id('t_');
  const user = { id: id('u_'), name, phone, username: '', role: 'owner', staff: null, tenantId, pass: hash, mustChange: false, sv: 1, active: true, createdAt: Date.now(), selfSignup: true };
  await mutateUsers((d) => {
    registerLogins(d, user); // throws if the phone is already registered
    d.users[user.id] = user;
  });
  const tenant = { id: tenantId, name: agency, city, phone, active: true, createdAt: Date.now(), selfSignup: true };
  await mutatePlatform((p) => {
    p.tenants[tenantId] = tenant;
  });
  res.setHeader('Set-Cookie', sessionCookie(user));
  await notifyAdmins(`🏢 املاکی جدید ثبت‌نام کرد\n\nنام املاکی: ${agency}\nمدیر: ${name}\nموبایل: ${phone}\nشهر: ${city}`);
  return { user: publicUser(user, tenant) };
}, { public: true });

on('POST', '/api/auth/logout', async ({ res }) => {
  res.setHeader('Set-Cookie', clearCookie());
  return { ok: true };
});

on('POST', '/api/auth/logout-all', async ({ req, res }) => {
  const u = await requireUser(req, { allowMustChange: true });
  await mutateUsers((d) => {
    d.users[u.id].sv = (d.users[u.id].sv || 1) + 1;
  });
  res.setHeader('Set-Cookie', clearCookie());
  return { ok: true };
});

on('GET', '/api/auth/me', async ({ req }) => {
  const u = await requireUser(req, { allowMustChange: true });
  const plat = await loadPlatform();
  return { user: publicUser(u, plat.tenants[u.tenantId]), ai: aiEnabled(), bots: await botInfo() };
});

on('POST', '/api/auth/password', async ({ req, res }) => {
  const u = await requireUser(req, { allowMustChange: true });
  rateLimit('pw:' + u.id, 6, 10 * 60_000);
  const body = await readJson(req, 4096);
  const updated = await changePassword(u, body.current, body.next);
  res.setHeader('Set-Cookie', sessionCookie(updated));
  return { ok: true };
});

on('GET', '/api/auth/magic', async ({ req, res, url }) => {
  rateLimit('magic:' + clientIp(req), 20, 10 * 60_000);
  const u = await consumeMagicLink(url.searchParams.get('uid'), url.searchParams.get('t'));
  if (!u) return redirect(res, '/#/login?expired=1');
  // Optional deep link from the bot, e.g. /files/p_abc. Only simple in-app paths.
  const next = url.searchParams.get('next') || '/';
  const safe = /^\/[A-Za-z0-9_/-]{0,80}$/.test(next) && !next.startsWith('//') ? next : '/';
  return redirect(res, '/#' + safe, { 'Set-Cookie': sessionCookie(u) });
}, { raw: true });

// ------------------------------------------------------------------ ledger
on('GET', '/api/ledger', async ({ req }) => {
  const u = await requireUser(req);
  requireTenant(u);
  const { t, props, clients } = await listAll(u);
  const users = await loadUsers();
  const team = Object.values(users.users)
    .filter((x) => x.tenantId === u.tenantId)
    .map((x) => ({ id: x.id, name: x.name, role: x.role, active: x.active }));
  const names = Object.fromEntries(team.map((x) => [x.id, x.name]));
  const activity = t.activity.slice(0, 30).map((a) => ({ ...a, byName: names[a.by] || '' }));
  return { properties: props, clients, summary: summarize(props, clients), settings: t.settings, team, activity, hoods: MASHHAD_HOODS };
});

on('POST', '/api/properties', async ({ req }) => {
  const u = await requireUser(req);
  requireTenant(u);
  const body = await readJson(req);
  const out = await createRecords(u, [{ kind: 'property', data: body }], 'app');
  return { property: out.properties[0] };
});

on('PATCH', '/api/properties/:id', async ({ req, params }) => {
  const u = await requireUser(req);
  requireTenant(u);
  return { property: await updateProperty(u, params.id, await readJson(req)) };
});

on('DELETE', '/api/properties/:id', async ({ req, params }) => {
  const u = await requireUser(req);
  requireTenant(u);
  await deleteProperty(u, params.id);
  return { ok: true };
});

on('POST', '/api/clients', async ({ req }) => {
  const u = await requireUser(req);
  requireTenant(u);
  const out = await createRecords(u, [{ kind: 'client', data: await readJson(req) }], 'app');
  return { client: out.clients[0] };
});

on('PATCH', '/api/clients/:id', async ({ req, params }) => {
  const u = await requireUser(req);
  requireTenant(u);
  return { client: await updateClient(u, params.id, await readJson(req)) };
});

on('DELETE', '/api/clients/:id', async ({ req, params }) => {
  const u = await requireUser(req);
  requireTenant(u);
  await deleteClient(u, params.id);
  return { ok: true };
});

on('GET', '/api/matches/property/:id', async ({ req, params }) => {
  const u = await requireUser(req);
  requireTenant(u);
  const { props, clients } = await listAll(u);
  const p = props.find((x) => x.id === params.id);
  if (!p) throw notFound();
  return { matches: topMatches(clients, p, (c, pp) => matchScore(pp, c)).map((m) => ({ id: m.item.id, score: m.score })) };
});

// ------------------------------------------------------------------ quick capture
on('POST', '/api/capture/text', async ({ req }) => {
  const u = await requireUser(req);
  requireTenant(u);
  rateLimit('cap:' + u.id, 30, 60_000);
  const body = await readJson(req, 16 * 1024);
  return await extractFromText(body.text);
});

on('POST', '/api/capture/voice', async ({ req }) => {
  const u = await requireUser(req);
  requireTenant(u);
  rateLimit('capm:' + u.id, 12, 60_000);
  if (!aiEnabled()) throw bad('پردازش صدا فعال نیست');
  const body = await readJson(req, 4 * 1024 * 1024);
  const mime = pick(String(body.mime || '').split(';')[0], ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'], 'audio/webm');
  return await extractFromAudio(decodeB64(body.data, 3 * 1024 * 1024), mime);
});

on('POST', '/api/capture/image', async ({ req }) => {
  const u = await requireUser(req);
  requireTenant(u);
  rateLimit('capm:' + u.id, 12, 60_000);
  if (!aiEnabled()) throw bad('خواندن عکس فعال نیست');
  const body = await readJson(req, 4 * 1024 * 1024);
  const mime = pick(body.mime, ['image/jpeg', 'image/png', 'image/webp'], 'image/jpeg');
  return await extractFromImage(decodeB64(body.data, 3 * 1024 * 1024), mime);
});

on('POST', '/api/capture/save', async ({ req }) => {
  const u = await requireUser(req);
  requireTenant(u);
  const body = await readJson(req, 512 * 1024);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 60).map((it) => ({ kind: it.kind === 'client' ? 'client' : 'property', data: it.data || {} }));
  if (!items.length) throw bad('موردی برای ثبت انتخاب نشده');
  return await createRecords(u, items, 'app');
});

// ------------------------------------------------------------------ team (agency owner)
function requireOwner(u) {
  requireTenant(u);
  if (u.role !== 'owner' && !u.staff) throw forbidden('فقط مدیر دفتر');
}

on('POST', '/api/team', async ({ req }) => {
  const u = await requireUser(req);
  requireOwner(u);
  const body = await readJson(req, 4096);
  return await createUser({ name: body.name, phone: body.phone, username: body.username, role: pick(body.role, ['agent', 'owner'], 'agent'), tenantId: u.tenantId });
});

on('PATCH', '/api/team/:id', async ({ req, params }) => {
  const u = await requireUser(req);
  requireOwner(u);
  const body = await readJson(req, 4096);
  await mutateUsers((d) => {
    const x = d.users[params.id];
    if (!x || x.tenantId !== u.tenantId) throw notFound();
    if (x.id === u.id) throw bad('نمی‌توانید حساب خودتان را غیرفعال کنید');
    if (x.staff && !u.staff) throw forbidden();
    if ('active' in body) {
      x.active = Boolean(body.active);
      x.sv = (x.sv || 1) + 1;
    }
  });
  return { ok: true };
});

on('POST', '/api/team/:id/reset', async ({ req, params }) => {
  const u = await requireUser(req);
  requireOwner(u);
  return await resetPassword(u, params.id, (x) => x.tenantId === u.tenantId && !x.staff);
});

on('PATCH', '/api/agency/settings', async ({ req }) => {
  const u = await requireUser(req);
  requireOwner(u);
  const body = await readJson(req, 4096);
  let settings;
  await mutateTenant(u.tenantId, (t) => {
    if ('agentsSeeAll' in body) t.settings.agentsSeeAll = Boolean(body.agentsSeeAll);
    settings = t.settings;
  });
  return { settings };
});

async function createUser({ name, phone, username, role, tenantId, staff = null }) {
  const cleanName = oneLine(name, 80);
  if (!cleanName) throw bad('نام را وارد کنید');
  const p = phone ? normPhone(phone) : '';
  if (phone && !p) throw bad('شماره موبایل معتبر نیست');
  const uname = username ? oneLine(username, 32).toLowerCase() : '';
  if (uname && !/^[a-z][a-z0-9_.]{2,31}$/.test(uname)) throw bad('نام کاربری باید انگلیسی و حداقل ۳ حرف باشد');
  if (!p && !uname) throw bad('موبایل یا نام کاربری لازم است');
  const pw = tempPassword();
  const hash = await hashPassword(pw);
  const user = { id: id('u_'), name: cleanName, phone: p, username: uname, role, staff, tenantId, pass: hash, mustChange: true, sv: 1, active: true, createdAt: Date.now() };
  await mutateUsers((d) => {
    registerLogins(d, user);
    d.users[user.id] = user;
  });
  return { user: publicUser(user), tempPassword: pw, login: uname || p };
}

async function resetPassword(actor, targetId, allowed) {
  const pw = tempPassword();
  const hash = await hashPassword(pw);
  let target;
  await mutateUsers((d) => {
    const x = d.users[targetId];
    if (!x || !allowed(x)) throw notFound();
    x.pass = hash;
    x.mustChange = true;
    x.sv = (x.sv || 1) + 1;
    delete x.lockUntil;
    target = x;
  });
  return { tempPassword: pw, login: target.username || target.phone };
}

// ------------------------------------------------------------------ bots (user side)
on('POST', '/api/bot-link', async ({ req }) => {
  const u = await requireUser(req);
  rateLimit('link:' + u.id, 10, 10 * 60_000);
  return await createLinkToken(u.id);
});

on('POST', '/api/bot-unlink', async ({ req }) => {
  const u = await requireUser(req);
  const body = await readJson(req, 1024);
  const platform = pick(body.platform, ['telegram', 'bale'], null);
  if (!platform) throw bad();
  await mutateUsers((d) => {
    const x = d.users[u.id];
    delete x[platform === 'telegram' ? 'tg' : 'bale'];
    for (const [k, v] of Object.entries(d.byChat)) if (v === u.id && k.startsWith(platform + ':')) delete d.byChat[k];
  });
  return { ok: true };
});

on('POST', '/api/bot/:platform/:secret', async ({ req, res, params }) => {
  if (!['telegram', 'bale'].includes(params.platform)) throw notFound();
  const update = await readJson(req, 64 * 1024);
  const r = await handleUpdate(params.platform, params.secret, req.headers['x-telegram-bot-api-secret-token'], update);
  return send(res, r.status, { ok: r.status === 200 });
}, { raw: true, noCsrf: true });

// ------------------------------------------------------------------ services
on('GET', '/api/services/catalog', async () => ({ catalog: CATALOG }), { public: true });

async function createOrder(input, { tenantId = null, userId = null, source }) {
  let order;
  await mutatePlatform((p) => {
    const seq = (p.orderSeq = (p.orderSeq || 1000) + 1);
    order = {
      id: id('o_'),
      code: `MN-${seq}`,
      ...input,
      tenantId,
      createdBy: userId,
      source,
      status: 'new',
      price: null,
      history: [{ at: Date.now(), status: 'new', note: 'ثبت درخواست' }],
      createdAt: Date.now(),
    };
    p.orders[order.id] = order;
    const ids = Object.keys(p.orders);
    if (ids.length > 5000) delete p.orders[ids[0]];
  });
  await notifyNewOrder(order);
  return order;
}

on('POST', '/api/services/orders', async ({ req }) => {
  const u = await requireUser(req);
  requireTenant(u);
  rateLimit('ord:' + u.id, 10, 10 * 60_000);
  const body = await readJson(req, 8192);
  let input;
  try {
    input = cleanOrderInput(body);
  } catch (e) {
    throw bad(e.message);
  }
  if (input.propertyId) {
    const t = await loadTenant(u.tenantId);
    const p = t.properties[input.propertyId];
    if (!p || p.deleted) throw bad('فایل انتخاب‌شده پیدا نشد');
    input.location.neighborhood ||= p.neighborhood || '';
    input.location.address ||= p.address || '';
    input.details.area ||= p.area || null;
  }
  const plat = await loadPlatform();
  input.contact.name ||= u.name;
  input.contact.phone ||= u.phone;
  input.agency = plat.tenants[u.tenantId]?.name || '';
  return { order: await createOrder(input, { tenantId: u.tenantId, userId: u.id, source: 'app' }) };
});

on('GET', '/api/services/orders', async ({ req }) => {
  const u = await requireUser(req);
  requireTenant(u);
  const p = await loadPlatform();
  const orders = Object.values(p.orders).filter((o) => o.tenantId === u.tenantId).sort((a, b) => b.createdAt - a.createdAt);
  return { orders };
});

// Public (no login): buyers request an inspection, anyone can request content.
on('POST', '/api/public/orders', async ({ req }) => {
  const ip = clientIp(req);
  rateLimit('pub-ip:' + ip, 3, 60 * 60_000);
  rateLimit('pub-global', 40, 24 * 60 * 60_000);
  const body = await readJson(req, 8192);
  if (body.website) return { order: { code: 'MN-0000', status: 'new' } }; // honeypot: pretend success
  const startedAt = Number(body.startedAt || 0);
  if (!startedAt || Date.now() - startedAt < 3000) throw bad('لطفاً فرم را کامل پر کنید');
  let input;
  try {
    input = cleanOrderInput({ ...body, propertyId: null }, { publicForm: true });
  } catch (e) {
    throw bad(e.message);
  }
  const order = await createOrder(input, { source: 'public' });
  return { order: publicOrderView(order) };
}, { public: true });

on('GET', '/api/public/track', async ({ req, url }) => {
  rateLimit('track:' + clientIp(req), 20, 10 * 60_000);
  const code = oneLine(toEnDigits(url.searchParams.get('code') || ''), 20).toUpperCase();
  const phone = normPhone(url.searchParams.get('phone'));
  if (!code || !phone) throw bad('کد پیگیری و موبایل را وارد کنید');
  const p = await loadPlatform();
  const o = Object.values(p.orders).find((x) => x.code === code && x.contact?.phone === phone);
  if (!o) throw notFound('درخواستی با این مشخصات پیدا نشد');
  return { order: publicOrderView(o) };
}, { public: true });

// ------------------------------------------------------------------ admin (platform staff)
on('GET', '/api/admin/overview', async ({ req }) => {
  const u = await requireUser(req);
  requireStaff(u);
  const [users, p] = await Promise.all([loadUsers(), loadPlatform()]);
  const userList = Object.values(users.users).map((x) => ({ ...publicUser(x, p.tenants[x.tenantId]), active: x.active, lastLoginAt: x.lastLoginAt || null, createdAt: x.createdAt }));
  const orders = Object.values(p.orders).sort((a, b) => b.createdAt - a.createdAt);
  return {
    tenants: Object.values(p.tenants).sort((a, b) => b.createdAt - a.createdAt),
    users: userList,
    orders,
    bots: await botInfo(),
    notify: await notifyStatus(),
    system: { storage: storeStats(), ai: aiEnabled(), appUrl: config.appUrl },
  };
});

on('POST', '/api/admin/tenants', async ({ req }) => {
  const u = await requireUser(req);
  requireStaff(u);
  const body = await readJson(req, 4096);
  const name = oneLine(body.name, 80);
  if (!name) throw bad('نام دفتر را وارد کنید');
  const tenantId = id('t_');
  const owner = await createUser({ name: body.ownerName, phone: body.ownerPhone, username: body.username, role: 'owner', tenantId });
  await mutatePlatform((p) => {
    p.tenants[tenantId] = { id: tenantId, name, city: oneLine(body.city || 'مشهد', 40), phone: normPhone(body.ownerPhone), active: true, createdAt: Date.now(), createdBy: u.id };
  });
  return { tenantId, ...owner };
});

on('PATCH', '/api/admin/tenants/:id', async ({ req, params }) => {
  const u = await requireUser(req);
  requireStaff(u);
  const body = await readJson(req, 4096);
  await mutatePlatform((p) => {
    const t = p.tenants[params.id];
    if (!t) throw notFound();
    if ('active' in body) t.active = Boolean(body.active);
    if ('name' in body && oneLine(body.name, 80)) t.name = oneLine(body.name, 80);
  });
  if ('active' in body) {
    await mutateUsers((d) => {
      for (const x of Object.values(d.users)) {
        if (x.tenantId === params.id && !x.staff) {
          x.active = Boolean(body.active);
          x.sv = (x.sv || 1) + 1;
        }
      }
    });
  }
  return { ok: true };
});

on('PATCH', '/api/admin/orders/:id', async ({ req, params }) => {
  const u = await requireUser(req);
  requireStaff(u);
  const body = await readJson(req, 8192);
  let order;
  await mutatePlatform((p) => {
    const o = p.orders[params.id];
    if (!o) throw notFound();
    const note = oneLine(body.note, 300);
    if (body.status && ORDER_STATUS.includes(body.status) && body.status !== o.status) {
      o.status = body.status;
      o.history.push({ at: Date.now(), status: o.status, by: u.name, note });
    } else if (note) o.history.push({ at: Date.now(), status: o.status, by: u.name, note });
    if ('price' in body) o.price = body.price === null || body.price === '' ? null : Math.max(0, Number(toEnDigits(body.price)) || 0);
    if ('scheduledAt' in body) o.scheduledAt = oneLine(body.scheduledAt, 80);
    if ('assignee' in body) o.assignee = oneLine(body.assignee, 80);
    if ('deliveryLink' in body) {
      const link = oneLine(body.deliveryLink, 500);
      if (link && !/^https:\/\//.test(link)) throw bad('لینک تحویل باید با https شروع شود');
      o.deliveryLink = link;
    }
    o.updatedAt = Date.now();
    order = o;
  });
  return { order };
});

on('GET', '/api/admin/notify', async ({ req }) => {
  const u = await requireUser(req);
  requireStaff(u);
  return { recipients: await notifyStatus() };
});

on('PUT', '/api/admin/notify', async ({ req }) => {
  const u = await requireUser(req);
  requireStaff(u);
  const body = await readJson(req, 2048);
  return { recipients: await setNotifyUsernames(body.usernames) };
});

on('POST', '/api/admin/bots', async ({ req }) => {
  const u = await requireUser(req);
  requireStaff(u);
  if (!config.appUrl) throw bad('APP_URL تنظیم نشده است');
  const body = await readJson(req, 4096);
  const platform = pick(body.platform, ['telegram', 'bale'], null);
  if (!platform) throw bad();
  try {
    return await connectBot(platform, String(body.token || '').trim());
  } catch (e) {
    throw bad('اتصال ربات ناموفق بود: ' + String(e.message).slice(0, 160));
  }
});

on('DELETE', '/api/admin/bots/:platform', async ({ req, params }) => {
  const u = await requireUser(req);
  requireStaff(u);
  if (!['telegram', 'bale'].includes(params.platform)) throw bad();
  await disconnectBot(params.platform);
  return { ok: true };
});

on('POST', '/api/admin/users/:id/reset', async ({ req, params }) => {
  const u = await requireUser(req);
  requireStaff(u);
  return await resetPassword(u, params.id, (x) => x.id !== u.id && (u.staff === 'superadmin' || x.staff !== 'superadmin'));
});

on('PATCH', '/api/admin/users/:id', async ({ req, params }) => {
  const u = await requireUser(req);
  requireStaff(u);
  const body = await readJson(req, 4096);
  await mutateUsers((d) => {
    const x = d.users[params.id];
    if (!x) throw notFound();
    if (x.id === u.id || (x.staff === 'superadmin' && u.staff !== 'superadmin')) throw forbidden();
    if ('active' in body) {
      x.active = Boolean(body.active);
      x.sv = (x.sv || 1) + 1;
    }
  });
  return { ok: true };
});

on('POST', '/api/admin/staff', async ({ req }) => {
  const u = await requireUser(req);
  requireStaff(u, 'superadmin');
  const body = await readJson(req, 4096);
  return await createUser({ name: body.name, phone: body.phone, username: body.username, role: 'owner', tenantId: u.tenantId, staff: 'admin' });
});

// ------------------------------------------------------------------ health
on('GET', '/api/health', async () => ({ ok: true, ai: aiEnabled(), storage: storeStats().backend || 'idle' }), { public: true });

export { checkPasswordPolicy, NO_WRITE };
