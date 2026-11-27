// Core helpers: safe DOM building, icons, API client, formatting, toasts, dialogs.
// All user data reaches the DOM through text nodes only (no innerHTML).

export function h(tag, props, ...children) {
  const el = tag === 'svg' || props?.svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), sv);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = Boolean(v);
      else if (k === 'svg') continue;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ---- icons (24px stroke icons, drawn from static path data) ----
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  users: 'M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  plus: 'M12 5v14M5 12h14',
  spark: 'M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5 16l.6 1.4L7 18l-1.4.6L5 20l-.6-1.4L3 18l1.4-.6z',
  camera: 'M4 8a2 2 0 0 1 2-2h1.5l1.5-2h6l1.5 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
  video: 'M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 10l5-3v10l-5-3',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2',
  copy: 'M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6M8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M19 11a7 7 0 0 1-14 0M12 18v3',
  stop: 'M7 7h10v10H7z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  back: 'M9 6l6 6-6 6',
  chevron: 'M15 6l-6 6 6 6',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h3a1 1 0 0 1 1 1v11M2 21h20M8 7h4M8 11h4M8 15h4',
  villa: 'M3 11 12 4l9 7M5 10v10h14V10M10 20v-5h4v5',
  land: 'M3 17l5-9 4 6 3-4 6 7zM3 20h18',
  shop: 'M4 9l1.5-5h13L20 9M4 9h16v11H4zM4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-5h4v5',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  bed: 'M3 18V7M3 13h18v5M21 13v-2a3 3 0 0 0-3-3h-7v5M7 11a1.5 1.5 0 1 0 0-.1',
  ruler: 'M4 15.5 15.5 4 20 8.5 8.5 20zM8 12l2 2M11 9l2 2M14 6l2 2',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 8h.01',
  bot: 'M12 4V2M5 9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM9 12h.01M15 12h.01M2 11v3M22 11v3',
  send: 'M21 3 10 14M21 3l-7 18-4-7-7-4z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  refresh: 'M20 11A8 8 0 0 0 5.3 6.7L3 9M3 4v5h5M4 13a8 8 0 0 0 14.7 4.3L21 15M21 20v-5h-5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  inbox: 'M3 13h5l1.5 3h5l1.5-3h5M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 12h.01',
  key: 'M15.5 7.5a3.5 3.5 0 1 1-1 2.5M14 10l-9.5 9.5M8 16l2 2M6 18l1.5 1.5',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  car: 'M5 17h14M5 17v2M19 17v2M3 13l2-6h14l2 6v4H3zM7 14h.01M17 14h.01',
  elevator: 'M5 3h14v18H5zM9 9l1.5-2L12 9M9 15l1.5 2 1.5-2M15 7v10',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  doc: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  menu: 'M4 6h16M4 12h16M4 18h16',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2M16 14.5h.01',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 2v4M16 2v4',
};

export function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', P[name] || P.info);
  svg.append(path);
  return svg;
}

// ---- API ----
export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-MN': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'اتصال به اینترنت برقرار نیست', 'offline');
  }
  let json = null;
  try {
    json = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new ApiError(res.status, json?.error || 'خطایی رخ داد', json?.code);
    if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/me') && !path.startsWith('/api/public')) window.dispatchEvent(new CustomEvent('mn:unauthorized'));
    if (json?.code === 'must_change') window.dispatchEvent(new CustomEvent('mn:mustchange'));
    throw err;
  }
  return json;
}

// ---- formatting ----
const faDigits = '۰۱۲۳۴۵۶۷۸۹';
export const fa = (v) => String(v ?? '').replace(/\d/g, (d) => faDigits[d]);
export const en = (v) => String(v ?? '').replace(/[۰-۹]/g, (d) => faDigits.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
export const faInt = (n) => (n === null || n === undefined || n === '' ? '' : fa(Math.round(Number(n)).toLocaleString('en-US').replace(/,/g, '٬')));

const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

export function money(n, { unit = true } = {}) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  n = Number(n);
  const u = unit ? ' تومان' : '';
  if (n >= 1e9) {
    const v = n / 1e9;
    return fa(trim(v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)).replace('.', '٫')) + ' میلیارد' + u;
  }
  if (n >= 1e6) {
    const v = n / 1e6;
    return fa(trim(v.toFixed(v >= 100 ? 0 : 1)).replace('.', '٫')) + ' میلیون' + u;
  }
  if (n >= 1e3) return faInt(n) + u;
  return fa(n) + u;
}

