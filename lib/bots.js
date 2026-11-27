// Telegram and Bale bots: link an account, send listings by text/voice/photo,
// search the ledger and get a one-time login link to the app.
import { config } from './config.js';
import { loadPlatform, mutatePlatform, loadUsers, mutateUsers, loadTenant } from './data.js';
import { randomToken, sha256 } from './crypto.js';
import { createMagicLink } from './auth.js';
import { extractFromText, extractFromAudio, extractFromImage, aiEnabled } from './ai.js';
import { createRecords } from './agency.js';
import { NO_WRITE } from './store.js';
import { safeEqual, toEnDigits } from './util.js';

export const PLATFORMS = {
  telegram: { name: 'تلگرام', api: 'https://api.telegram.org', link: (u, p) => `https://t.me/${u}?start=${p}` },
  bale: { name: 'بله', api: 'https://tapi.bale.ai', link: (u, p) => `https://ble.ir/${u}?start=${p}` },
};

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
export async function connectBot(platform, token) {
  if (!PLATFORMS[platform]) throw new Error('platform');
  if (!/^\d{4,15}:[A-Za-z0-9_-]{20,80}$/.test(token)) throw new Error('توکن ربات معتبر نیست');
  const me = await api(platform, token, 'getMe');
  const secret = randomToken(24);
  const url = `${config.appUrl}/api/bot/${platform}/${secret}`;
  try {
    await api(platform, token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true });
  } catch (e) {
    if (platform !== 'bale') throw e;
    await api(platform, token, 'setWebhook', { url }); // Bale may not accept the extra fields
  }
  await mutatePlatform((p) => {
    p.bots[platform] = { token, username: me.username, secret, connectedAt: Date.now() };
  });
  return { username: me.username };
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

// ------------------------------------------------------------ update handling
const seen = new Map(); // dedupe retried updates per instance

const HELP = `راهنمای ربات ملک‌نگار:
• هر فایل یا درخواست مشتری را به صورت متن بفرستید؛ مثلاً:
«الهیه، ۱۲۰ متر، ۳ خواب، طبقه ۲، پارکینگ و انباری، ۹ میلیارد، آقای رضایی ۰۹۱۵...»
• پیام صوتی بفرستید؛ متنش نوشته و فایل ثبت می‌شود.
• از صفحه دفتر دست‌نویس عکس بگیرید؛ همه فایل‌های آن صفحه استخراج می‌شود.
• /find الهیه ۳ خواب — جستجو در فایل‌ها
• /login — لینک ورود یک‌بار مصرف به اپ
همه موارد ثبت‌شده از ربات در اپ با برچسب «نیاز به بررسی» می‌آیند تا تأییدشان کنید.`;

function fmtMoney(n) {
  if (!n) return '';
  if (n >= 1e9) return `${+(n / 1e9).toFixed(2)} میلیارد`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} میلیون`;
  return n.toLocaleString('fa-IR');
}

const TYPE_FA = { apartment: 'آپارتمان', villa: 'ویلایی', land: 'زمین', commercial: 'تجاری', office: 'اداری', garden: 'باغ', other: 'سایر' };
const DEAL_FA = { sale: 'فروش', rent: 'رهن و اجاره', presale: 'پیش‌فروش' };

function describeProperty(p) {
  const parts = [`#${p.no}`, DEAL_FA[p.deal], TYPE_FA[p.type], p.neighborhood, p.area && `${p.area} متر`, p.rooms != null && `${p.rooms} خواب`];
  if (p.deal === 'rent') parts.push(p.deposit && `رهن ${fmtMoney(p.deposit)}`, p.rent && `اجاره ${fmtMoney(p.rent)}`);
  else parts.push(p.price && fmtMoney(p.price));
  return parts.filter(Boolean).join('، ');
}

function describeClient(c) {
  return [`#${c.no}`, 'مشتری', c.name, DEAL_FA[c.deal], c.budgetMax && `تا ${fmtMoney(c.budgetMax)}`, c.neighborhoods?.join('، ')].filter(Boolean).join('، ');
}

export async function handleUpdate(platform, pathSecret, headerSecret, update) {
  const p = await loadPlatform();
  const bot = p.bots?.[platform];
  if (!bot || !safeEqual(pathSecret, bot.secret)) return { status: 404 };
  if (headerSecret && !safeEqual(headerSecret, bot.secret)) return { status: 401 };

  const key = `${platform}:${update?.update_id}`;
  if (seen.has(key)) return { status: 200 };
  seen.set(key, Date.now());
  if (seen.size > 2000) seen.delete(seen.keys().next().value);

  const msg = update?.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private') return { status: 200 };
  const chatId = String(msg.chat.id);
  const reply = (text, extra = {}) => api(platform, bot.token, 'sendMessage', { chat_id: msg.chat.id, text, disable_web_page_preview: true, ...extra }).catch((e) => console.error(e.message));

  try {
    await onMessage(platform, bot, chatId, msg, reply);
  } catch (e) {
    console.error('bot error', e);
    await reply('متأسفانه خطایی پیش آمد. دوباره امتحان کنید یا از داخل اپ ثبت کنید.');
  }
  return { status: 200 };
}

