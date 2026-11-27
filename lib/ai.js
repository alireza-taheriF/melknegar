// Turning free text, voice notes and ledger photos into structured records.
// Uses Vercel AI Gateway when a key is configured; otherwise a rule-based
// Persian parser handles typed text (voice/photo then need the key).
import { config } from './config.js';
import { toEnDigits, normText } from './util.js';
import { cleanProperty, cleanClient, FEATURES, TYPES, DEALS } from './domain.js';

// Auth: an explicit AI Gateway key, or the deployment's Vercel OIDC token
// (available on Vercel without any key; refreshed per request).
let oidcToken = '';
export function setOidcToken(t) {
  if (t) oidcToken = t;
}
const aiToken = () => config.aiKey || oidcToken || process.env.VERCEL_OIDC_TOKEN || '';
export const aiEnabled = () => Boolean(aiToken()) && process.env.AI_DISABLED !== '1';

const SYSTEM = `You convert notes written by Iranian real-estate agents (Persian, informal, often abbreviated) into JSON records.
Return ONLY a JSON object, no markdown: {"transcript": string, "items": [ ... ]}.
"transcript": for audio, the verbatim Persian transcript; for an image, a short Persian summary of what the page contains; for text, an empty string.
Each item is either a property listing (فایل) or a client request (مشتری/خریدار/مستاجر):
- property: {"kind":"property","deal":"sale|rent|presale","type":"apartment|villa|land|commercial|office|garden|other","neighborhood":string,"address":string,"area":int m2,"landArea":int m2,"rooms":int,"floor":int,"totalFloors":int,"buildYear":int (Persian solar year, e.g. 1398; convert "۵ ساله" to current year 1405 minus 5),"price":int toman,"deposit":int toman,"rent":int toman per month,"features":[${FEATURES.map((f) => `"${f}"`).join(',')}],"ownerName":string,"ownerPhone":string,"status":"active|sold|rented","notes":string}
- client: {"kind":"client","name":string,"phone":string,"deal":"sale|rent|presale","types":[...],"budgetMin":int,"budgetMax":int,"depositMax":int,"rentMax":int,"areaMin":int,"areaMax":int,"roomsMin":int,"neighborhoods":[string],"features":[...],"notes":string}
Rules: money is in toman (تومان). میلیارد=1000000000, میلیون=1000000, هزار=1000; "۸ و ۵۰۰" with میلیارد means 8.5 billion. If the amount is in ریال divide by 10.
رهن/ودیعه -> deposit, اجاره/کرایه -> rent (deal "rent"). پیش‌فروش -> presale. Crossed-out or "فروخته شد" entries -> status "sold".
Omit any field you do not know. Never invent numbers or phone numbers. Keep Persian text in Persian. One item per distinct listing or request; a ledger page usually holds several.`;

function dataUrl(buf, mime) {
  return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
}

