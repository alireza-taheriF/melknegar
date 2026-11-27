// Module 3 for agencies: order content production or a technical inspection.
import { h, icon, api, fa, money, date, dateTime, toast, errorToast, busy, parseNumber } from '../core.js';
import { route, layout, loadLedger, go, state } from '../app.js';
import { ORDER_STATUS, TYPE_SHORT } from '../labels.js';

let catalogCache = null;
export async function catalog() {
  if (!catalogCache) catalogCache = (await api('GET', '/api/services/catalog')).catalog;
  return catalogCache;
}

export function packagePicker(pkgs, selected, onPick) {
  const wrap = h('div', { class: 'pkgs' });
  const draw = () => wrap.replaceChildren(...pkgs.map((p) => h('button', { type: 'button', class: ['pkg', selected === p.id && 'on'], style: { textAlign: 'start' }, on: { click: () => { selected = p.id; onPick(p.id); draw(); } } },
    h('div', { class: 'row spread' }, h('span', { class: 't' }, p.title), selected === p.id ? h('span', { class: 'badge b-active' }, icon('check'), 'انتخاب') : null),
    h('div', { class: 'p' }, money(p.price)),
    h('ul', null, p.items.map((i) => h('li', null, i))))));
  draw();
  return wrap;
}

function orderCard(o, cat) {
  const pkg = cat[o.kind]?.packages.find((p) => p.id === o.package);
  return h('div', { class: 'card pad stack', style: { gap: '10px' } },
    h('div', { class: 'row spread' },
      h('div', null, h('div', { class: 'strong' }, `${cat[o.kind]?.title} — ${pkg?.title || ''}`), h('div', { class: 'tiny muted num' }, `کد ${o.code}، ${date(o.createdAt)}`)),
      h('span', { class: ['badge', 'b-' + o.status] }, ORDER_STATUS[o.status])),
    h('div', { class: 'small muted' }, [o.location?.neighborhood, o.location?.address].filter(Boolean).join('، ')),
    h('div', { class: 'row wrap small' },
      h('span', null, 'هزینه: ', h('span', { class: 'strong' }, money(o.price || o.estimate))),
      o.scheduledAt ? h('span', null, '، زمان: ', h('span', { class: 'strong' }, o.scheduledAt)) : null),
    o.deliveryLink ? h('a', { class: 'btn sm accent', href: o.deliveryLink, target: '_blank', rel: 'noopener noreferrer' }, icon('download'), 'دریافت فایل‌های تحویلی') : null,
    o.history?.length > 1 ? h('div', { class: 'timeline' }, o.history.slice(-4).map((x) => h('div', { class: 'tl' }, h('span', { class: 'dot' }), h('div', null, h('div', { class: 'small strong' }, ORDER_STATUS[x.status] + (x.note ? ' — ' + x.note : '')), h('div', { class: 'tiny muted' }, dateTime(x.at)))))) : null);
}

route('/services', async () => {
  const [cat, orders] = await Promise.all([catalog(), api('GET', '/api/services/orders')]);
  const card = (kind, ic) => h('button', { class: 'card service-card', style: { width: '100%', textAlign: 'start' }, on: { click: () => go('/services/new?kind=' + kind) } },
    h('div', { class: 'ico i-' + kind }, icon(ic)),
    h('div', { class: 'grow' }, h('h3', null, cat[kind].title), h('div', { class: 'small muted' }, cat[kind].subtitle),
      h('div', { class: 'small strong', style: { marginTop: '6px', color: 'var(--tint)' } }, 'از ' + money(Math.min(...cat[kind].packages.map((p) => p.price))))),
    icon('chevron'));
  const content = h('div', null,
    h('div', { class: 'stack' },
      card('content', 'video'),
      card('inspection', 'shield')),
    h('div', { class: 'card pad', style: { marginTop: '12px' } },
      h('div', { class: 'row' }, icon('link'), h('div', { class: 'grow small' }, h('div', { class: 'strong' }, 'لینک درخواست بازدید فنی برای خریداران شما'), h('div', { class: 'muted tiny' }, 'این لینک را برای خریدارها بفرستید تا مستقیم درخواست بازدید فنی ثبت کنند.')),
        h('button', { class: 'btn sm ghost', on: { click: () => navigator.clipboard.writeText(location.origin + '/#/inspect').then(() => toast('لینک کپی شد')) } }, icon('copy'), 'کپی'))),
    h('div', { class: 'section' }, h('h2', null, `سفارش‌های من (${fa(orders.orders.length)})`)),
    orders.orders.length
      ? h('div', { class: 'stack', style: { gap: '10px' } }, orders.orders.map((o) => orderCard(o, cat)))
      : h('div', { class: 'card empty' }, icon('inbox'), h('h3', null, 'هنوز سفارشی ندارید'), h('p', { class: 'small' }, 'برای فایل‌های مهم‌تان عکس و ریلز حرفه‌ای سفارش دهید؛ فایل سریع‌تر دیده و فروخته می‌شود.')));
  return layout({ title: 'خدمات', content, active: '/services' });
});