async function onMessage(platform, bot, chatId, msg, reply) {
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
    if (!linked) return reply('این لینک اتصال منقضی شده یا نامعتبر است. از داخل اپ (تنظیمات ← اتصال ربات) لینک جدید بگیرید.');
    return reply(`سلام ${linked.name} 👋\nحساب شما به ربات ملک‌نگار وصل شد.\n\n${HELP}`);
  }

  const users = await loadUsers();
  const uid = users.byChat[chatKey];
  const user = uid ? users.users[uid] : null;
  if (!user || !user.active) {
    return reply('سلام! این ربات ملک‌نگار است.\nبرای استفاده، وارد اپ شوید و از «تنظیمات ← اتصال ربات» دکمه اتصال را بزنید.' + (config.appUrl ? `\n${config.appUrl}` : ''));
  }

  if (/^\/(start|help)$|^راهنما$/.test(text)) return reply(HELP);

  if (/^\/login$|^ورود$/.test(text)) {
    const link = await createMagicLink(user.id);
    return reply(`لینک ورود شما (۱۰ دقیقه اعتبار، یک‌بار مصرف):\n${link}\n\nاین لینک را برای کسی نفرستید.`);
  }

  if (!user.tenantId) return reply('حساب شما به دفتر املاکی متصل نیست.');

  const findMatch = text.match(/^\/find\s+(.+)$|^جستجو\s+(.+)$/);
  if (findMatch) {
    const q = toEnDigits(findMatch[1] || findMatch[2]).trim();
    const t = await loadTenant(user.tenantId);
    const words = q.split(/\s+/).filter(Boolean);
    const hits = Object.values(t.properties)
      .filter((pr) => !pr.deleted && pr.status === 'active')
      .filter((pr) => {
        const hay = toEnDigits([describeProperty(pr), pr.address, pr.notes, pr.rooms != null ? `${pr.rooms} خواب` : ''].join(' '));
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8);
    if (!hits.length) return reply('فایلی با این مشخصات پیدا نشد.');
    return reply('نتایج:\n' + hits.map((h) => '• ' + describeProperty(h)).join('\n'));
  }

  let result;
  if (msg.voice || msg.audio) {
    if (!aiEnabled()) return reply('پردازش صدا فعلاً فعال نیست. لطفاً متن بفرستید.');
    await reply('🎙️ پیام صوتی دریافت شد؛ در حال تبدیل به فایل...');
    const media = msg.voice || msg.audio;
    if ((media.duration || 0) > 300) return reply('پیام صوتی باید کمتر از ۵ دقیقه باشد.');
    const buf = await download(platform, bot.token, media.file_id);
    result = await extractFromAudio(buf, media.mime_type || 'audio/ogg');
  } else if (msg.photo?.length || (msg.document && /^image\//.test(msg.document.mime_type || ''))) {
    if (!aiEnabled()) return reply('خواندن عکس فعلاً فعال نیست. لطفاً متن بفرستید.');
    await reply('📄 عکس دریافت شد؛ در حال خواندن صفحه دفتر...');
    const ph = msg.photo?.length ? msg.photo[msg.photo.length - 1] : msg.document;
    const buf = await download(platform, bot.token, ph.file_id);
    result = await extractFromImage(buf, msg.document?.mime_type || 'image/jpeg');
  } else if (text && !text.startsWith('/')) {
    result = await extractFromText(text);
  } else {
    return reply(HELP);
  }

  if (!result.items.length) return reply('چیزی برای ثبت پیدا نکردم. مشخصات فایل (محله، متراژ، قیمت...) را بنویسید.');
  const items = result.items.map((it) => ({ ...it, data: { ...it.data, needsReview: true } }));
  const created = await createRecords(user, items, platform);
  const lines = [...created.properties.map(describeProperty), ...created.clients.map(describeClient)];
  let out = `✅ ${lines.length} مورد ثبت شد (در اپ با برچسب «نیاز به بررسی»):\n` + lines.map((l) => '• ' + l).join('\n');
  if (result.transcript && (msg.voice || msg.audio)) out = `متن پیام: «${result.transcript.slice(0, 600)}»\n\n` + out;
  return reply(out.slice(0, 3900));
}
