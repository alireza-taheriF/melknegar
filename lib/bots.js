// Telegram and Bale bots — a full mini-panel inside the messenger.
// Users link their account once, then from the bot they can: capture files
// and clients (text / voice / photo of the paper ledger), browse and search
// their ledger, open a card for any record, change status with one tap
// (sold / rented / still available / withdrawn), approve AI-captured records,
// edit by replying in plain Persian, see matches, get a dashboard summary and
// a one-time login link that opens the exact page in the web panel.
// Every read is filtered by the same visibility rules as the app, and every
// change goes through the same agency functions (permissions, activity log).
import { config } from './config.js';
import { loadPlatform, mutatePlatform, loadUsers, mutateUsers } from './data.js';
import { randomToken, sha256 } from './crypto.js';
import { createMagicLink } from './auth.js';
import { extractFromText, extractFromAudio, extractFromImage, aiEnabled } from './ai.js';
import { createRecords, listAll, updateProperty, updateClient, deleteProperty, deleteClient, summarize } from './agency.js';
import { matchScore, topMatches, isStale } from './domain.js';
import { NO_WRITE } from './store.js';
import { safeEqual, toEnDigits } from './util.js';
import { CATALOG } from './services.js';

export const PLATFORMS = {
  telegram: { name: 'تلگرام', api: 'https://api.telegram.org', link: (u, p) => `https://t.me/${u}?start=${p}` },
  bale: { name: 'بله', api: 'https://tapi.bale.ai', link: (u, p) => `https://ble.ir/${u}?start=${p}` },
};
const BOT_SETUP_VERSION = 2; // bump to re-register webhook settings + command menu on live bots

async function api(platform, token, method, body) {
  const res = await fetch(`${PLATFORMS[platform].api}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${platform}.${method}: ${json.description || res.status}`);
  return json.result;
}