async function callGateway(content, { timeoutMs = 45000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.aiBase}/responses`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${aiToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.aiModel,
        instructions: SYSTEM,
        input: [{ role: 'user', content }],
        temperature: 0.1,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) throw new Error('ai gateway ' + res.status + ' ' + JSON.stringify(json?.error || '').slice(0, 300));
    let text = json.output_text || '';
    if (!text && Array.isArray(json.output)) {
      for (const o of json.output) for (const c of o.content || []) if (c.type === 'output_text') text += c.text;
    }
    return parseJsonLoose(text);
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonLoose(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < start) return { transcript: '', items: [] };
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return { transcript: '', items: [] };
  }
}

function normalizeItems(out) {
  const items = Array.isArray(out?.items) ? out.items.slice(0, 40) : [];
  return {
    transcript: normText(out?.transcript || '', 4000),
    items: items
      .map((it) => {
        if (!it || typeof it !== 'object') return null;
        if (it.kind === 'client') return { kind: 'client', data: cleanClient({ ...it }) };
        return { kind: 'property', data: cleanProperty({ ...it }) };
      })
      .filter(Boolean),
  };
}

export async function extractFromText(text) {
  const clean = normText(text, 6000);
  if (!clean) return { transcript: '', items: [], engine: 'none' };
  if (aiEnabled()) {
    try {
      const out = await callGateway([{ type: 'input_text', text: clean }], { timeoutMs: 25000 });
      const r = normalizeItems(out);
      if (r.items.length) return { ...r, engine: 'ai' };
    } catch (e) {
      console.error('ai text failed', e.message);
    }
  }
  return { transcript: '', items: [heuristicParse(clean)], engine: 'rules' };
}

export async function extractFromAudio(buf, mime = 'audio/ogg') {
  if (!aiEnabled()) throw new Error('ai_disabled');
  const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('mpeg') ? 'mp3' : 'ogg';
  const out = await callGateway([
    { type: 'input_text', text: 'این یک پیام صوتی از مشاور املاک است. متن کامل را بنویس و رکوردها را استخراج کن.' },
    { type: 'input_file', filename: `voice.${ext}`, file_data: dataUrl(buf, mime) },
  ]);
  return { ...normalizeItems(out), engine: 'ai' };
}

export async function extractFromImage(buf, mime = 'image/jpeg') {
  if (!aiEnabled()) throw new Error('ai_disabled');
  const out = await callGateway([
    { type: 'input_text', text: 'این عکس یک صفحه از دفتر یادداشت دست‌نویس یک بنگاه املاک است. تمام فایل‌ها و درخواست‌های مشتری را جداگانه استخراج کن.' },
    { type: 'input_image', image_url: dataUrl(buf, mime), detail: 'high' },
  ], { timeoutMs: 55000 });
  return { ...normalizeItems(out), engine: 'ai' };
}

// ------------------------------------------------------------ rule-based
const UNIT = { میلیارد: 1e9, میلیون: 1e6, هزار: 1e3, تومن: 1, تومان: 1 };

export function parseAmount(seg) {
  const s = toEnDigits(seg).replace(/٫/g, '.').replace(/[,٬،]/g, '');
  // e.g. "8 میلیارد و 500", "8.5 میلیارد", "8 میلیارد 500 میلیون", "950 میلیون"
  const re = /(\d+(?:\.\d+)?)\s*(میلیارد|میلیون|هزار)?/g;
  let total = 0;
  let lastUnit = null;
  let m;
  let any = false;
  while ((m = re.exec(s))) {
    const n = parseFloat(m[1]);
    let unit = m[2] ? UNIT[m[2]] : null;
    if (!unit) {
      if (lastUnit === 1e9) unit = n < 1000 ? 1e6 : 1; // "8 میلیارد و 500" -> 500 million
      else if (lastUnit === 1e6) unit = n < 1000 ? 1e3 : 1;
      else unit = n >= 1e5 ? 1 : 1e6; // bare small number: assume million
    }
    total += n * unit;
    lastUnit = unit;
    any = true;
  }
  return any ? Math.round(total) : null;
}

const TYPE_WORDS = [
  ['villa', /ویلا|ویلایی|خانه\s*حیاط|دربست/],
  ['land', /زمین|قطعه/],
  ['commercial', /مغازه|تجاری|دکان/],
  ['office', /اداری|دفتر\s*کار/],
  ['garden', /باغ/],
  ['apartment', /آپارتمان|اپارتمان|واحد|طبقه/],
];
const FEATURE_WORDS = [
  ['parking', /پارکینگ/], ['elevator', /آسانسور|اسانسور/], ['storage', /انباری/], ['balcony', /بالکن|تراس/],
  ['lobby', /لابی|سرایدار/], ['pool', /استخر/], ['gym', /سونا|جکوزی|باشگاه/], ['renovated', /بازسازی|نوساز/],
  ['single_unit', /تک\s*واحد/], ['yard', /حیاط/], ['furnished', /مبله|مبلمان/], ['document', /سند\s*(تک\s*برگ|دار|شش\s*دانگ)/],
];
export const MASHHAD_HOODS = ['الهیه', 'سرافرازان', 'خیام', 'فرامرز', 'امامت', 'سجاد', 'هاشمیه', 'وکیل‌آباد', 'احمدآباد', 'کوهسنگی', 'ملک‌آباد', 'قاسم‌آباد', 'آزادشهر', 'هفت تیر', 'پیروزی', 'دانشجو', 'فلسطین', 'رضاشهر', 'طلاب', 'مطهری', 'شریعتی', 'جلال آل احمد', 'ستاری', 'معلم', 'هنرستان', 'کلاهدوز', 'پاستور', 'صیاد شیرازی', 'الندشت', 'ابوطالب', 'راهنمایی', 'آبکوه', 'بهار', 'میدان شهدا', 'سناباد', 'دانش‌آموز', 'شاهد', 'نماز', 'حجاب', 'بلوار توس', 'عبدالمطلب', 'پنجتن', 'مهرآباد', 'بهشتی', 'هدایت', 'کوثر', 'شهرک غرب', 'نوفل لوشاتو', 'ابن سینا', 'سعدی', 'هاشمی‌نژاد', 'امام رضا', 'کاشانی', 'چمران', 'ملاصدرا', 'دلاوران', 'شفا', 'فرهنگ', 'پیامبر اعظم', 'شاندیز', 'طرقبه'];

export function heuristicParse(text) {
  const raw = normText(text, 6000);
  const phone = (toEnDigits(raw).match(/09\d{9}/) || [])[0] || '';
  // Remove phone numbers so their digits are never read as prices or areas.
  const t = toEnDigits(raw).replace(/(?:\+98|0)?9\d{9}|0\d{10}/g, ' ');
  const isClient = /(مشتری|خریدار|متقاضی|مستاجر|دنبال|می\s*خواد|میخواد|میخواهد|نیاز\s*دار|بودجه)/.test(t);
  const num = (re) => {
    const m = t.match(re);
    return m ? Number(m[1]) : null;
  };
  const area = num(/(\d{2,6})\s*(?:متر|متری|مترمربع)/);
  const rooms = num(/(\d)\s*(?:خواب|خوابه)/) ?? (/(یک|1)\s*خواب/.test(t) ? 1 : /دو\s*خواب/.test(t) ? 2 : /سه\s*خواب/.test(t) ? 3 : /چهار\s*خواب/.test(t) ? 4 : null);
  const floor = num(/طبقه\s*(\d{1,3})/) ?? (/همکف/.test(t) ? 0 : null);
  const totalFloors = num(/(\d{1,3})\s*طبقه(?!\s*\d)/);
  let buildYear = num(/(?:سال\s*ساخت|ساخت)\s*(1[34]\d{2})/);
  const age = num(/(\d{1,2})\s*ساله/);
  if (!buildYear && age != null) buildYear = 1405 - age;
  if (!buildYear && /نوساز|کلید\s*نخورده/.test(t)) buildYear = 1405;
  let type = null;
  for (const [k, re] of TYPE_WORDS) if (re.test(t)) { type = k; break; }
  const features = FEATURE_WORDS.filter(([, re]) => re.test(t)).map(([k]) => k);
  const deal = /پیش\s*فروش/.test(t) ? 'presale' : /رهن|اجاره|ودیعه|کرایه|مستاجر/.test(t) ? 'rent' : 'sale';
  const amountAfter = (re) => {
    const m = t.match(re);
    return m ? parseAmount(m[1]) : null;
  };
  const AMT = '((?:\\d{1,6}(?:\\.\\d+)?\\s*(?:میلیارد|میلیون|هزار)?\\s*(?:و\\s*)?){1,3})';
  const deposit = deal === 'rent' ? amountAfter(new RegExp('(?:رهن|ودیعه)\\s*(?:کامل)?\\s*' + AMT)) : null;
  const rent = deal === 'rent' ? amountAfter(new RegExp('(?:اجاره|کرایه)\\s*(?:ماهیانه|ماهانه)?\\s*' + AMT)) : null;
  let price = null;
  if (deal !== 'rent') {
    price = amountAfter(new RegExp('(?:قیمت|کل|فی|مبلغ|بودجه|تا)\\s*:?\\s*' + AMT));
    if (price == null) {
      const m = t.match(/(\d+(?:\.\d+)?\s*میلیارد(?:\s*و?\s*\d+\s*(?:میلیون)?)?|\d+\s*میلیون)/);
      if (m) price = parseAmount(m[1]);
    }
  }
  const neighborhood = MASHHAD_HOODS.find((h) => raw.replace(/‌/g, ' ').includes(h.replace(/‌/g, ' '))) || (raw.match(/(?:محله|خیابان|بلوار|منطقه)\s+([^\s،,.]+(?:\s[^\s،,.]+)?)/) || [])[1] || '';
  const name = (raw.match(/(?:آقای|خانم|اقای)\s+([^\s،,.\d]+)/) || [])[1] || '';

  if (isClient) {
    return {
      kind: 'client',
      data: cleanClient({
        name: name ? (/(خانم)/.test(raw) ? 'خانم ' : 'آقای ') + name : '',
        phone,
        deal,
        types: type ? [type] : [],
        budgetMax: deal === 'rent' ? null : price,
        depositMax: deposit,
        rentMax: rent,
        areaMin: area ? Math.round(area * 0.85) : null,
        areaMax: area ? Math.round(area * 1.2) : null,
        roomsMin: rooms,
        neighborhoods: neighborhood ? [neighborhood] : [],
        features,
        notes: raw,
        needsReview: true,
      }),
    };
  }
  return {
    kind: 'property',
    data: cleanProperty({
      deal,
      type: type || 'apartment',
      neighborhood,
      area,
      rooms,
      floor,
      totalFloors: totalFloors && totalFloors !== floor ? totalFloors : null,
      buildYear,
      price,
      deposit,
      rent,
      features,
      ownerName: name ? (/(خانم)/.test(raw) ? 'خانم ' : 'آقای ') + name : '',
      ownerPhone: phone,
      notes: raw,
      needsReview: true,
    }),
  };
}

export { TYPES, DEALS };
