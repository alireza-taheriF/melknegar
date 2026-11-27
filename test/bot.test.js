// In-process test of the Telegram/Bale bot with a fake messenger API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mnbot-'));
process.env.MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.APP_URL = 'https://app.test';
process.env.AI_DISABLED = '1';
process.env.SEED_DATA = execFileSync('node', ['scripts/make_seed.js', JSON.stringify({ tenant: { name: 'املاک تست' }, demo: true, users: [
  { name: 'علی', username: 'ali', phone: '09358595056', staff: 'superadmin', role: 'owner', password: 'Sup3r-secret-pw' },
] })]).toString();

// Fake messenger: records every call, answers like the Bot API.
const calls = [];
let msgId = 100;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const m = String(url).match(/\/bot[^/]+\/(\w+)$/);
  if (!m) return realFetch(url, opts);
  const body = JSON.parse(opts?.body || '{}');
  calls.push({ method: m[1], body });
  const result = m[1] === 'getMe' ? { username: 'pelak_test_bot' } : m[1] === 'sendMessage' ? { message_id: ++msgId } : true;
  return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
};

const { ensureSeeded } = await import('../lib/seed.js');
const bots = await import('../lib/bots.js');
const { loadPlatform, loadUsers } = await import('../lib/data.js');
await ensureSeeded();

const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let upd = 1;
const CHAT = 5550001;
async function secret() {
  return (await loadPlatform({ maxAge: 0 })).bots.telegram.secret;
}
async function say(text, extra = {}) {
  calls.length = 0;
  await bots.handleUpdate('telegram', await secret(), await secret(), { update_id: upd++, message: { message_id: ++msgId, chat: { id: CHAT, type: 'private' }, text, ...extra } });
  return calls.filter((c) => c.method === 'sendMessage').map((c) => c.body);
}
async function tap(data, messageText = '') {
  calls.length = 0;
  await bots.handleUpdate('telegram', await secret(), await secret(), { update_id: upd++, callback_query: { id: 'cq' + upd, data, message: { message_id: 77, text: messageText, chat: { id: CHAT, type: 'private' } } } });
  return calls;
}
const buttons = (m) => (m.reply_markup?.inline_keyboard || []).flat().map((b) => b.callback_data || b.url);