async function download(platform, token, fileId, maxBytes = 8 * 1024 * 1024) {
  const f = await api(platform, token, 'getFile', { file_id: fileId });
  if (f.file_size && f.file_size > maxBytes) throw new Error('too_big');
  const res = await fetch(`${PLATFORMS[platform].api}/file/bot${token}/${f.file_path}`);
  if (!res.ok) throw new Error('download ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('too_big');
  return buf;
}

// ------------------------------------------------------------ admin side
const COMMANDS = [
  { command: 'menu', description: 'منوی اصلی' },
  { command: 'files', description: 'فایل‌های فعال' },
  { command: 'clients', description: 'مشتری‌ها' },
  { command: 'find', description: 'جستجو در فایل‌ها' },
  { command: 'review', description: 'موارد نیازمند بررسی' },
  { command: 'followup', description: 'فایل‌هایی که باید پیگیری شوند' },
  { command: 'summary', description: 'خلاصه وضعیت دفتر' },
  { command: 'login', description: 'ورود به پنل وب' },
  { command: 'help', description: 'راهنما' },
];

async function registerWebhook(platform, token, secret) {
  const url = `${config.appUrl}/api/bot/${platform}/${secret}`;
  try {
    await api(platform, token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
  } catch (e) {
    if (platform !== 'bale') throw e;
    await api(platform, token, 'setWebhook', { url }); // Bale may not accept the extra fields
  }
  await api(platform, token, 'setMyCommands', { commands: COMMANDS }).catch(() => {});
}

export async function connectBot(platform, token) {
  if (!PLATFORMS[platform]) throw new Error('platform');
  if (!/^\d{4,15}:[A-Za-z0-9_-]{20,80}$/.test(token)) throw new Error('توکن ربات معتبر نیست');
  const me = await api(platform, token, 'getMe');
  const secret = randomToken(24);
  await registerWebhook(platform, token, secret);
  await mutatePlatform((p) => {
    p.bots[platform] = { token, username: me.username, secret, connectedAt: Date.now(), setupV: BOT_SETUP_VERSION };
  });
  return { username: me.username };
}

// Bots connected before a settings change get upgraded on their next update.
async function ensureSetup(platform, bot) {
  if (bot.setupV === BOT_SETUP_VERSION) return;
  try {
    await registerWebhook(platform, bot.token, bot.secret);
    await mutatePlatform((p) => {
      if (!p.bots[platform]) return NO_WRITE;
      p.bots[platform].setupV = BOT_SETUP_VERSION;
    });
    bot.setupV = BOT_SETUP_VERSION;
  } catch (e) {
    console.error('bot setup upgrade failed', e.message);
  }
}

export async function disconnectBot(platform) {
  const p = await loadPlatform({ maxAge: 0 });
  const b = p.bots?.[platform];
  if (b?.token) await api(platform, b.token, 'deleteWebhook', {}).catch(() => {});
  await mutatePlatform((d) => {
    delete d.bots[platform];
  });
}

export async function botInfo() {
  const p = await loadPlatform();
  const out = {};
  for (const k of Object.keys(PLATFORMS)) {
    const b = p.bots?.[k];
    out[k] = b ? { connected: true, username: b.username, connectedAt: b.connectedAt } : { connected: false };
  }
  return out;
}

// Link token shown in the app; the user opens the bot with it.
export async function createLinkToken(userId) {
  const token = randomToken(12);
  await mutateUsers((d) => {
    const u = d.users[userId];
    if (!u) return NO_WRITE;
    u.linkToken = { hash: sha256(token), exp: Date.now() + 15 * 60_000 };
  });
  const bots = await botInfo();
  const links = {};
  for (const [k, b] of Object.entries(bots)) if (b.connected) links[k] = { url: PLATFORMS[k].link(b.username, token), username: b.username };
  return { token, links };
}

// ------------------------------------------------------------ labels & formatting
const TYPE_FA = { apartment: 'آپارتمان', villa: 'ویلایی', land: 'زمین', commercial: 'تجاری', office: 'اداری', garden: 'باغ', other: 'سایر' };
const DEAL_FA = { sale: 'فروش', rent: 'رهن و اجاره', presale: 'پیش‌فروش' };
const PSTATUS_FA = { active: '🟢 فعال', sold: '🔴 فروخته شد', rented: '🔴 اجاره رفت', withdrawn: '⚪️ منصرف شد', unknown: '🟡 نامعلوم' };
const CSTATUS_FA = { active: '🟢 فعال', done: '✅ به نتیجه رسید', paused: '⏸ متوقف' };
const FEATURE_FA = { parking: 'پارکینگ', elevator: 'آسانسور', storage: 'انباری', balcony: 'بالکن', lobby: 'لابی', pool: 'استخر', gym: 'سونا/باشگاه', renovated: 'بازسازی‌شده', single_unit: 'تک‌واحدی', yard: 'حیاط', furnished: 'مبله', document: 'سند تک‌برگ' };

const fa = (n) => Number(n).toLocaleString('fa-IR');
function money(n) {
  if (!n) return '';
  if (n >= 1e9) return `${(+(n / 1e9).toFixed(2)).toLocaleString('fa-IR')} میلیارد`;
  if (n >= 1e6) return `${(+(n / 1e6).toFixed(1)).toLocaleString('fa-IR')} میلیون`;
  return fa(n);
}
function ago(ts) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return 'امروز';
  if (d === 1) return 'دیروز';
  if (d < 30) return `${fa(d)} روز پیش`;
  if (d < 365) return `${fa(Math.floor(d / 30))} ماه پیش`;
  return `${fa(Math.floor(d / 365))} سال پیش`;
}

function propLine(p) {
  const parts = [`#${fa(p.no)}`, TYPE_FA[p.type], p.neighborhood, p.area && `${fa(p.area)}م`, p.rooms != null && `${fa(p.rooms)}خ`];
  if (p.deal === 'rent') parts.push(p.deposit && `رهن ${money(p.deposit)}`, p.rent && `اجاره ${money(p.rent)}`);
  else parts.push(p.price && money(p.price));
  return parts.filter(Boolean).join(' · ') + (p.needsReview ? ' ⚠️' : '');
}
function clientLine(c) {
  const budget = c.deal === 'rent' ? [c.depositMax && `رهن تا ${money(c.depositMax)}`, c.rentMax && `اجاره تا ${money(c.rentMax)}`] : [c.budgetMax && `تا ${money(c.budgetMax)}`];
  return [`#${fa(c.no)}`, c.name || 'بدون نام', DEAL_FA[c.deal], ...budget, c.neighborhoods?.slice(0, 2).join('، ')].filter(Boolean).join(' · ') + (c.needsReview ? ' ⚠️' : '');
}

function propCard(p) {
  const L = [];
  L.push(`🏠 فایل #${fa(p.no)} — ${PSTATUS_FA[p.status] || p.status}`);
  if (p.needsReview) L.push('⚠️ ثبت‌شده با ربات — اطلاعات را بررسی و تأیید کنید');
  L.push('');
  L.push([DEAL_FA[p.deal], TYPE_FA[p.type], p.neighborhood].filter(Boolean).join(' · '));
  const spec = [p.area && `${fa(p.area)} متر`, p.landArea && `زمین ${fa(p.landArea)} متر`, p.rooms != null && `${fa(p.rooms)} خواب`, p.floor != null && `طبقه ${fa(p.floor)}${p.totalFloors ? ' از ' + fa(p.totalFloors) : ''}`, p.buildYear && `ساخت ${fa(p.buildYear)}`].filter(Boolean);
  if (spec.length) L.push(spec.join(' · '));
  if (p.deal === 'rent') {
    if (p.deposit || p.rent) L.push(`💰 ${[p.deposit && 'رهن ' + money(p.deposit), p.rent && 'اجاره ' + money(p.rent)].filter(Boolean).join(' + ')} تومان`);
  } else if (p.price) {
    L.push(`💰 ${money(p.price)} تومان${p.area ? ` (متری ${money(Math.round(p.price / p.area))})` : ''}`);
  }
  if (p.features?.length) L.push('✨ ' + p.features.map((f) => FEATURE_FA[f] || f).join('، '));
  if (p.address) L.push('📍 ' + p.address);
  if (p.ownerName || p.ownerPhone) L.push('👤 مالک: ' + [p.ownerName, p.ownerPhone].filter(Boolean).join(' — '));
  if (p.notes) L.push('📝 ' + p.notes.slice(0, 400));
  L.push('');
  L.push(`🕓 ثبت ${ago(p.createdAt)} · آخرین تأیید موجودی ${ago(p.confirmedAt || p.createdAt)}${isStale(p) ? ' ⏰' : ''}`);
  return L.join('\n');
}

function clientCard(c) {
  const L = [];
  L.push(`👥 مشتری #${fa(c.no)} — ${CSTATUS_FA[c.status] || c.status}`);
  if (c.needsReview) L.push('⚠️ ثبت‌شده با ربات — اطلاعات را بررسی و تأیید کنید');
  L.push('');
  L.push(`${c.name || 'بدون نام'}${c.phone ? ' — ' + c.phone : ''}`);
  L.push(`دنبال: ${DEAL_FA[c.deal]}${c.types?.length ? ' · ' + c.types.map((t) => TYPE_FA[t]).join('، ') : ''}`);
  if (c.deal === 'rent') {
    const b = [c.depositMax && 'رهن تا ' + money(c.depositMax), c.rentMax && 'اجاره تا ' + money(c.rentMax)].filter(Boolean);
    if (b.length) L.push('💰 ' + b.join(' · '));
  } else if (c.budgetMin || c.budgetMax) {
    L.push(`💰 بودجه ${c.budgetMin ? 'از ' + money(c.budgetMin) + ' ' : ''}${c.budgetMax ? 'تا ' + money(c.budgetMax) : ''}`);
  }
  const spec = [(c.areaMin || c.areaMax) && `متراژ ${c.areaMin ? fa(c.areaMin) : ''}${c.areaMax ? '–' + fa(c.areaMax) : '+'}`, c.roomsMin != null && `حداقل ${fa(c.roomsMin)} خواب`].filter(Boolean);
  if (spec.length) L.push(spec.join(' · '));
  if (c.neighborhoods?.length) L.push('📍 ' + c.neighborhoods.join('، '));
  if (c.features?.length) L.push('✨ ' + c.features.map((f) => FEATURE_FA[f] || f).join('، '));
  if (c.notes) L.push('📝 ' + c.notes.slice(0, 400));
  L.push('');
  L.push(`🕓 ثبت ${ago(c.createdAt)}`);
  return L.join('\n');
}

// ------------------------------------------------------------ keyboards
const K = {
  add: '➕ ثبت فایل یا مشتری',
  files: '🏠 فایل‌ها',
  clients: '👥 مشتری‌ها',
  find: '🔎 جستجو',
  review: '📝 نیاز به بررسی',
  stale: '⏰ پیگیری فایل‌ها',
  summary: '📊 خلاصه دفتر',
  app: '🌐 ورود به پنل',
  help: '❓ راهنما',
};
const MAIN_KB = {
  keyboard: [[{ text: K.add }], [{ text: K.files }, { text: K.clients }], [{ text: K.find }, { text: K.review }], [{ text: K.stale }, { text: K.summary }], [{ text: K.app }, { text: K.help }]],
  resize_keyboard: true,
  is_persistent: true,
};
const btn = (text, data) => ({ text, callback_data: data });

function propKb(p) {
  const n = p.no;
  const rows = [];
  if (p.needsReview) rows.push([btn('✔️ اطلاعات درست است', `p:${n}:rv`)]);
  if (p.status === 'active') {
    rows.push([btn('✅ هنوز موجوده', `p:${n}:ok`), btn('🎯 مشتری‌های مناسب', `p:${n}:m`)]);
    rows.push([p.deal === 'rent' ? btn('🔑 اجاره رفت', `p:${n}:rented`) : btn('💰 فروخته شد', `p:${n}:sold`), btn('⛔ منصرف شد', `p:${n}:wd`)]);
  } else {
    rows.push([btn('♻️ دوباره فعال کن', `p:${n}:act`)]);
  }
  rows.push([btn('✏️ ویرایش', `p:${n}:ed`), btn('🗑 حذف', `p:${n}:del`), btn('🌐 در پنل', `p:${n}:web`)]);
  return { inline_keyboard: rows };
}

function clientKb(c) {
  const n = c.no;
  const rows = [];
  if (c.needsReview) rows.push([btn('✔️ اطلاعات درست است', `c:${n}:rv`)]);
  rows.push([btn('🎯 فایل‌های مناسب', `c:${n}:m`)]);
  if (c.status === 'active') rows.push([btn('✅ به نتیجه رسید', `c:${n}:done`), btn('⏸ متوقف', `c:${n}:pause`)]);
  else rows.push([btn('♻️ دوباره فعال کن', `c:${n}:act`)]);
  rows.push([btn('✏️ ویرایش', `c:${n}:ed`), btn('🗑 حذف', `c:${n}:del`), btn('🌐 در پنل', `c:${n}:web`)]);
  return { inline_keyboard: rows };
}

const confirmKb = (k, n) => ({ inline_keyboard: [[btn('بله، حذف شود', `${k}:${n}:delok`), btn('انصراف', `${k}:${n}:show`)]] });

// ------------------------------------------------------------ lists
const PAGE = 8;
const FILE_FILTERS = { a: 'فعال', s: 'پیگیری', c: 'بسته‌شده', r: 'بررسی' };
const CLIENT_FILTERS = { a: 'فعال', d: 'نتیجه‌گرفته', r: 'بررسی' };

function filterFiles(props, f) {
  const t = Date.now();
  if (f === 's') return props.filter((p) => isStale(p, t)).sort((a, b) => (a.confirmedAt || a.createdAt) - (b.confirmedAt || b.createdAt));
  const byNew = (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
  if (f === 'c') return props.filter((p) => p.status !== 'active').sort((a, b) => (b.closedAt || b.updatedAt) - (a.closedAt || a.updatedAt));
  if (f === 'r') return props.filter((p) => p.needsReview).sort(byNew);
  return props.filter((p) => p.status === 'active').sort(byNew);
}
function filterClients(clients, f) {
  const byNew = (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
  if (f === 'd') return clients.filter((c) => c.status !== 'active').sort(byNew);
  if (f === 'r') return clients.filter((c) => c.needsReview).sort(byNew);
  return clients.filter((c) => c.status === 'active').sort(byNew);
}

function listView(kind, filter, page, data) {
  const isFile = kind === 'p';
  const all = isFile ? filterFiles(data.props, filter) : filterClients(data.clients, filter);
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = all.slice(page * PAGE, page * PAGE + PAGE);
  const names = isFile ? FILE_FILTERS : CLIENT_FILTERS;
  const title = isFile ? `🏠 فایل‌ها — ${names[filter]}` : `👥 مشتری‌ها — ${names[filter]}`;
  let text = `${title} (${fa(all.length)} مورد)`;
  if (pages > 1) text += ` · صفحه ${fa(page + 1)} از ${fa(pages)}`;
  text += '\n\n';
  if (!slice.length) text += isFile && filter === 's' ? 'همه فایل‌ها به‌روز هستند 👌' : 'موردی نیست.';
  else text += slice.map((x) => (isFile ? propLine(x) : clientLine(x))).join('\n');
  if (isFile && filter === 's' && slice.length) text += '\n\nاین فایل‌ها بیش از ۳۰ روز است تأیید نشده‌اند؛ هر کدام را باز کنید و وضعیتش را بزنید.';
  if (slice.length) text += '\n\nبرای دیدن کارت و دکمه‌ها، شماره را بزنید:';
  const rows = [];
  for (let i = 0; i < slice.length; i += 4) rows.push(slice.slice(i, i + 4).map((x) => btn(`#${fa(x.no)}`, `${kind}:${x.no}:show`)));
  const nav = [];
  if (page > 0) nav.push(btn('« قبلی', `L:${kind}:${filter}:${page - 1}`));
  if (page < pages - 1) nav.push(btn('بعدی »', `L:${kind}:${filter}:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push(Object.entries(names).map(([k, v]) => btn(k === filter ? `• ${v}` : v, `L:${kind}:${k}:0`)));
  return { text, reply_markup: { inline_keyboard: rows } };
}

function summaryView(data, name) {
  const s = summarize(data.props, data.clients);
  const sale = data.props.filter((p) => p.status === 'active' && p.deal !== 'rent').length;
  const rent = data.props.filter((p) => p.status === 'active' && p.deal === 'rent').length;
  const week = data.props.filter((p) => Date.now() - p.createdAt < 7 * 86400000).length;
  const text = [
    `📊 خلاصه ${name || 'دفتر'}`,
    '',
    `🏠 فایل فعال: ${fa(s.active)} (فروش ${fa(sale)} · اجاره ${fa(rent)})`,
    `🆕 فایل جدید این هفته: ${fa(week)}`,
    `🤝 بسته‌شده در ۳۰ روز اخیر: ${fa(s.closedMonth)}`,
    `👥 مشتری فعال: ${fa(s.clients)}`,
    `⏰ نیاز به پیگیری (بیش از ۳۰ روز تأییدنشده): ${fa(s.stale)}`,
    `📝 نیاز به بررسی: ${fa(s.review)}`,
  ].join('\n');
  const rows = [[btn('🏠 فایل‌ها', 'L:p:a:0'), btn('👥 مشتری‌ها', 'L:c:a:0')]];
  const extra = [];
  if (s.stale) extra.push(btn(`⏰ پیگیری (${fa(s.stale)})`, 'L:p:s:0'));
  if (s.review) extra.push(btn(`📝 بررسی (${fa(s.review)})`, 'R:0'));
  if (extra.length) rows.push(extra);
  return { text, reply_markup: { inline_keyboard: rows } };
}

function reviewView(data) {
  const props = data.props.filter((p) => p.needsReview);
  const clients = data.clients.filter((c) => c.needsReview);
  if (!props.length && !clients.length) return { text: '📝 موردی برای بررسی نیست 👌' };
  const L = ['📝 موارد ثبت‌شده با ربات که هنوز تأیید نشده‌اند:', ''];
  const rows = [];
  for (const p of props.slice(0, 10)) {
    L.push(propLine(p));
    rows.push([btn(`🏠 #${fa(p.no)} مشاهده`, `p:${p.no}:show`), btn('✔️ تأیید', `p:${p.no}:rv`)]);
  }
  for (const c of clients.slice(0, 10)) {
    L.push(clientLine(c));
    rows.push([btn(`👥 #${fa(c.no)} مشاهده`, `c:${c.no}:show`), btn('✔️ تأیید', `c:${c.no}:rv`)]);
  }
  if (props.length + clients.length > 20) L.push('', '… بقیه در پنل وب');
  return { text: L.join('\n'), reply_markup: { inline_keyboard: rows } };
}

function matchesView(kind, rec, data) {
  if (kind === 'p') {
    const hits = topMatches(data.clients, rec, (c, p) => matchScore(p, c), 8);
    if (!hits.length) return { text: `🎯 برای فایل #${fa(rec.no)} فعلاً مشتری مناسبی در دفتر نیست.` };
    return {
      text: `🎯 مشتری‌های مناسب فایل #${fa(rec.no)}:\n\n` + hits.map((h) => `${fa(h.score)}٪ — ${clientLine(h.item)}${h.item.phone ? '\n     📞 ' + h.item.phone : ''}`).join('\n'),
      reply_markup: { inline_keyboard: chunk(hits.map((h) => btn(`👥 #${fa(h.item.no)}`, `c:${h.item.no}:show`)), 4) },
    };
  }
  const hits = topMatches(data.props, rec, matchScore, 8);
  if (!hits.length) return { text: `🎯 برای ${rec.name || 'مشتری #' + fa(rec.no)} فعلاً فایل مناسبی نیست.` };
  return {
    text: `🎯 فایل‌های مناسب ${rec.name || 'مشتری #' + fa(rec.no)}:\n\n` + hits.map((h) => `${fa(h.score)}٪ — ${propLine(h.item)}`).join('\n'),
    reply_markup: { inline_keyboard: chunk(hits.map((h) => btn(`🏠 #${fa(h.item.no)}`, `p:${h.item.no}:show`)), 4) },
  };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function searchView(q, data) {
  const words = toEnDigits(q).replace(/[#،,]/g, ' ').split(/\s+/).filter(Boolean).map((w) => w.replace(/ي/g, 'ی').replace(/ك/g, 'ک'));
  if (!words.length) return { text: 'عبارت جستجو خالی است.' };
  const hay = (s) => toEnDigits(s).replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  const pHits = data.props.filter((p) => {
    const h = hay([p.no, DEAL_FA[p.deal], TYPE_FA[p.type], p.neighborhood, p.address, p.area && p.area + 'متر', p.area, p.rooms != null && p.rooms + 'خواب', p.rooms != null && p.rooms + ' خواب', p.ownerName, p.ownerPhone, p.notes, p.status === 'active' ? 'فعال' : 'فروخته اجاره'].filter(Boolean).join(' '));
    return words.every((w) => h.includes(w));
  });
  const cHits = data.clients.filter((c) => {
    const h = hay([c.no, 'مشتری', c.name, c.phone, DEAL_FA[c.deal], c.neighborhoods?.join(' '), c.notes].filter(Boolean).join(' '));
    return words.every((w) => h.includes(w));
  });
  pHits.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || b.createdAt - a.createdAt);
  if (!pHits.length && !cHits.length) return { text: `🔎 برای «${q}» چیزی پیدا نشد.\nکلمات کمتری امتحان کنید؛ مثلاً فقط نام محله.` };
  const L = [`🔎 نتایج «${q}»:`];
  if (pHits.length) L.push('', `🏠 فایل‌ها (${fa(pHits.length)})`, ...pHits.slice(0, 10).map(propLine));
  if (cHits.length) L.push('', `👥 مشتری‌ها (${fa(cHits.length)})`, ...cHits.slice(0, 6).map(clientLine));
  const buttons = [...pHits.slice(0, 10).map((p) => btn(`🏠 #${fa(p.no)}`, `p:${p.no}:show`)), ...cHits.slice(0, 6).map((c) => btn(`👥 #${fa(c.no)}`, `c:${c.no}:show`))];
  return { text: L.join('\n'), reply_markup: { inline_keyboard: chunk(buttons, 4) } };
}

// ------------------------------------------------------------ texts
const HELP = `راهنمای ربات پلاک‌نگار 🏠

➕ ثبت سریع — فقط بفرستید:
• متن: «الهیه، ۱۲۰ متر، ۳ خواب، طبقه ۲، پارکینگ، ۹ میلیارد، آقای رضایی ۰۹۱۵...»
• پیام صوتی: فایل را تعریف کنید؛ خودش ثبت می‌شود.
• عکس صفحه دفتر: همه فایل‌های آن صفحه استخراج می‌شود.
• درخواست خریدار هم همین‌طور: «مشتری خرید، تا ۷ میلیارد، سجاد یا الهیه، ۲ خواب، آقای کریمی ۰۹۱۲...»

🗂 مدیریت دفتر:
• «فایل‌ها» و «مشتری‌ها»: فهرست با دکمه برای هر مورد
• روی هر کارت: هنوز موجوده / فروخته شد / اجاره رفت / مشتری‌های مناسب / ویرایش / حذف
• ویرایش: «✏️ ویرایش» را بزنید و تغییر را بنویسید؛ مثلاً «قیمت ۹ و نیم میلیارد» یا «طبقه ۴، ۳ خواب»
• شماره فایل را بفرستید (مثلاً #۱۲۳) تا کارتش باز شود.
• جستجو: «جستجو الهیه ۳ خواب»

⏰ «پیگیری فایل‌ها» فایل‌هایی را نشان می‌دهد که بیش از ۳۰ روز تأیید نشده‌اند.
🌐 «ورود به پنل» لینک ورود یک‌بار مصرف به پنل وب می‌دهد.`;

const ADD_TEXT = `➕ ثبت فایل یا مشتری

همین حالا یکی از این‌ها را بفرستید:
📝 متن فایل یا درخواست مشتری
🎙️ پیام صوتی
📷 عکس صفحه دفتر

مثال فایل: «فروش، سجاد، ۹۵ متر، ۲ خواب، طبقه ۳، آسانسور و پارکینگ، ۶ میلیارد و ۸۰۰، خانم احمدی ۰۹۱۵۱۲۳۴۵۶۷»
مثال مشتری: «مشتری اجاره، رهن تا ۵۰۰ میلیون، اجاره تا ۱۵ میلیون، قاسم‌آباد، آقای نوری ۰۹۳۵...»

ربات خودش تشخیص می‌دهد فایل است یا مشتری، و برای هر فایل مشتری‌های مناسب را پیدا می‌کند.`;

// ------------------------------------------------------------ update handling
const seen = new Map(); // dedupe retried updates per instance
const pending = new Map(); // chatKey -> { mode: 'find' | 'edit', kind, no, at } (best effort, per instance)

export async function handleUpdate(platform, pathSecret, headerSecret, update) {
  const p = await loadPlatform();
  const bot = p.bots?.[platform];
  if (!bot || !safeEqual(pathSecret, bot.secret)) return { status: 404 };
  if (headerSecret && !safeEqual(headerSecret, bot.secret)) return { status: 401 };

  const key = `${platform}:${update?.update_id}`;
  if (seen.has(key)) return { status: 200 };
  seen.set(key, Date.now());
  if (seen.size > 2000) seen.delete(seen.keys().next().value);

  await ensureSetup(platform, bot);
  const call = (method, body) => api(platform, bot.token, method, body);

  if (update?.callback_query) {
    const cq = update.callback_query;
    const chat = cq.message?.chat;
    if (!chat || chat.type !== 'private') {
      await call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      return { status: 200 };
    }
    try {
      await onCallback(platform, call, String(chat.id), cq);
    } catch (e) {
      console.error('bot callback error', e);
      await call('answerCallbackQuery', { callback_query_id: cq.id, text: e?.status ? e.message : 'خطایی پیش آمد؛ دوباره امتحان کنید.', show_alert: true }).catch(() => {});
    }
    return { status: 200 };
  }

  const msg = update?.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private') return { status: 200 };
  const chatId = String(msg.chat.id);
  const send = (text, extra = {}) => call('sendMessage', { chat_id: msg.chat.id, text: String(text).slice(0, 4000), disable_web_page_preview: true, ...extra }).catch((e) => console.error(e.message));

  try {
    await onMessage(platform, bot, call, chatId, msg, send);
  } catch (e) {
    console.error('bot error', e);
    await send(e?.status ? e.message : 'متأسفانه خطایی پیش آمد. دوباره امتحان کنید یا از داخل پنل ثبت کنید.');
  }
  return { status: 200 };
}

async function userForChat(platform, chatId) {
  const users = await loadUsers();
  const uid = users.byChat[`${platform}:${chatId}`];
  const user = uid ? users.users[uid] : null;
  return user && user.active ? user : null;
}

const NOT_LINKED = 'سلام! این ربات پلاک‌نگار است 🏠\nبرای استفاده، وارد پنل شوید و از «تنظیمات ← اتصال ربات» دکمه اتصال را بزنید.';

async function loginLink(user, next) {
  const link = await createMagicLink(user.id);
  return next ? `${link}&next=${encodeURIComponent(next)}` : link;
}

async function onMessage(platform, bot, call, chatId, msg, send) {
  const text = (msg.text || msg.caption || '').trim();
  const chatKey = `${platform}:${chatId}`;

  // /start <token>: link this chat to the account that generated the token.
  const startMatch = text.match(/^\/start(?:\s+([A-Za-z0-9_-]{8,64}))?$/);
  if (startMatch && startMatch[1]) {
    const tokenHash = sha256(startMatch[1]);
    let linked = null;
    await mutateUsers((d) => {
      const u = Object.values(d.users).find((x) => x.linkToken && x.linkToken.hash === tokenHash && x.linkToken.exp > Date.now() && x.active);
      if (!u) return NO_WRITE;
      for (const [k, v] of Object.entries(d.byChat)) if (v === u.id && k.startsWith(platform + ':')) delete d.byChat[k];
      d.byChat[chatKey] = u.id;
      u[platform === 'telegram' ? 'tg' : 'bale'] = { chatId, linkedAt: Date.now() };
      delete u.linkToken;
      linked = u;
    });
    if (!linked) return send('این لینک اتصال منقضی شده یا نامعتبر است. از داخل پنل (تنظیمات ← اتصال ربات) لینک جدید بگیرید.');
    if (linked.staff && !linked.tenantId) return send(`سلام ${linked.name} 👋\nحساب مدیریت شما به ربات وصل شد. سفارش‌های جدید و ثبت‌نام املاکی‌ها همین‌جا اعلام می‌شود.`, { reply_markup: STAFF_KB });
    return send(`سلام ${linked.name} 👋\nحساب شما به ربات پلاک‌نگار وصل شد.\nاز این به بعد دفترتان همین‌جا در دسترس است. از دکمه‌های پایین استفاده کنید یا مستقیم فایل بفرستید.`, { reply_markup: MAIN_KB });
  }

  const fresh = await captureNotifyChat(platform, msg, send);
  const user = await userForChat(platform, chatId);
  if (!user) return fresh ? undefined : send(NOT_LINKED, { reply_markup: { remove_keyboard: true } });

  const is = (...alts) => alts.some((a) => (a instanceof RegExp ? a.test(text) : text === a));

  if (is(/^\/(start|menu)$/, 'منو') && !(user.staff && !user.tenantId)) {
    pending.delete(chatKey);
    return send(`سلام ${user.name} 👋\nچه کاری انجام بدهم؟ فایل یا مشتری را مستقیم بفرستید، یا از دکمه‌ها استفاده کنید.`, { reply_markup: MAIN_KB });
  }
  if (is(/^\/help$/, 'راهنما', K.help)) return send(HELP, { reply_markup: MAIN_KB });

  if (is(/^\/login$/, 'ورود', K.app)) {
    const link = await loginLink(user);
    return send('🌐 ورود به پنل پلاک‌نگار\nاین لینک ۱۰ دقیقه اعتبار دارد و فقط یک بار کار می‌کند. آن را برای کسی نفرستید.', {
      reply_markup: { inline_keyboard: [[{ text: '🌐 باز کردن پنل', url: link }]] },
    });
  }

  if (!user.tenantId) {
    if (!user.staff) return send('حساب شما به دفتر املاکی متصل نیست.');
    return staffMessage(user, text, send);
  }

  if (is(K.add)) {
    pending.delete(chatKey);
    return send(ADD_TEXT);
  }
  if (is(/^\/files$/, K.files)) return send(...viewArgs(listView('p', 'a', 0, await listAll(user))));
  if (is(/^\/clients$/, K.clients)) return send(...viewArgs(listView('c', 'a', 0, await listAll(user))));
  if (is(/^\/followup$/, K.stale)) return send(...viewArgs(listView('p', 's', 0, await listAll(user))));
  if (is(/^\/review$/, K.review)) return send(...viewArgs(reviewView(await listAll(user))));
  if (is(/^\/summary$/, K.summary)) return send(...viewArgs(summaryView(await listAll(user), (await loadPlatform()).tenants?.[user.tenantId]?.name)));
  if (is(/^\/find$/, K.find, 'جستجو')) {
    pending.set(chatKey, { mode: 'find', at: Date.now() });
    return send('🔎 چه چیزی را جستجو کنم؟\nمحله، متراژ، تعداد خواب، نام یا شماره مالک… مثلاً: «الهیه ۳ خواب» یا «رضایی»', { reply_markup: { force_reply: true, input_field_placeholder: 'مثلاً: الهیه ۳ خواب' } });
  }

  const findMatch = text.match(/^(?:\/find|جستجو|جستجوی)\s+(.+)$/s);
  if (findMatch) return send(...viewArgs(searchView(findMatch[1].trim(), await listAll(user))));

  // "#123" opens a card
  const noMatch = toEnDigits(text).match(/^#?\s*(\d{1,7})$/);
  if (noMatch) return showCard(user, Number(noMatch[1]), null, send);

  // Edit: "ویرایش #123 قیمت ۹ میلیارد", or a reply to an edit prompt / card, or a pending edit
  const editInline = toEnDigits(text).match(/^ویرایش\s*(فایل|مشتری)?\s*#?\s*(\d{1,7})\s+(.+)$/s);
  const replied = msg.reply_to_message?.text || '';
  const repliedRef = toEnDigits(replied).match(/(فایل|مشتری)\s*#(\d{1,7})/);
  const pend = pending.get(chatKey);
  const pendFresh = pend && Date.now() - pend.at < 15 * 60_000;
  if (editInline) {
    return applyEdit(user, editInline[1] === 'مشتری' ? 'c' : editInline[1] === 'فایل' ? 'p' : null, Number(editInline[2]), editInline[3], send);
  }
  if (msg.text && repliedRef && (replied.startsWith('✏️') || /^(🏠 فایل|👥 مشتری) #/.test(replied))) {
    pending.delete(chatKey);
    return applyEdit(user, repliedRef[1] === 'مشتری' ? 'c' : 'p', Number(repliedRef[2]), text, send);
  }
  if (msg.text && replied.startsWith('🔎')) {
    pending.delete(chatKey);
    return send(...viewArgs(searchView(text, await listAll(user))));
  }
  if (msg.text && pendFresh && !text.startsWith('/')) {
    pending.delete(chatKey);
    if (pend.mode === 'find') return send(...viewArgs(searchView(text, await listAll(user))));
    if (pend.mode === 'edit') return applyEdit(user, pend.kind, pend.no, text, send);
  }

  // Otherwise: capture new files / clients.
  return capture(platform, bot, user, msg, text, send);
}

const viewArgs = (v) => [v.text, v.reply_markup ? { reply_markup: v.reply_markup } : {}];

function findRec(data, kind, no) {
  if (kind !== 'c') {
    const p = data.props.find((x) => x.no === no);
    if (p) return { kind: 'p', rec: p };
  }
  if (kind !== 'p') {
    const c = data.clients.find((x) => x.no === no);
    if (c) return { kind: 'c', rec: c };
  }
  return null;
}

async function showCard(user, no, kind, send) {
  const data = await listAll(user);
  const f = findRec(data, kind, no);
  if (!f) return send(`موردی با شماره #${fa(no)} در دفتر شما پیدا نشد.`);
  return f.kind === 'p' ? send(propCard(f.rec), { reply_markup: propKb(f.rec) }) : send(clientCard(f.rec), { reply_markup: clientKb(f.rec) });
}

// Turn a free-text change ("قیمت ۹ و نیم میلیارد"، "۳ خواب طبقه ۴") into a patch.
const P_FIELDS = ['price', 'deposit', 'rent', 'area', 'landArea', 'rooms', 'floor', 'totalFloors', 'buildYear', 'neighborhood', 'address', 'ownerName', 'ownerPhone'];
const C_FIELDS = ['name', 'phone', 'budgetMin', 'budgetMax', 'depositMax', 'rentMax', 'areaMin', 'areaMax', 'roomsMin'];

async function applyEdit(user, kind, no, text, send) {
  const data = await listAll(user);
  const f = findRec(data, kind, no);
  if (!f) return send(`موردی با شماره #${fa(no)} پیدا نشد.`);
  const parsed = await extractFromText(text);
  const d = parsed.items[0]?.data || {};
  const patch = {};
  const status = /فروخته|فروش رفت/.test(text) ? 'sold' : /اجاره رفت|اجاره داده/.test(text) ? 'rented' : /منصرف/.test(text) ? 'withdrawn' : null;
  if (f.kind === 'p') {
    for (const k of P_FIELDS) if (d[k] != null && d[k] !== '' && d[k] !== f.rec[k]) patch[k] = d[k];
    const feats = (d.features || []).filter((x) => !f.rec.features?.includes(x));
    if (feats.length) patch.features = [...(f.rec.features || []), ...feats];
    if (status) patch.status = status;
    if (/^(یادداشت|توضیح)[:\s]/.test(text)) patch.notes = text.replace(/^(یادداشت|توضیح)[:\s]*/, '');
  } else {
    for (const k of C_FIELDS) if (d[k] != null && d[k] !== '' && d[k] !== f.rec[k]) patch[k] = d[k];
    // A client text parsed as a property: map price-like fields onto the budget.
    if (parsed.items[0]?.kind === 'property') {
      if (d.price && f.rec.deal !== 'rent') patch.budgetMax = d.price;
      if (d.deposit) patch.depositMax = d.deposit;
      if (d.rent) patch.rentMax = d.rent;
      if (d.area) patch.areaMin = d.area;
      if (d.rooms != null) patch.roomsMin = d.rooms;
      if (d.neighborhood) patch.neighborhoods = [...new Set([...(f.rec.neighborhoods || []), d.neighborhood])];
    }
    if (d.neighborhoods?.length) patch.neighborhoods = [...new Set([...(f.rec.neighborhoods || []), ...d.neighborhoods])];
    if (/^(یادداشت|توضیح)[:\s]/.test(text)) patch.notes = text.replace(/^(یادداشت|توضیح)[:\s]*/, '');
  }
  if (!Object.keys(patch).length) {
    return send('تغییری تشخیص ندادم. واضح‌تر بنویسید؛ مثلاً «قیمت ۸ میلیارد و ۵۰۰»، «۳ خواب»، «طبقه ۴»، «مالک ۰۹۱۵...» یا «یادداشت: کلید دست سرایدار».');
  }
  patch.reviewed = true;
  if (f.kind === 'p') {
    const next = await updateProperty(user, f.rec.id, patch);
    return send('✅ ذخیره شد.\n\n' + propCard(next), { reply_markup: propKb(next) });
  }
  const next = await updateClient(user, f.rec.id, patch);
  return send('✅ ذخیره شد.\n\n' + clientCard(next), { reply_markup: clientKb(next) });
}

async function capture(platform, bot, user, msg, text, send) {
  let result;
  if (msg.voice || msg.audio) {
    if (!aiEnabled()) return send('پردازش صدا فعلاً فعال نیست. لطفاً متن بفرستید.');
    const media = msg.voice || msg.audio;
    if ((media.duration || 0) > 300) return send('پیام صوتی باید کمتر از ۵ دقیقه باشد.');
    await send('🎙️ پیام صوتی دریافت شد؛ در حال تبدیل به فایل…');
    const buf = await download(platform, bot.token, media.file_id);
    result = await extractFromAudio(buf, media.mime_type || 'audio/ogg');
  } else if (msg.photo?.length || (msg.document && /^image\//.test(msg.document.mime_type || ''))) {
    if (!aiEnabled()) return send('خواندن عکس فعلاً فعال نیست. لطفاً متن بفرستید.');
    await send('📄 عکس دریافت شد؛ در حال خواندن صفحه دفتر… (تا یک دقیقه)');
    const ph = msg.photo?.length ? msg.photo[msg.photo.length - 1] : msg.document;
    const buf = await download(platform, bot.token, ph.file_id);
    result = await extractFromImage(buf, msg.document?.mime_type || 'image/jpeg');
  } else if (text && !text.startsWith('/') && text.length >= 6) {
    result = await extractFromText(text);
  } else {
    return send('متوجه نشدم 🤔 فایل یا مشتری را بنویسید، پیام صوتی بفرستید، یا از دکمه‌ها استفاده کنید.', { reply_markup: MAIN_KB });
  }

  const useful = result.items.filter((it) => {
    const d = it.data || {};
    return it.kind === 'client' ? d.name || d.phone || d.budgetMax || d.depositMax || d.neighborhoods?.length : d.neighborhood || d.area || d.price || d.deposit || d.rent || d.ownerPhone || d.address;
  });
  if (!useful.length) return send('چیزی برای ثبت پیدا نکردم. مشخصات فایل (محله، متراژ، قیمت، تلفن مالک…) یا درخواست مشتری را بنویسید.\nبرای جستجو بنویسید: «جستجو الهیه»');
  const items = useful.map((it) => ({ ...it, data: { ...it.data, needsReview: true } }));
  const created = await createRecords(user, items, platform);

  const data = await listAll(user);
  const L = [];
  if (result.transcript && (msg.voice || msg.audio)) L.push(`🗣 «${result.transcript.slice(0, 500)}»`, '');
  L.push(`✅ ${fa(created.properties.length + created.clients.length)} مورد ثبت شد. لطفاً بررسی و تأیید کنید:`);
  const rows = [];
  for (const p of created.properties.slice(0, 12)) {
    const n = topMatches(data.clients, p, (c, pp) => matchScore(pp, c), 50).length;
    L.push('', `🏠 ${propLine(p)}`, p.ownerName || p.ownerPhone ? `   👤 ${[p.ownerName, p.ownerPhone].filter(Boolean).join(' — ')}` : null, n ? `   🎯 ${fa(n)} مشتری مناسب دارد` : null);
    const r = [btn(`✔️ تأیید #${fa(p.no)}`, `p:${p.no}:rv`), btn('👁 کارت', `p:${p.no}:show`)];
    if (n) r.push(btn(`🎯 ${fa(n)} مشتری`, `p:${p.no}:m`));
    r.push(btn('↩️ لغو', `p:${p.no}:undo`));
    rows.push(r);
  }
  for (const c of created.clients.slice(0, 12)) {
    const n = topMatches(data.props, c, matchScore, 50).length;
    L.push('', `👥 ${clientLine(c)}`, n ? `   🎯 ${fa(n)} فایل مناسب دارد` : null);
    const r = [btn(`✔️ تأیید #${fa(c.no)}`, `c:${c.no}:rv`), btn('👁 کارت', `c:${c.no}:show`)];
    if (n) r.push(btn(`🎯 ${fa(n)} فایل`, `c:${c.no}:m`));
    r.push(btn('↩️ لغو', `c:${c.no}:undo`));
    rows.push(r);
  }
  L.push('', 'اگر چیزی اشتباه است، «👁 کارت» ← «✏️ ویرایش» را بزنید.');
  return send(L.filter((x) => x != null).join('\n'), { reply_markup: { inline_keyboard: rows } });
}

// ------------------------------------------------------------ buttons
async function onCallback(platform, call, chatId, cq) {
  const ack = (text, alert = false) => call('answerCallbackQuery', { callback_query_id: cq.id, ...(text ? { text, show_alert: alert } : {}) }).catch(() => {});
  let user = await userForChat(platform, chatId);
  if (!user && String(cq.data || '').startsWith('o:')) {
    // Listed notification recipients may manage orders even without a linked account.
    const plat = await loadPlatform();
    const uname = Object.entries(plat.notify?.chats || {}).find(([k, v]) => k.startsWith(platform + ':') && v === chatId && (plat.notify.usernames || []).includes(k.split(':')[1]))?.[0]?.split(':')[1];
    if (uname) user = { id: null, name: '@' + uname, staff: 'notify' };
  }
  if (!user) {
    await ack('حساب شما به این ربات وصل نیست.', true);
    return;
  }
  const chatKey = `${platform}:${chatId}`;
  const msgId = cq.message.message_id;
  const edit = (text, reply_markup) => call('editMessageText', { chat_id: chatId, message_id: msgId, text: String(text).slice(0, 4000), disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) }).catch((e) => {
    if (!/not modified/i.test(e.message)) throw e;
  });
  const send = (text, extra = {}) => call('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true, ...extra });
  const data = String(cq.data || '');

  if (data.startsWith('o:')) return onOrderCallback(user, data, ack, edit, send);
  if (!user.tenantId) return ack('حساب شما به دفتر املاکی متصل نیست.', true);

  // Lists
  let m = data.match(/^L:([pc]):([a-z]):(\d{1,4})$/);
  if (m) {
    const v = listView(m[1], m[2], Number(m[3]), await listAll(user));
    await edit(v.text, v.reply_markup);
    return ack();
  }
  if (data === 'R:0') {
    const v = reviewView(await listAll(user));
    await send(v.text, v.reply_markup ? { reply_markup: v.reply_markup } : {});
    return ack();
  }

  m = data.match(/^([pc]):(\d{1,7}):([a-z]+)$/);
  if (!m) return ack();
  const kind = m[1];
  const no = Number(m[2]);
  const action = m[3];
  const all = await listAll(user);
  const f = findRec(all, kind, no);
  if (!f) return ack('این مورد پیدا نشد یا حذف شده است.', true);
  const rec = f.rec;
  const isP = kind === 'p';
  const card = (r) => (isP ? propCard(r) : clientCard(r));
  const kb = (r) => (isP ? propKb(r) : clientKb(r));
  const upd = (patch) => (isP ? updateProperty(user, rec.id, patch) : updateClient(user, rec.id, patch));
  const label = isP ? `فایل #${fa(no)}` : `مشتری #${fa(no)}`;

  switch (action) {
    case 'show':
      // From a list / search: open a new card. From a delete-confirm: restore the card.
      if (/^(🏠 فایل|👥 مشتری) #/.test(cq.message.text || '')) await edit(card(rec), kb(rec));
      else await send(card(rec), { reply_markup: kb(rec) });
      return ack();
    case 'm': {
      const v = matchesView(kind, rec, all);
      await send(v.text, v.reply_markup ? { reply_markup: v.reply_markup } : {});
      return ack();
    }
    case 'web': {
      const link = await loginLink(user, isP ? `/files/${rec.id}` : `/clients/${rec.id}`);
      await send(`🌐 ${label} در پنل وب\n(لینک یک‌بار مصرف، ۱۰ دقیقه)`, { reply_markup: { inline_keyboard: [[{ text: '🌐 باز کردن', url: link }]] } });
      return ack();
    }
    case 'ed':
      pending.set(chatKey, { mode: 'edit', kind, no, at: Date.now() });
      await send(`✏️ ویرایش ${label}\nتغییر را بنویسید و بفرستید؛ مثلاً:\n${isP ? '«قیمت ۹ و نیم میلیارد» · «۳ خواب، طبقه ۴» · «مالک ۰۹۱۵...» · «یادداشت: کلید دست سرایدار»' : '«بودجه تا ۸ میلیارد» · «حداقل ۲ خواب» · «محله سجاد» · «یادداشت: فقط طبقه بالا»'}`, {
        reply_markup: { force_reply: true, input_field_placeholder: 'تغییر را بنویسید…' },
      });
      return ack();
    case 'del':
      await edit(card(rec) + '\n\n🗑 این مورد حذف شود؟', confirmKb(kind, no));
      return ack();
    case 'delok':
      await (isP ? deleteProperty(user, rec.id) : deleteClient(user, rec.id));
      await edit(`🗑 ${label} حذف شد.`);
      return ack('حذف شد');
    case 'undo': {
      if (!rec.needsReview || Date.now() - rec.createdAt > 24 * 3600_000) return ack('این مورد قبلاً تأیید شده؛ برای حذف از کارت استفاده کنید.', true);
      await (isP ? deleteProperty(user, rec.id) : deleteClient(user, rec.id));
      return ack(`${label} لغو شد`, true);
    }
  }

  // Status / review changes: update and redraw the card in place.
  const patches = isP
    ? { rv: { reviewed: true, needsReview: false }, ok: { confirm: true }, sold: { status: 'sold' }, rented: { status: 'rented' }, wd: { status: 'withdrawn' }, act: { status: 'active', confirm: true } }
    : { rv: { reviewed: true, needsReview: false }, done: { status: 'done' }, pause: { status: 'paused' }, act: { status: 'active' } };
  const patch = patches[action];
  if (!patch) return ack();
  const next = await upd(patch);
  const toast = { rv: 'تأیید شد ✔️', ok: 'موجودی تأیید شد ✅', sold: 'ثبت شد: فروخته شد 💰', rented: 'ثبت شد: اجاره رفت 🔑', wd: 'ثبت شد: منصرف شد', act: 'دوباره فعال شد', done: 'به نتیجه رسید ✅', pause: 'متوقف شد' }[action];
  // Cards get redrawn; list/summary messages (e.g. capture result) just get a toast.
  if (/^(🏠 فایل|👥 مشتری) #/.test(cq.message.text || '')) await edit(card(next), kb(next));
  return ack(toast);
}

// ------------------------------------------------------------ order notifications (platform staff)
const ORDER_FA = { new: '🆕 جدید', scheduled: '📅 زمان‌بندی شد', in_progress: '🚗 در حال انجام', delivered: '📦 تحویل شد', done: '✅ تکمیل', canceled: '❌ لغو شد' };

function orderCard(o) {
  const cat = CATALOG[o.kind];
  const pkg = cat?.packages.find((x) => x.id === o.package);
  const L = [
    `${o.kind === 'inspection' ? '🔍' : '📸'} سفارش ${cat?.title || o.kind} — ${o.code}`,
    `وضعیت: ${ORDER_FA[o.status] || o.status}`,
    '',
    `پکیج: ${pkg?.title || o.package}${o.estimate ? ` (${money(o.estimate)} تومان)` : ''}`,
    o.agency ? `🏢 دفتر: ${o.agency}` : o.source === 'public' ? '🌐 از فرم عمومی سایت (خریدار)' : null,
    `👤 ${[o.contact?.name, o.contact?.phone].filter(Boolean).join(' — ') || '—'}`,
    `📍 ${[o.location?.city, o.location?.neighborhood, o.location?.address].filter(Boolean).join('، ') || '—'}`,
    o.details?.area ? `📐 ${fa(o.details.area)} متر${o.details.propertyType ? ' · ' + o.details.propertyType : ''}` : null,
    o.details?.preferredAt ? `🕓 زمان پیشنهادی: ${o.details.preferredAt}` : null,
    o.details?.notes ? `📝 ${o.details.notes.slice(0, 500)}` : null,
    o.scheduledAt ? `📅 زمان‌بندی: ${o.scheduledAt}` : null,
  ];
  return L.filter((x) => x != null).join('\n');
}

function orderKb(o) {
  const next = { new: ['scheduled', 'canceled'], scheduled: ['in_progress', 'canceled'], in_progress: ['delivered'], delivered: ['done'] }[o.status] || [];
  const rows = [];
  if (next.length) rows.push(next.map((st) => btn(ORDER_FA[st], `o:${o.id}:${st}`)));
  rows.push([btn('🌐 مدیریت در پنل', `o:${o.id}:web`)]);
  return { inline_keyboard: rows };
}

// Everyone who must hear about new orders / signups: platform staff who
// linked a bot, plus the Telegram/Bale usernames listed in the admin panel
// (they become active once that person sends any message to the bot).
async function adminChats() {
  const [users, plat] = await Promise.all([loadUsers(), loadPlatform()]);
  const out = new Map(); // "platform:chatId" -> platform
  for (const u of Object.values(users.users)) {
    if (!u.active || !u.staff) continue;
    if (u.tg?.chatId) out.set(`telegram:${u.tg.chatId}`, 'telegram');
    if (u.bale?.chatId) out.set(`bale:${u.bale.chatId}`, 'bale');
  }
  const wanted = new Set((plat.notify?.usernames || []).map((x) => x.toLowerCase()));
  for (const [k, chatId] of Object.entries(plat.notify?.chats || {})) {
    const [platform, uname] = k.split(':');
    if (wanted.has(uname)) out.set(`${platform}:${chatId}`, platform);
  }
  return { plat, targets: [...out.entries()].map(([k, platform]) => ({ platform, chatId: k.slice(platform.length + 1) })) };
}

export async function notifyAdmins(text, reply_markup) {
  try {
    const { plat, targets } = await adminChats();
    await Promise.all(targets.map(({ platform, chatId }) => {
      const bot = plat.bots?.[platform];
      if (!bot) return null;
      return api(platform, bot.token, 'sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) }).catch((e) => console.error('admin notify', platform, e.message));
    }));
  } catch (e) {
    console.error('admin notify failed', e.message);
  }
}

export const notifyNewOrder = (order) => notifyAdmins('🔔 سفارش جدید\n\n' + orderCard(order), orderKb(order));

// Remember the chat of a listed notification recipient the first time they write.
async function captureNotifyChat(platform, msg, send) {
  const uname = String(msg.from?.username || '').toLowerCase();
  if (!uname) return false;
  const plat = await loadPlatform();
  if (!(plat.notify?.usernames || []).includes(uname)) return false;
  const key = `${platform}:${uname}`;
  if (plat.notify.chats?.[key] === String(msg.chat.id)) return false;
  await mutatePlatform((p) => {
    p.notify ||= { usernames: [], chats: {} };
    p.notify.chats ||= {};
    p.notify.chats[key] = String(msg.chat.id);
  });
  await send(`✅ اعلان‌های پلاک‌نگار برای شما فعال شد.\nاز این به بعد هر سفارش عکاسی، تولید محتوا یا بازدید فنی و هر ثبت‌نام املاکی جدید همین‌جا برایتان ارسال می‌شود.`);
  return true;
}

export async function setNotifyUsernames(list) {
  const clean = [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,،]+/)).map((x) => String(x).trim().replace(/^@/, '').toLowerCase()).filter((x) => /^[a-z0-9_]{4,40}$/.test(x)))].slice(0, 10);
  await mutatePlatform((p) => {
    p.notify ||= { usernames: [], chats: {} };
    p.notify.usernames = clean;
  });
  return notifyStatus();
}

export async function notifyStatus() {
  const p = await loadPlatform({ maxAge: 0 });
  const chats = p.notify?.chats || {};
  return (p.notify?.usernames || []).map((u) => ({ username: u, telegram: Boolean(chats['telegram:' + u]), bale: Boolean(chats['bale:' + u]) }));
}

async function onOrderCallback(user, data, ack, edit, send) {
  const m = data.match(/^o:([A-Za-z0-9_-]{3,40}):([a-z_]+)$/);
  if (!m) return ack();
  if (!user.staff) return ack('فقط مدیران پلتفرم به سفارش‌ها دسترسی دارند.', true);
  const [, oid, action] = m;
  if (action === 'web') {
    if (!user.id) {
      await send(`🌐 پنل مدیریت: ${config.appUrl}/#/admin`);
      return ack();
    }
    const link = await loginLink(user, '/admin');
    await send('🌐 پنل مدیریت سفارش‌ها (لینک یک‌بار مصرف، ۱۰ دقیقه)', { reply_markup: { inline_keyboard: [[{ text: '🌐 باز کردن', url: link }]] } });
    return ack();
  }
  if (!ORDER_FA[action]) return ack();
  let order = null;
  await mutatePlatform((p) => {
    const o = p.orders?.[oid];
    if (!o) return NO_WRITE;
    if (o.status === action) {
      order = o;
      return NO_WRITE;
    }
    o.status = action;
    o.history = [...(o.history || []), { at: Date.now(), status: action, by: user.name, note: 'از ربات' }];
    o.updatedAt = Date.now();
    order = o;
  });
  if (!order) return ack('سفارش پیدا نشد.', true);
  await edit('🔔 سفارش\n\n' + orderCard(order), orderKb(order));
  return ack(`وضعیت: ${ORDER_FA[order.status]}`);
}

// ------------------------------------------------------------ staff menu
const SK = { open: '📦 سفارش‌های باز', agencies: '🏢 املاکی‌ها', app: K.app };
const STAFF_KB = { keyboard: [[{ text: SK.open }, { text: SK.agencies }], [{ text: SK.app }]], resize_keyboard: true, is_persistent: true };

async function staffMessage(user, text, send) {
  const plat = await loadPlatform({ maxAge: 2000 });
  if (text === SK.open || text === '/orders') {
    const open = Object.values(plat.orders || {}).filter((o) => !['done', 'canceled'].includes(o.status)).sort((a, b) => b.createdAt - a.createdAt);
    if (!open.length) return send('📦 سفارش بازی نیست 👌', { reply_markup: STAFF_KB });
    await send(`📦 ${fa(open.length)} سفارش باز${open.length > 8 ? ' (۸ مورد آخر)' : ''}:`, { reply_markup: STAFF_KB });
    for (const o of open.slice(0, 8)) await send(orderCard(o), { reply_markup: orderKb(o) });
    return;
  }
  if (text === SK.agencies || text === '/agencies') {
    const users = await loadUsers();
    const list = Object.values(plat.tenants || {}).sort((a, b) => b.createdAt - a.createdAt);
    const owner = (tid) => Object.values(users.users).find((u) => u.tenantId === tid && u.role === 'owner');
    const L = [`🏢 ${fa(list.length)} املاکی:`, ''];
    for (const t of list.slice(0, 30)) {
      const o = owner(t.id);
      L.push(`${t.active === false ? '⛔' : '🟢'} ${t.name}${t.demo ? ' (دمو)' : ''} — ${o ? o.name + (o.phone ? ' ' + o.phone : '') : ''} · ${ago(t.createdAt)}${t.selfSignup ? ' · ثبت‌نام آنلاین' : ''}`);
    }
    return send(L.join('\n'), { reply_markup: STAFF_KB });
  }
  return send(`سلام ${user.name} 👋\nاین حساب مدیریت پلتفرم است. سفارش‌ها و ثبت‌نام‌های جدید خودکار اینجا اعلام می‌شوند.`, { reply_markup: STAFF_KB });
}