route('/services/new', async ({ query }) => {
  const [cat, L] = await Promise.all([catalog(), loadLedger()]);
  const kind = query.get('kind') === 'inspection' ? 'inspection' : 'content';
  const def = cat[kind];
  let pkg = def.packages[kind === 'content' ? 1 : 0].id;
  const props = L.properties.filter((p) => p.status === 'active');
  const propSel = h('select', { class: 'input' }, h('option', { value: '' }, 'ملک خارج از فایل‌ها (آدرس را وارد کنید)'),
    ...props.map((p) => h('option', { value: p.id, selected: p.id === query.get('property') }, `#${fa(p.no)} ${TYPE_SHORT[p.type]} ${p.neighborhood || ''} ${p.area ? fa(p.area) + ' متر' : ''}`)));
  const address = h('input', { class: 'input', placeholder: 'محله و آدرس ملک' });
  const area = h('input', { class: 'input num', inputmode: 'numeric', placeholder: 'متر' });
  const name = h('input', { class: 'input', placeholder: kind === 'inspection' ? 'نام خریدار' : 'نام هماهنگ‌کننده', value: kind === 'content' ? state.user.name : '' });
  const phone = h('input', { class: 'input ltr num', inputmode: 'tel', placeholder: '09...', value: kind === 'content' ? state.user.phone || '' : '' });
  const when = h('input', { class: 'input', placeholder: 'مثلاً شنبه صبح یا هر روز بعد از ساعت ۴' });
  const notes = h('textarea', { class: 'input', rows: 3, placeholder: kind === 'content' ? 'نکات مهم برای عکاس: نقاط قوت ملک، ساعت نور مناسب، کلید...' : 'نکته خاصی که مهندس باید بداند' });
  const addrRow = h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'آدرس ملک'), address), h('div', { class: 'field' }, h('label', null, 'متراژ'), area));
  const syncAddr = () => (addrRow.hidden = Boolean(propSel.value));
  propSel.addEventListener('change', syncAddr);
  syncAddr();
  const btn = h('button', { class: 'btn primary lg grow', type: 'submit' }, icon('send'), 'ثبت سفارش');
  const form = h('form', { on: { submit: async (e) => {
    e.preventDefault();
    busy(btn, true, 'در حال ثبت...');
    try {
      const r = await api('POST', '/api/services/orders', { kind, package: pkg, propertyId: propSel.value || null, address: address.value, area: parseNumber(area.value), name: name.value, phone: phone.value, preferredAt: when.value, notes: notes.value });
      toast(`سفارش ${r.order.code} ثبت شد؛ برای هماهنگی تماس می‌گیریم`);
      go('/services');
    } catch (ex) { errorToast(ex); busy(btn, false); }
  } } },
  h('div', { class: 'card' },
    h('div', { class: 'form-section' }, h('h3', null, icon(kind === 'content' ? 'video' : 'shield'), def.title), h('p', { class: 'small muted', style: { marginTop: '0' } }, def.subtitle), def.note ? h('div', { class: 'alert info', style: { marginBottom: '12px' } }, icon('info'), h('div', { class: 'small' }, def.note)) : null, packagePicker(def.packages, pkg, (v) => (pkg = v))),
    h('div', { class: 'form-section' }, h('h3', null, icon('pin'), 'ملک'), h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', null, 'انتخاب از فایل‌ها'), propSel), addrRow)),
    h('div', { class: 'form-section' }, h('h3', null, icon('calendar'), 'هماهنگی'), h('div', { class: 'stack' },
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'نام'), name), h('div', { class: 'field' }, h('label', null, 'موبایل'), phone)),
      h('div', { class: 'field' }, h('label', null, 'زمان مناسب بازدید'), when), h('div', { class: 'field' }, h('label', null, 'توضیحات'), notes)))),
  h('div', { class: 'sticky-actions' }, btn));
  return layout({ title: 'سفارش خدمت', content: form, backTo: '/services', active: '/services' });
});
