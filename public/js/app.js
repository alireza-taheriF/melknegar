// App shell: session, routing and layout.
import { h, clear, icon, api, toast, errorToast, wordmark } from './core.js';

export const state = { user: null, ai: false, bots: {}, ledger: null, ledgerAt: 0, installPrompt: null, orders: null };

export async function loadLedger(force = false) {
  if (!force && state.ledger && Date.now() - state.ledgerAt < 20000) return state.ledger;
  state.ledger = await api('GET', '/api/ledger');
  state.ledgerAt = Date.now();
  return state.ledger;
}
export function invalidate() {
  state.ledgerAt = 0;
}

// ---- routing ----
const routes = [];
export function route(pattern, view, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ re, keys, view, opts });
}

export function go(path, { replace = false } = {}) {
  const target = '#' + path;
  if (replace) history.replaceState(null, '', target);
  else if (location.hash !== target) {
    location.hash = target;
    return;
  }
  render();
}

export function back(fallback = '/') {
  if (history.length > 1 && document.referrer !== '' ) history.back();
  else go(fallback);
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

const app = document.getElementById('app');
let renderSeq = 0;

function currentRoute() {
  const { path } = parseHash();
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { r, params };
    }
  }
  return null;
}

export async function render() {
  const seq = ++renderSeq;
  const { path, query } = parseHash();
  const match = currentRoute();
  if (!match) return go('/', { replace: true });
  const { r, params } = match;
  if (!r.opts.public && !state.user) return go('/login', { replace: true });
  if (state.user?.mustChange && !r.opts.public && path !== '/password') return go('/password', { replace: true });
  if (r.opts.staff && !state.user?.staff) return go('/', { replace: true });
  // Platform staff are not members of any agency: they live in the admin panel.
  if (isPlatformOnly() && !r.opts.public && !r.opts.staff && !['/settings', '/password'].includes(path)) return go('/admin', { replace: true });
  try {
    const node = await r.view({ params, query, path });
    if (seq !== renderSeq) return;
    clear(app, node);
    window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e.status === 401) { state.user = null; return go('/login', { replace: true }); }
    clear(app, layout({ title: 'خطا', content: h('div', { class: 'empty' }, icon('alert'), h('h3', null, 'بارگذاری انجام نشد'), h('p', null, e.message || ''), h('button', { class: 'btn primary', on: { click: render } }, 'تلاش دوباره')) }));
  }
}

export const isPlatformOnly = () => Boolean(state.user?.staff && !state.user?.tenantId);

// ---- layout ----
const STAFF_NAV = [
  { path: '/admin', label: 'مدیریت', icon: 'shield' },
  { path: '/settings', label: 'تنظیمات', icon: 'settings' },
];
const NAV = [
  { path: '/', label: 'خانه', icon: 'home' },
  { path: '/files', label: 'فایل‌ها', icon: 'folder' },
  { fab: true },
  { path: '/clients', label: 'مشتری‌ها', icon: 'users' },
  { path: '/services', label: 'خدمات', icon: 'spark' },
];

