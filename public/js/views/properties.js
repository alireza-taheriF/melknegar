import { h, icon, api, fa, faInt, money, moneyWords, date, ago, daysSince, parseNumber, toast, errorToast, confirmDialog, copyText, busy, initials, en } from '../core.js';
import { route, layout, loadLedger, go, invalidate, state } from '../app.js';
import { DEAL, TYPE, TYPE_SHORT, TYPE_ICON, PSTATUS, FEATURE, SOURCE } from '../labels.js';
import { matchScore, isStale, quickStatus } from './home.js';

export function priceLabel(p) {
  if (p.deal === 'rent') {
    const parts = [];
    if (p.deposit != null) parts.push('رهن ' + money(p.deposit, { unit: false }));
    if (p.rent != null) parts.push('اجاره ' + money(p.rent, { unit: false }));
    return parts.join(' / ') || 'قیمت توافقی';
  }
  return p.price ? money(p.price, { unit: false }) : 'قیمت توافقی';
}

export function propertyRow(p, L) {
  const stale = isStale(p);
  return h('div', { class: 'prow', role: 'link', tabindex: '0', on: { click: () => go('/files/' + p.id), keydown: (e) => e.key === 'Enter' && go('/files/' + p.id) } },
    h('div', { class: ['thumb', 't-' + p.type] }, icon(TYPE_ICON[p.type] || 'building')),
    h('div', { class: 'body' },
      h('div', { class: 'title' }, h('span', { class: 'ellipsis' }, `${TYPE_SHORT[p.type]} ${p.neighborhood || ''}`.trim()), h('span', { class: 'muted tiny num' }, '#' + fa(p.no))),
      h('div', { class: 'meta' },
        p.area ? h('span', null, icon('ruler'), fa(p.area) + ' متر') : null,
        p.rooms != null ? h('span', null, icon('bed'), fa(p.rooms) + ' خواب') : null,
        p.floor != null ? h('span', null, icon('layers'), p.floor === 0 ? 'همکف' : 'طبقه ' + fa(p.floor)) : null,
        p.buildYear ? h('span', null, 'ساخت ' + fa(p.buildYear)) : null),
      h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '2px' } },
        h('span', { class: 'badge b-deal' }, DEAL[p.deal]),
        p.status !== 'active' ? h('span', { class: ['badge', 'b-' + p.status] }, PSTATUS[p.status]) : null,
        p.needsReview ? h('span', { class: 'badge b-review' }, icon('bot'), 'نیاز به بررسی') : null,
        stale ? h('span', { class: 'badge b-stale' }, icon('clock'), fa(daysSince(p.confirmedAt || p.createdAt)) + ' روز بدون پیگیری') : null)),
    h('div', { class: 'side' },
      p.deal === 'rent'
        ? h('div', { class: 'price' }, p.deposit != null ? h('span', { class: 'l2' }, 'رهن ' + money(p.deposit, { unit: false })) : null, p.rent != null ? h('span', { class: 'l2' }, 'اجاره ' + money(p.rent, { unit: false })) : null, p.deposit == null && p.rent == null ? 'توافقی' : null)
        : h('div', { class: 'price' }, p.price ? money(p.price, { unit: false }) : 'توافقی', p.price ? [h('br'), h('small', null, 'تومان')] : null),
      h('div', { class: 'tiny muted' }, ago(p.updatedAt))));
}

export function staleActions(p) {
  return h('div', { class: 'row', style: { padding: '0 14px 12px', gap: '8px' } },
    p.ownerPhone ? h('a', { class: 'btn sm ghost', href: 'tel:' + p.ownerPhone }, icon('phone'), 'تماس با مالک') : null,
    h('button', { class: 'btn sm success', on: { click: () => quickStatus(p, 'active', { confirm: true }) } }, icon('check'), 'هنوز موجوده'),
    h('button', { class: 'btn sm ghost', on: { click: () => quickStatus(p, p.deal === 'rent' ? 'rented' : 'sold') } }, p.deal === 'rent' ? 'اجاره رفت' : 'فروخته شد'));
}