test('bot: link, menu, capture, card actions, edit, search, lists', async () => {
  await bots.connectBot('telegram', TOKEN);
  const wh = calls.find((c) => c.method === 'setWebhook');
  assert.deepEqual(wh.body.allowed_updates, ['message', 'callback_query']);
  assert.ok(calls.some((c) => c.method === 'setMyCommands'));

  // Unlinked chat is refused
  let out = await say('/files');
  assert.match(out[0].text, /اتصال ربات/);

  // Link the chat
  const users = await loadUsers({ maxAge: 0 });
  const ali = Object.values(users.users).find((u) => u.username === 'ali');
  const { token } = await bots.createLinkToken(ali.id);
  out = await say('/start ' + token);
  assert.match(out[0].text, /وصل شد/);
  assert.ok(out[0].reply_markup.keyboard, 'main keyboard shown');

  // Menu buttons
  out = await say('📊 خلاصه دفتر');
  assert.match(out[0].text, /خلاصه املاک تست/);
  assert.match(out[0].text, /فایل فعال/);
  out = await say('🏠 فایل‌ها');
  assert.match(out[0].text, /فایل‌ها — فعال/);
  assert.ok(buttons(out[0]).some((b) => /^p:\d+:show$/.test(b)));
  out = await say('⏰ پیگیری فایل‌ها');
  assert.match(out[0].text, /پیگیری/);

  // Capture a new file by text (rules parser; AI disabled)
  out = await say('فروش آپارتمان الهیه ۱۲۰ متر ۳ خواب طبقه ۲ پارکینگ قیمت ۹ میلیارد آقای رضایی ۰۹۱۵۱۲۳۴۵۶۷');
  assert.match(out[0].text, /ثبت شد/);
  const b = buttons(out[0]);
  const no = Number(b.find((x) => /^p:\d+:rv$/.test(x)).split(':')[1]);
  assert.ok(b.includes(`p:${no}:undo`));

  // Open the card by number (Persian digits)
  out = await say('#' + no.toLocaleString('fa-IR'));
  assert.match(out[0].text, new RegExp(`فایل #${no.toLocaleString('fa-IR')}`));
  assert.match(out[0].text, /نیاز|بررسی/);
  const cardText = out[0].text;

  // Approve from the card: card is redrawn in place without the warning
  let c = await tap(`p:${no}:rv`, cardText);
  const ed = c.find((x) => x.method === 'editMessageText');
  assert.ok(ed && !/بررسی و تأیید/.test(ed.body.text));
  assert.ok(c.some((x) => x.method === 'answerCallbackQuery'));

  // Edit by replying to the edit prompt
  c = await tap(`p:${no}:ed`, cardText);
  const prompt = c.find((x) => x.method === 'sendMessage').body.text;
  assert.match(prompt, /^✏️ ویرایش فایل/);
  out = await say('قیمت ۸ میلیارد و ۵۰۰', { reply_to_message: { text: prompt } });
  assert.match(out[0].text, /ذخیره شد/);
  assert.match(out[0].text, /۸٫۵ میلیارد|8.5|۸.۵/);

  // Inline edit syntax
  out = await say(`ویرایش #${no} طبقه ۴`);
  assert.match(out[0].text, /طبقه ۴/);

  // Mark sold
  c = await tap(`p:${no}:sold`, '🏠 فایل #' + no.toLocaleString('fa-IR'));
  assert.match(c.find((x) => x.method === 'editMessageText').body.text, /فروخته شد/);

  // Search
  out = await say('جستجو رضایی');
  assert.match(out[0].text, /نتایج/);
  assert.ok(buttons(out[0]).includes(`p:${no}:show`));
  out = await say('🔎 جستجو');
  out = await say('الهیه', { reply_to_message: { text: out[0].text } });
  assert.match(out[0].text, /نتایج|پیدا نشد/);

  // List paging / filters via callbacks
  c = await tap('L:p:c:0', '🏠 فایل‌ها — فعال');
  assert.match(c.find((x) => x.method === 'editMessageText').body.text, /بسته‌شده/);

  // Client capture + matches
  out = await say('مشتری خرید آپارتمان الهیه تا ۱۰ میلیارد ۲ خواب آقای کریمی ۰۹۱۲۱۱۱۲۲۳۳');
  assert.match(out[0].text, /ثبت شد/);
  const cb = buttons(out[0]).find((x) => /^c:\d+:rv$/.test(x));
  assert.ok(cb, 'client captured');
  const cno = cb.split(':')[1];
  c = await tap(`c:${cno}:m`, out[0].text);
  assert.ok(c.find((x) => x.method === 'sendMessage'));

  // Undo a fresh capture
  c = await tap(`c:${cno}:undo`, out[0].text);
  assert.match(c.find((x) => x.method === 'answerCallbackQuery').body.text, /لغو/);
  out = await say('#' + cno);
  assert.match(out[0].text, /پیدا نشد/);

  // Login link deep-links into the card page
  c = await tap(`p:${no}:web`, '');
  const url = buttons(c.find((x) => x.method === 'sendMessage').body)[0];
  assert.match(url, /^https:\/\/app\.test\/api\/auth\/magic\?uid=.+&next=%2Ffiles%2Fp_/);

  // Delete with confirmation
  c = await tap(`p:${no}:del`, '🏠 فایل #' + no);
  assert.ok(buttons(c.find((x) => x.method === 'editMessageText').body).includes(`p:${no}:delok`));
  c = await tap(`p:${no}:delok`, '🏠 فایل #' + no);
  assert.match(c.find((x) => x.method === 'editMessageText').body.text, /حذف شد/);

  // Another chat cannot act on this agency's records
  calls.length = 0;
  await bots.handleUpdate('telegram', await secret(), await secret(), { update_id: upd++, callback_query: { id: 'x', data: 'p:101:sold', message: { message_id: 1, text: '', chat: { id: 999, type: 'private' } } } });
  assert.match(calls.find((x) => x.method === 'answerCallbackQuery').body.text, /وصل نیست/);
  assert.ok(!calls.some((x) => x.method === 'editMessageText'));

  // Wrong webhook secret is rejected
  const r = await bots.handleUpdate('telegram', 'wrong', 'wrong', { update_id: upd++, message: { chat: { id: CHAT, type: 'private' }, text: '/files' } });
  assert.equal(r.status, 404);
});