export function moneyWords(n) {
  if (!n) return '';
  const parts = [];
  let rest = Math.round(Number(n));
  const b = Math.floor(rest / 1e9);
  rest -= b * 1e9;
  const m = Math.floor(rest / 1e6);
  rest -= m * 1e6;
  const k = Math.floor(rest / 1e3);
  rest -= k * 1e3;
  if (b) parts.push(faInt(b) + ' میلیارد');
  if (m) parts.push(faInt(m) + ' میلیون');
  if (k) parts.push(faInt(k) + ' هزار');
  if (rest) parts.push(faInt(rest));
  return parts.join(' و ') + ' تومان';
}

const dateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const date = (t) => (t ? dateFmt.format(new Date(t)) : '');
export const dateTime = (t) => (t ? dateTimeFmt.format(new Date(t)) : '');
export function ago(t) {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'همین الان';
  if (s < 3600) return fa(Math.floor(s / 60)) + ' دقیقه پیش';
  if (s < 86400) return fa(Math.floor(s / 3600)) + ' ساعت پیش';
  if (s < 86400 * 30) return fa(Math.floor(s / 86400)) + ' روز پیش';
  if (s < 86400 * 365) return fa(Math.floor(s / (86400 * 30))) + ' ماه پیش';
  return date(t);
}
export const daysSince = (t) => Math.floor((Date.now() - (t || Date.now())) / 86400000);

export function parseNumber(v) {
  const s = en(v).replace(/[^\d.]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---- feedback ----
let toastWrap;
export function toast(message, type = 'ok') {
  if (!toastWrap) document.body.append((toastWrap = h('div', { class: 'toast-wrap', role: 'status', 'aria-live': 'polite' })));
  const el = h('div', { class: ['toast', type === 'error' && 'error'] }, icon(type === 'error' ? 'alert' : 'check'), message);
  toastWrap.append(el);
  setTimeout(() => el.remove(), type === 'error' ? 4500 : 2600);
}

export function errorToast(e) {
  toast(e?.message || 'خطایی رخ داد', 'error');
}

export function sheet(build, { onClose } = {}) {
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
  const box = h('div', { class: 'sheet' }, h('div', { class: 'grip' }));
  overlay.append(box);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  overlay.addEventListener('click', (e) => e.target === overlay && close());
  document.addEventListener('keydown', onKey);
  const content = build(close);
  box.append(content);
  document.body.append(overlay);
  return { close, box };
}

export function confirmDialog(title, text, { ok = 'تأیید', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    sheet(
      (close) =>
        h('div', { class: 'stack' },
          h('h3', null, title),
          text ? h('p', { class: 'muted small', style: { margin: '0' } }, text) : null,
          h('div', { class: 'row' },
            h('button', { class: ['btn', danger ? 'danger' : 'primary', 'grow'], on: { click: () => { answered = true; close(); resolve(true); } } }, ok),
            h('button', { class: 'btn ghost grow', on: { click: () => close() } }, 'انصراف'))),
      { onClose: () => !answered && resolve(false) },
    );
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('کپی شد');
  } catch {
    toast('کپی انجام نشد', 'error');
  }
}

export function busy(btn, on, label) {
  if (on) {
    btn._kids = [...btn.childNodes];
    btn.disabled = true;
    clear(btn, h('span', { class: ['spinner', btn.classList.contains('ghost') ? '' : 'light'] }), label || '');
  } else {
    btn.disabled = false;
    if (btn._kids) btn.replaceChildren(...btn._kids);
  }
}

export function initials(name) {
  const parts = String(name || '').replace(/^(آقای|خانم)\s+/, '').trim().split(/\s+/);
  return (parts[0]?.[0] || '؟') + (parts[1]?.[0] ? '‌' + parts[1][0] : '');
}

// Theme-aware wordmark: dark navy text on light, white text on dark.
export function wordmark(props = {}) {
  const { class: cls = '', style } = props;
  return h('span', { class: ['wordmark', cls], style: { display: 'contents' } },
    h('img', { class: 'only-light', src: '/img/wordmark.png', alt: 'پلاک‌نگار', style }),
    h('img', { class: 'only-dark', src: '/img/wordmark-light.png', alt: 'پلاک‌نگار', style }));
}