export function shareText(p, agency) {
  const lines = [
    `🏠 ${DEAL[p.deal]} ${TYPE_SHORT[p.type]} — ${p.neighborhood || ''}`.trim(),
    p.area ? `📐 متراژ: ${fa(p.area)} متر${p.landArea ? ` (زمین ${fa(p.landArea)} متر)` : ''}` : '',
    p.rooms != null ? `🛏 ${fa(p.rooms)} خواب` : '',
    p.floor != null ? `🏢 طبقه ${p.floor === 0 ? 'همکف' : fa(p.floor)}${p.totalFloors ? ` از ${fa(p.totalFloors)}` : ''}` : '',
    p.buildYear ? `📅 سال ساخت ${fa(p.buildYear)}` : '',
    p.features?.length ? `✅ ${p.features.map((f) => FEATURE[f]?.[0]).filter(Boolean).join('، ')}` : '',
    p.deal === 'rent' ? `💰 ${priceLabel(p)} تومان` : p.price ? `💰 قیمت: ${money(p.price)}` : '💰 قیمت توافقی',
    '',
    `📞 ${agency || 'دفتر املاک'}`,
    `کد فایل: ${fa(p.no)}`,
  ];
  return lines.filter((l, i) => l !== '' || i === lines.length - 3).join('\n');
}

function filterChip(label, on, onClick) {
  return h('button', { class: ['chip', on && 'on'], on: { click: onClick } }, label);
}

