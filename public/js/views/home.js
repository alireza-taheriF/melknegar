import { h, icon, fa, ago, toast, errorToast, api } from '../core.js';
import { route, layout, loadLedger, state, go, invalidate, render } from '../app.js';
import { propertyRow, staleActions } from './properties.js';
import { clientRow } from './clients.js';

// Match score mirrored from the server so the dashboard can rank instantly.
export function matchScore(p, c) {
  if (!p || !c || p.status !== 'active' || c.status !== 'active' || p.deal !== c.deal) return 0;
  let s = 0, w = 0;
  const part = (wt, ok) => { w += wt; s += wt * (ok === true ? 1 : ok || 0); };
  if (c.types?.length) { if (!c.types.includes(p.type)) return 0; part(10, true); }
  const within = (v, min, max, sl) => {
    if (v == null) return 0.5;
    if (min != null && v < min * (1 - sl)) return 0;
    if (max != null && v > max * (1 + sl)) return 0;
    if ((min != null && v < min) || (max != null && v > max)) return 0.6;
    return 1;
  };
  if (c.deal === 'rent') {
    if (c.depositMax != null) { const f = within(p.deposit, null, c.depositMax, 0.15); if (!f) return 0; part(30, f); }
    if (c.rentMax != null) { const f = within(p.rent, null, c.rentMax, 0.15); if (!f) return 0; part(15, f); }
  } else if (c.budgetMin != null || c.budgetMax != null) { const f = within(p.price, c.budgetMin, c.budgetMax, 0.12); if (!f) return 0; part(40, f); }
  if (c.areaMin != null || c.areaMax != null) { const f = within(p.area, c.areaMin, c.areaMax, 0.15); if (!f) return 0; part(20, f); }
  if (c.roomsMin != null) part(10, p.rooms == null ? 0.5 : p.rooms >= c.roomsMin ? 1 : 0.2);
  const n = (x) => String(x || '').replace(/\s|‌/g, '');
  if (c.neighborhoods?.length) part(20, c.neighborhoods.some((x) => x && (n(p.neighborhood) + n(p.address)).includes(n(x))) ? 1 : 0.1);
  if (c.features?.length) part(10, c.features.filter((f) => p.features?.includes(f)).length / c.features.length);
  return w ? Math.round((s / w) * 100) : 50;
}

export const isStale = (p) => p.status === 'active' && Date.now() - (p.confirmedAt || p.createdAt) > 30 * 86400000;