export function layout({ title, content, active, backTo, actions = [], brand = false }) {
  const { path } = parseHash();
  const cur = active || '/' + (path.split('/')[1] || '');
  const isActive = (p) => (p === '/' ? cur === '/' : cur === p);
  const openCapture = () => import('./views/capture.js').then((m) => m.openCapture());

  const staffOnly = isPlatformOnly();
  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'logo' }, wordmark({ style: { height: '32px', width: 'auto' } })),
    staffOnly
      ? STAFF_NAV.map((n) => h('button', { class: ['side-link', isActive(n.path) && 'active'], on: { click: () => go(n.path) } }, icon(n.icon), n.label))
      : [
          h('button', { class: 'btn primary block side-cta', on: { click: openCapture } }, icon('plus'), 'ثبت سریع فایل'),
          ...NAV.filter((n) => !n.fab).map((n) => h('button', { class: ['side-link', isActive(n.path) && 'active'], on: { click: () => go(n.path) } }, icon(n.icon), n.label)),
          h('button', { class: ['side-link', isActive('/settings') && 'active'], on: { click: () => go('/settings') } }, icon('settings'), 'تنظیمات'),
          state.user?.staff ? h('button', { class: ['side-link', isActive('/admin') && 'active'], on: { click: () => go('/admin') } }, icon('shield'), 'پنل مدیریت') : null,
        ],
    h('div', { class: 'side-foot' }, state.user ? [h('div', { class: 'strong', style: { color: 'var(--text)' } }, state.user.name), state.user.tenantName || (staffOnly ? 'مدیریت پلتفرم' : '')] : ''),
  );

  const top = h('header', { class: 'topbar' },
    h('div', { class: 'container' },
      backTo ? h('button', { class: 'icon-btn plain', 'aria-label': 'بازگشت', on: { click: () => go(backTo) } }, icon('back')) : null,
      brand ? h('div', { class: 'brand-wrap' }, wordmark({ class: 'brand-mini', style: { height: '24px', width: 'auto' } })) : h('h1', null, title),
      ...actions,
      !backTo && !staffOnly && state.user?.staff ? h('button', { class: 'icon-btn', 'aria-label': 'پنل مدیریت', on: { click: () => go('/admin') } }, icon('shield')) : null,
      !backTo ? h('button', { class: 'icon-btn', 'aria-label': 'تنظیمات', on: { click: () => go('/settings') } }, icon('settings')) : null,
    ));

  const tabbar = staffOnly
    ? h('nav', { class: 'tabbar n3', 'aria-label': 'منوی اصلی', style: { gridTemplateColumns: 'repeat(2, 1fr)' } },
        ...STAFF_NAV.map((n) => h('button', { class: ['tab', isActive(n.path) && 'active'], on: { click: () => go(n.path) } }, icon(n.icon), n.label)))
    : h('nav', { class: 'tabbar', 'aria-label': 'منوی اصلی' },
        ...NAV.map((n) => n.fab
          ? h('div', null, h('button', { class: 'tab-fab', 'aria-label': 'ثبت سریع', on: { click: openCapture } }, icon('plus')))
          : h('button', { class: ['tab', isActive(n.path) && 'active'], on: { click: () => go(n.path) } }, icon(n.icon), n.label)));

  return h('div', { class: 'shell' }, sidebar, h('main', { class: 'main' }, top, h('div', { class: 'container page' }, content)), tabbar);
}

// ---- boot ----
async function boot() {
  window.addEventListener('scroll', () => document.querySelector('.topbar')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  window.addEventListener('hashchange', render);
  window.addEventListener('mn:unauthorized', () => {
    state.user = null;
    state.ledger = null;
    if (!currentRoute()?.r.opts.public) go('/login');
  });
  window.addEventListener('mn:mustchange', () => go('/password'));
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
  });
  const showOffline = () => {
    document.querySelector('.offline-bar')?.remove();
    if (!navigator.onLine) document.body.append(h('div', { class: 'offline-bar' }, 'اتصال اینترنت قطع است'));
  };
  window.addEventListener('online', showOffline);
  window.addEventListener('offline', showOffline);
  showOffline();
  if ('serviceWorker' in navigator) {
    // A new version takes over once installed; reload once so the page matches it.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  await Promise.all([import('./views/auth.js'), import('./views/home.js'), import('./views/properties.js'), import('./views/clients.js'), import('./views/services.js'), import('./views/settings.js'), import('./views/admin.js'), import('./views/public.js')]);
  try {
    const me = await api('GET', '/api/auth/me');
    state.user = me.user;
    state.ai = me.ai;
    state.bots = me.bots;
  } catch (e) {
    if (e.status !== 401) errorToast(e);
  }
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('expired')) toast('لینک ورود منقضی شده است؛ دوباره از ربات بگیرید', 'error');
  render();
}

boot();