route('/files', async ({ query }) => {
  const L = await loadLedger();
  let q = query.get('q') || '';
  let deal = query.get('deal') || '';
  let status = query.get('status') || 'active';
  let view = query.get('view') || '';
  let type = query.get('type') || '';
  if (view) status = 'all';

  const listEl = h('div');
  const countEl = h('span', { class: 'muted tiny' });
  const chipsEl = h('div', { class: 'scroll-x' });

  const norm = (s) => en(String(s || '')).replace(/[‌\s]+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  function apply() {
    const words = norm(q).trim().split(' ').filter(Boolean);
    let items = L.properties.slice();
    if (deal) items = items.filter((p) => p.deal === deal);
    if (type) items = items.filter((p) => p.type === type);
    if (status === 'active') items = items.filter((p) => p.status === 'active');
    else if (status === 'closed') items = items.filter((p) => ['sold', 'rented'].includes(p.status));
    if (view === 'stale') items = items.filter(isStale);
    if (view === 'review') items = items.filter((p) => p.needsReview);
    if (words.length) {
      items = items.filter((p) => {
        const hay = norm([p.no, TYPE[p.type], DEAL[p.deal], p.neighborhood, p.address, p.ownerName, p.ownerPhone, p.notes, p.area && p.area + 'متر', p.rooms != null && p.rooms + 'خواب', p.title].join(' '));
        return words.every((w) => hay.includes(w));
      });
    }
    items.sort((a, b) => (view === 'stale' ? (a.confirmedAt || 0) - (b.confirmedAt || 0) : b.updatedAt - a.updatedAt));
    countEl.textContent = fa(items.length) + ' فایل';
    listEl.replaceChildren(items.length
      ? h('div', { class: 'list' }, items.slice(0, 300).map((p) => (view === 'stale' ? h('div', null, propertyRow(p, L), staleActions(p)) : propertyRow(p, L))))
      : h('div', { class: 'card empty' }, icon('search'), h('h3', null, 'فایلی پیدا نشد'), h('p', { class: 'small' }, 'فیلترها را تغییر دهید یا فایل جدید ثبت کنید.')));
    drawChips();
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (deal) qs.set('deal', deal);
    if (type) qs.set('type', type);
    if (status !== 'active') qs.set('status', status);
    if (view) qs.set('view', view);
    history.replaceState(null, '', '#/files' + (qs.toString() ? '?' + qs : ''));
  }
  function drawChips() {
    chipsEl.replaceChildren(
      filterChip('فعال', status === 'active' && !view, () => { status = 'active'; view = ''; apply(); }),
      filterChip('همه', status === 'all' && !view, () => { status = 'all'; view = ''; apply(); }),
      filterChip('بسته‌شده', status === 'closed', () => { status = 'closed'; view = ''; apply(); }),
      filterChip('نیاز به پیگیری', view === 'stale', () => { view = view === 'stale' ? '' : 'stale'; status = 'all'; apply(); }),
      filterChip('از ربات', view === 'review', () => { view = view === 'review' ? '' : 'review'; status = 'all'; apply(); }),
      h('span', { style: { width: '1px', background: 'var(--line)', flexShrink: '0' } }),
      ...Object.entries(DEAL).map(([k, v]) => filterChip(v, deal === k, () => { deal = deal === k ? '' : k; apply(); })),
      ...['apartment', 'villa', 'land', 'commercial'].map((k) => filterChip(TYPE_SHORT[k], type === k, () => { type = type === k ? '' : k; apply(); })),
    );
  }
  const search = h('input', { class: 'input', type: 'search', placeholder: 'جستجو: محله، متراژ، نام مالک، شماره فایل...', value: q, on: { input: (e) => { q = e.target.value; apply(); } } });
  apply();
  if (query.has('q')) setTimeout(() => search.focus(), 50);

  const content = h('div', null,
    h('div', { class: 'searchbar' }, icon('search'), search),
    h('div', { style: { margin: '12px 0' } }, chipsEl),
    h('div', { class: 'row spread', style: { marginBottom: '8px' } }, countEl, h('button', { class: 'btn sm ghost', on: { click: () => go('/files/new') } }, icon('plus'), 'فایل جدید')),
    listEl);
  return layout({ title: 'فایل‌ها', content, active: '/files' });
});

route('/files/new', async () => {
  const pre = state.prefill?.kind === 'property' ? state.prefill.data : null;
  state.prefill = null;
  return propertyForm(null, pre);
});
route('/files/:id/edit', async ({ params }) => {
  const L = await loadLedger();
  const p = L.properties.find((x) => x.id === params.id);
  if (!p) return go('/files', { replace: true }) || h('div');
  return propertyForm(p);
});

route('/files/:id', async ({ params }) => {
  const L = await loadLedger(true);
  const p = L.properties.find((x) => x.id === params.id);
  if (!p) {
    toast('فایل پیدا نشد', 'error');
    return go('/files', { replace: true }) || h('div');
  }
  const agent = L.team.find((x) => x.id === p.agentId);
  const matches = L.clients.map((c) => ({ c, sc: matchScore(p, c) })).filter((x) => x.sc >= 55).sort((a, b) => b.sc - a.sc).slice(0, 6);
  const kv = (k, v) => (v === null || v === undefined || v === '' ? null : h('div', null, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)));
  const text = shareText(p, state.user.tenantName);

  const statusSeg = h('div', { class: 'seg' }, ...['active', p.deal === 'rent' ? 'rented' : 'sold', 'unknown'].map((s) =>
    h('button', { class: [p.status === s && 'on'], on: { click: () => p.status !== s && quickStatus(p, s) } }, PSTATUS[s])));

  const content = h('div', { class: 'stack' },
    p.needsReview ? h('div', { class: 'alert info' }, icon('bot'), h('div', { class: 'grow small' }, `این فایل از ${SOURCE[p.source] || 'ربات'} و به صورت خودکار ثبت شده. مشخصات را بررسی و تأیید کنید.`),
      h('button', { class: 'btn sm primary', on: { click: async () => { await api('PATCH', '/api/properties/' + p.id, { needsReview: false }); invalidate(); toast('تأیید شد'); go('/files/' + p.id, { replace: true }); } } }, 'تأیید')) : null,
    isStale(p) ? h('div', { class: 'alert warn' }, icon('clock'), h('div', { class: 'grow small' }, `${fa(daysSince(p.confirmedAt || p.createdAt))} روز است که وضعیت این فایل تأیید نشده.`),
      h('button', { class: 'btn sm success', on: { click: () => quickStatus(p, 'active', { confirm: true }) } }, 'هنوز موجوده')) : null,

    h('div', { class: 'card pad stack' },
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        h('span', { class: 'badge b-deal' }, DEAL[p.deal]),
        h('span', { class: ['badge', 'b-' + p.status] }, PSTATUS[p.status]),
        h('span', { class: 'badge b-new' }, '#' + fa(p.no))),
      h('div', null,
        h('h2', { style: { margin: '0', fontSize: '20px' } }, `${TYPE[p.type]} ${p.neighborhood ? '— ' + p.neighborhood : ''}`),
        p.address ? h('div', { class: 'row muted small', style: { gap: '4px', marginTop: '4px' } }, icon('pin'), p.address) : null),
      h('div', { class: 'price-hero' },
        h('span', { class: 'big' }, p.deal === 'rent' ? priceLabel(p) : p.price ? money(p.price) : 'قیمت توافقی'),
        p.deal !== 'rent' && p.price && p.area ? h('span', { class: 'per' }, `متری ${money(Math.round(p.price / p.area))}`) : null),
      h('div', { class: 'field' }, h('label', null, 'وضعیت فایل'), statusSeg)),

    h('div', { class: 'kv' },
      kv('متراژ', p.area && fa(p.area) + ' متر'),
      kv('متراژ زمین', p.landArea && fa(p.landArea) + ' متر'),
      kv('اتاق خواب', p.rooms != null ? fa(p.rooms) : null),
      kv('طبقه', p.floor != null ? (p.floor === 0 ? 'همکف' : fa(p.floor)) + (p.totalFloors ? ` از ${fa(p.totalFloors)}` : '') : null),
      kv('سال ساخت', p.buildYear && fa(p.buildYear)),
      kv('رهن', p.deposit != null ? money(p.deposit) : null),
      kv('اجاره ماهانه', p.rent != null ? money(p.rent) : null),
      kv('آخرین تأیید', ago(p.confirmedAt || p.createdAt))),

    p.features?.length ? h('div', { class: 'feature-list' }, p.features.map((f) => h('span', { class: 'feature' }, icon(FEATURE[f]?.[1] || 'check'), FEATURE[f]?.[0] || f))) : null,

    h('div', { class: 'card' },
      h('div', { class: 'owner-card' },
        h('div', { class: 'avatar' }, initials(p.ownerName || 'م')),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, p.ownerName || 'مالک'), h('div', { class: 'small muted ltr num' }, fa(p.ownerPhone || 'بدون شماره'))),
        p.ownerPhone ? h('a', { class: 'btn sm primary', href: 'tel:' + p.ownerPhone }, icon('phone'), 'تماس') : null,
        p.ownerPhone ? h('button', { class: 'icon-btn', 'aria-label': 'کپی شماره', on: { click: () => copyText(p.ownerPhone) } }, icon('copy')) : null)),

    p.notes ? h('div', { class: 'card pad' }, h('div', { class: 'small strong muted', style: { marginBottom: '6px' } }, 'یادداشت'), h('div', { class: 'notes' }, p.notes)) : null,

    h('div', { class: 'section' }, h('h2', null, `مشتری‌های مناسب این فایل (${fa(matches.length)})`)),
    matches.length
      ? h('div', { class: 'list' }, matches.map(({ c, sc }) => {
          const ring = h('div', { class: 'ring' }, fa(sc) + '٪');
          ring.style.setProperty('--p', sc);
          return h('div', { class: 'match', on: { click: () => go('/clients/' + c.id) } }, ring,
            h('div', { class: 'grow' }, h('div', { class: 'strong small' }, c.name || 'مشتری #' + fa(c.no)), h('div', { class: 'tiny muted ltr num', style: { textAlign: 'right' } }, fa(c.phone || ''))),
            c.phone ? h('a', { class: 'icon-btn', href: 'tel:' + c.phone, 'aria-label': 'تماس', on: { click: (e) => e.stopPropagation() } }, icon('phone')) : null);
        }))
      : h('div', { class: 'card pad small muted' }, 'فعلاً مشتری مناسبی ثبت نشده. با ثبت نیاز خریدارها، تطبیق خودکار انجام می‌شود.'),

    h('div', { class: 'section' }, h('h2', null, 'اشتراک‌گذاری و بازاریابی')),
    h('div', { class: 'card pad stack' },
      h('div', { class: 'notes small', style: { background: 'var(--surface-2)', padding: '12px', borderRadius: '10px', border: '1px solid var(--line)' } }, text),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm ghost', on: { click: () => copyText(text) } }, icon('copy'), 'کپی متن آگهی'),
        navigator.share ? h('button', { class: 'btn sm ghost', on: { click: () => navigator.share({ text }).catch(() => {}) } }, icon('share'), 'ارسال') : null,
        h('button', { class: 'btn sm accent', on: { click: () => go(`/services/new?kind=content&property=${p.id}`) } }, icon('video'), 'سفارش عکس و ریلز این ملک'))),

    h('div', { class: 'small muted', style: { padding: '4px 2px' } }, `ثبت: ${date(p.createdAt)}${agent ? '، توسط ' + agent.name : ''}، منبع: ${SOURCE[p.source] || 'اپ'}`),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost grow', on: { click: () => go(`/files/${p.id}/edit`) } }, icon('edit'), 'ویرایش'),
      h('button', { class: 'btn danger', on: { click: async () => {
        if (!(await confirmDialog('حذف فایل', 'این فایل از فهرست حذف می‌شود. ادامه می‌دهید؟', { ok: 'حذف', danger: true }))) return;
        try { await api('DELETE', '/api/properties/' + p.id); invalidate(); toast('فایل حذف شد'); go('/files'); } catch (e) { errorToast(e); }
      } } }, icon('trash'), 'حذف')),
  );
  return layout({ title: `فایل #${fa(p.no)}`, content, backTo: '/files', active: '/files' });
});