route('/', async () => {
  const L = await loadLedger();
  const s = L.summary;
  const props = L.properties;
  const stale = props.filter(isStale).sort((a, b) => (a.confirmedAt || 0) - (b.confirmedAt || 0));
  const review = [...props.filter((p) => p.needsReview), ...L.clients.filter((c) => c.needsReview)];
  const matches = [];
  for (const c of L.clients.filter((x) => x.status === 'active')) {
    for (const p of props) {
      const sc = matchScore(p, c);
      if (sc >= 70) matches.push({ p, c, sc });
    }
  }
  matches.sort((a, b) => b.sc - a.sc);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صبح بخیر' : hour < 17 ? 'روز بخیر' : 'عصر بخیر';
  const capture = (mode) => import('./capture.js').then((m) => m.openCapture(mode));

  const stat = (label, value, ic, cls, to) => h('button', { class: ['stat', cls], on: { click: () => go(to) } }, h('span', { class: 'label' }, icon(ic), label), h('span', { class: 'value' }, fa(value)));

  const installBanner = state.installPrompt
    ? h('div', { class: 'card install-banner', style: { marginTop: '12px' } },
        h('img', { src: '/icons/icon-192.png', alt: '' }),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, 'نصب اپ روی گوشی'), h('div', { class: 'small muted' }, 'سریع‌تر باز می‌شود و مثل اپ معمولی کار می‌کند.')),
        h('button', { class: 'btn sm primary', on: { click: async () => { state.installPrompt.prompt(); state.installPrompt = null; } } }, 'نصب'))
    : null;

  const content = h('div', null,
    h('section', { class: 'hero' },
      h('h2', null, `${greet}، ${state.user.name.split(' ')[0]}`),
      h('p', null, `${state.user.tenantName}، ${fa(s.active)} فایل فعال، ${fa(s.clients)} مشتری در جستجو`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn white sm', on: { click: () => capture('text') } }, icon('edit'), 'متن'),
        h('button', { class: 'btn glass sm', on: { click: () => capture('voice') } }, icon('mic'), 'صدا'),
        h('button', { class: 'btn glass sm', on: { click: () => capture('photo') } }, icon('camera'), 'عکس دفتر'),
        h('button', { class: 'btn glass sm', on: { click: () => go('/files?q=') } }, icon('search'), 'جستجو'))),
    installBanner,
    h('div', { class: 'stats' },
      stat('فایل فعال', s.active, 'folder', '', '/files?status=active'),
      stat('مشتری فعال', s.clients, 'users', 'teal', '/clients'),
      stat('نیاز به پیگیری', s.stale, 'clock', s.stale ? 'warn' : '', '/files?view=stale'),
      stat('بسته‌شده این ماه', s.closedMonth, 'check', '', '/files?status=closed')),

    review.length ? [
      h('div', { class: 'section' }, h('h2', null, `ثبت‌شده از ربات، منتظر بررسی (${fa(review.length)})`), h('button', { class: 'link', on: { click: () => go('/files?view=review') } }, 'همه')),
      h('div', { class: 'list' }, review.slice(0, 4).map((x) => (x.price !== undefined || x.area !== undefined || x.type ? propertyRow(x, L) : clientRow(x, L)))),
    ] : null,

    matches.length ? [
      h('div', { class: 'section' }, h('h2', null, 'تطبیق‌های قوی فایل و مشتری'), h('span', { class: 'muted tiny' }, 'بالای ۷۰٪')),
      h('div', { class: 'list' }, matches.slice(0, 5).map(({ p, c, sc }) => {
        const ring = h('div', { class: 'ring' }, fa(sc) + '٪');
        ring.style.setProperty('--p', sc);
        return h('div', { class: 'match', on: { click: () => go('/clients/' + c.id) } }, ring,
          h('div', { class: 'grow' },
            h('div', { class: 'strong small ellipsis' }, `${c.name || 'مشتری #' + fa(c.no)} ← فایل #${fa(p.no)}`),
            h('div', { class: 'tiny muted ellipsis' }, [p.neighborhood, p.area && fa(p.area) + ' متر', p.rooms != null && fa(p.rooms) + ' خواب'].filter(Boolean).join('، '))),
          icon('chevron'));
      })),
    ] : null,

    stale.length ? [
      h('div', { class: 'section' }, h('h2', null, 'فایل‌هایی که باید پیگیری شوند'), h('button', { class: 'link', on: { click: () => go('/files?view=stale') } }, 'همه')),
      h('div', { class: 'alert warn', style: { marginBottom: '10px' } }, icon('clock'), h('div', { class: 'small' }, 'این فایل‌ها بیش از ۳۰ روز تأیید نشده‌اند. با مالک تماس بگیرید و وضعیت را با یک ضربه به‌روز کنید.')),
      h('div', { class: 'list' }, stale.slice(0, 4).map((p) => h('div', null, propertyRow(p, L), staleActions(p)))),
    ] : null,

    h('div', { class: 'section' }, h('h2', null, 'آخرین فعالیت‌ها')),
    L.activity.length
      ? h('div', { class: 'list' }, L.activity.slice(0, 8).map((a) => h('div', { class: 'row', style: { padding: '11px 14px' } },
          h('div', { class: 'avatar sm' }, (a.byName || '؟').slice(0, 1)),
          h('div', { class: 'grow' }, h('div', { class: 'small strong' }, a.text), h('div', { class: 'tiny muted' }, [a.byName, ago(a.at)].filter(Boolean).join('، '))))))
      : h('div', { class: 'card empty' }, icon('inbox'), h('h3', null, 'هنوز فعالیتی ثبت نشده'), h('p', { class: 'small' }, 'اولین فایل را با دکمه + ثبت کنید.')),
  );
  return layout({ title: 'پلاک‌نگار', content, brand: true });
});

export async function quickStatus(p, status, extra = {}) {
  try {
    await api('PATCH', '/api/properties/' + p.id, { status, ...extra });
    invalidate();
    toast(extra.confirm ? 'تأیید شد؛ فایل هنوز موجود است' : 'وضعیت به‌روز شد');
    render();
  } catch (e) {
    errorToast(e);
  }
}