// ---------------------------------------------------------------- form
export function moneyInput(value, placeholder = '') {
  const input = h('input', { class: 'input num', inputmode: 'numeric', placeholder, dir: 'ltr', value: value != null ? faInt(value) : '' });
  const hint = h('div', { class: 'hint money' }, value ? moneyWords(value) : '');
  input.addEventListener('input', () => {
    const n = parseNumber(input.value.replace(/[٬,]/g, ''));
    hint.textContent = n ? moneyWords(n) : '';
  });
  input.addEventListener('blur', () => {
    const n = parseNumber(input.value.replace(/[٬,]/g, ''));
    input.value = n ? faInt(n) : '';
  });
  return { input, hint, get value() { return parseNumber(input.value.replace(/[٬,]/g, '')); } };
}

export function numInput(value, placeholder = '') {
  return h('input', { class: 'input num', inputmode: 'numeric', placeholder, value: value != null ? fa(value) : '' });
}

export function propertyFields(p = {}) {
  const f = {};
  let deal = p.deal || 'sale';
  let type = p.type || 'apartment';
  const feats = new Set(p.features || []);
  const dealSeg = h('div', { class: 'seg' });
  const priceBox = h('div');
  f.price = moneyInput(p.price, 'مثلاً ۹٬۵۰۰٬۰۰۰٬۰۰۰');
  f.deposit = moneyInput(p.deposit);
  f.rent = moneyInput(p.rent);
  const drawDeal = () => {
    dealSeg.replaceChildren(...Object.entries(DEAL).map(([k, v]) => h('button', { type: 'button', class: [deal === k && 'on'], on: { click: () => { deal = k; drawDeal(); } } }, v)));
    priceBox.replaceChildren(deal === 'rent'
      ? h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'رهن (تومان)'), f.deposit.input, f.deposit.hint), h('div', { class: 'field' }, h('label', null, 'اجاره ماهانه (تومان)'), f.rent.input, f.rent.hint))
      : h('div', { class: 'field' }, h('label', null, deal === 'presale' ? 'قیمت کل پیش‌فروش (تومان)' : 'قیمت کل (تومان)'), f.price.input, f.price.hint));
  };
  drawDeal();
  const typeSel = h('select', { class: 'input', on: { change: (e) => (type = e.target.value) } }, ...Object.entries(TYPE).map(([k, v]) => h('option', { value: k, selected: k === type }, v)));
  const hoodList = h('datalist', { id: 'hoods' }, ...(state.ledger?.hoods || []).map((x) => h('option', { value: x })));
  f.neighborhood = h('input', { class: 'input', list: 'hoods', placeholder: 'مثلاً الهیه', value: p.neighborhood || '' });
  f.address = h('input', { class: 'input', placeholder: 'خیابان، کوچه، پلاک (اختیاری)', value: p.address || '' });
  f.area = numInput(p.area, 'متر');
  f.landArea = numInput(p.landArea, 'متر');
  f.rooms = numInput(p.rooms);
  f.floor = numInput(p.floor, '۰ = همکف');
  f.totalFloors = numInput(p.totalFloors);
  f.buildYear = numInput(p.buildYear, '۱۴۰۰');
  f.ownerName = h('input', { class: 'input', placeholder: 'نام مالک', value: p.ownerName || '' });
  f.ownerPhone = h('input', { class: 'input ltr num', inputmode: 'tel', placeholder: '09...', value: p.ownerPhone ? fa(p.ownerPhone) : '' });
  f.notes = h('textarea', { class: 'input', placeholder: 'توضیحات تکمیلی، شرایط فروش، نکات مالک...' }, p.notes || '');
  const featsEl = h('div', { class: 'chips' }, ...Object.entries(FEATURE).map(([k, [label, ic]]) => {
    const chip = h('button', { type: 'button', class: ['chip', feats.has(k) && 'on'], on: { click: () => { feats.has(k) ? feats.delete(k) : feats.add(k); chip.classList.toggle('on'); } } }, icon(ic), label);
    return chip;
  }));

  const sections = [
    h('div', { class: 'form-section' }, h('h3', null, icon('folder'), 'نوع معامله و ملک'),
      h('div', { class: 'stack' }, dealSeg, h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'نوع ملک'), typeSel), h('div', { class: 'field' }, h('label', null, 'محله'), f.neighborhood, hoodList)),
        h('div', { class: 'field' }, h('label', null, 'آدرس'), f.address))),
    h('div', { class: 'form-section' }, h('h3', null, icon('wallet'), 'قیمت'), priceBox),
    h('div', { class: 'form-section' }, h('h3', null, icon('ruler'), 'مشخصات'),
      h('div', { class: 'grid3' },
        h('div', { class: 'field' }, h('label', null, 'متراژ'), f.area),
        h('div', { class: 'field' }, h('label', null, 'خواب'), f.rooms),
        h('div', { class: 'field' }, h('label', null, 'طبقه'), f.floor),
        h('div', { class: 'field' }, h('label', null, 'تعداد طبقات'), f.totalFloors),
        h('div', { class: 'field' }, h('label', null, 'سال ساخت'), f.buildYear),
        h('div', { class: 'field' }, h('label', null, 'متراژ زمین'), f.landArea))),
    h('div', { class: 'form-section' }, h('h3', null, icon('star'), 'امکانات'), featsEl),
    h('div', { class: 'form-section' }, h('h3', null, icon('phone'), 'مالک و یادداشت'),
      h('div', { class: 'stack' }, h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'نام مالک'), f.ownerName), h('div', { class: 'field' }, h('label', null, 'موبایل مالک'), f.ownerPhone)),
        h('div', { class: 'field' }, h('label', null, 'یادداشت'), f.notes))),
  ];
  const n = (el) => (el.value.trim() === '' ? null : parseNumber(el.value));
  const read = () => ({
    deal, type, features: [...feats],
    neighborhood: f.neighborhood.value, address: f.address.value,
    area: n(f.area), landArea: n(f.landArea), rooms: n(f.rooms), floor: n(f.floor), totalFloors: n(f.totalFloors), buildYear: n(f.buildYear),
    price: deal === 'rent' ? null : f.price.value, deposit: deal === 'rent' ? f.deposit.value : null, rent: deal === 'rent' ? f.rent.value : null,
    ownerName: f.ownerName.value, ownerPhone: en(f.ownerPhone.value), notes: f.notes.value,
  });
  return { sections, read };
}

async function propertyForm(p, pre = null) {
  await loadLedger();
  const { sections, read } = propertyFields(p || pre || {});
  const banner = pre ? h('div', { class: 'alert info', style: { marginBottom: '12px' } }, icon('spark'), h('div', { class: 'small' }, 'مشخصات به صورت خودکار از متن/صدا استخراج شد. بررسی کنید و ثبت را بزنید.')) : null;
  const save = h('button', { class: 'btn primary grow lg', type: 'submit' }, icon('check'), p ? 'ذخیره تغییرات' : 'ثبت فایل');
  const form = h('form', {
    on: {
      submit: async (e) => {
        e.preventDefault();
        busy(save, true, 'در حال ذخیره...');
        try {
          const data = read();
          const r = p ? await api('PATCH', '/api/properties/' + p.id, { ...data, needsReview: false }) : await api('POST', '/api/properties', data);
          invalidate();
          toast(p ? 'تغییرات ذخیره شد' : 'فایل ثبت شد');
          go('/files/' + r.property.id, { replace: true });
        } catch (ex) {
          errorToast(ex);
          busy(save, false);
        }
      },
    },
  }, banner, h('div', { class: 'card' }, sections), h('div', { class: 'sticky-actions' }, save, h('button', { type: 'button', class: 'btn ghost lg', on: { click: () => history.back() } }, 'انصراف')));
  return layout({ title: p ? `ویرایش فایل #${fa(p.no)}` : 'فایل جدید', content: form, backTo: p ? '/files/' + p.id : '/files', active: '/files' });
}
