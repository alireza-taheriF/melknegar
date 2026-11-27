import { h, icon, api, fa, money, ago, parseNumber, toast, errorToast, confirmDialog, busy, initials, en } from '../core.js';
import { route, layout, loadLedger, go, invalidate, state } from '../app.js';
import { DEAL, TYPE, TYPE_SHORT, FEATURE, CSTATUS, SOURCE } from '../labels.js';
import { matchScore } from './home.js';
import { propertyRow, moneyInput, numInput } from './properties.js';

export function budgetLabel(c) {
  if (c.deal === 'rent') {
    const parts = [];
    if (c.depositMax) parts.push('رهن تا ' + money(c.depositMax, { unit: false }));
    if (c.rentMax) parts.push('اجاره تا ' + money(c.rentMax, { unit: false }));
    return parts.join(' / ');
  }
  if (c.budgetMin && c.budgetMax) return `${money(c.budgetMin, { unit: false })} تا ${money(c.budgetMax, { unit: false })}`;
  if (c.budgetMax) return 'تا ' + money(c.budgetMax, { unit: false });
  if (c.budgetMin) return 'از ' + money(c.budgetMin, { unit: false });
  return '';
}

export function clientRow(c, L) {
  const count = L.properties.filter((p) => matchScore(p, c) >= 70).length;
  return h('div', { class: 'prow', role: 'link', tabindex: '0', on: { click: () => go('/clients/' + c.id), keydown: (e) => e.key === 'Enter' && go('/clients/' + c.id) } },
    h('div', { class: 'avatar' }, initials(c.name || 'م')),
    h('div', { class: 'body' },
      h('div', { class: 'title' }, h('span', { class: 'ellipsis' }, c.name || 'مشتری بدون نام'), h('span', { class: 'muted tiny num' }, '#' + fa(c.no))),
      h('div', { class: 'meta' },
        h('span', null, DEAL[c.deal] + (c.types?.length ? '، ' + c.types.map((t) => TYPE_SHORT[t]).join('، ') : '')),
        c.neighborhoods?.length ? h('span', null, icon('pin'), c.neighborhoods.slice(0, 3).join('، ')) : null),
      h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '2px' } },
        c.status !== 'active' ? h('span', { class: 'badge b-sold' }, CSTATUS[c.status]) : null,
        c.needsReview ? h('span', { class: 'badge b-review' }, icon('bot'), 'نیاز به بررسی') : null,
        count ? h('span', { class: 'badge b-active' }, icon('target'), fa(count) + ' فایل مناسب') : null)),
    h('div', { class: 'side' },
      h('div', { class: 'price small' }, c.deal === 'rent'
        ? [c.depositMax ? h('span', { class: 'l2' }, 'رهن تا ' + money(c.depositMax, { unit: false })) : null, c.rentMax ? h('span', { class: 'l2' }, 'اجاره تا ' + money(c.rentMax, { unit: false })) : null]
        : budgetLabel(c)),
      h('div', { class: 'tiny muted' }, ago(c.updatedAt))));
}

route('/clients', async ({ query }) => {
  const L = await loadLedger();
  let q = query.get('q') || '';
  let st = 'active';
  const listEl = h('div');
  const chips = h('div', { class: 'scroll-x' });
  const norm = (s) => en(String(s || '')).replace(/[‌\s]+/g, ' ');
  function apply() {
    const words = norm(q).trim().split(' ').filter(Boolean);
    let items = L.clients.filter((c) => (st === 'all' ? true : st === 'review' ? c.needsReview : c.status === st));
    if (words.length) items = items.filter((c) => words.every((w) => norm([c.no, c.name, c.phone, c.notes, (c.neighborhoods || []).join(' '), DEAL[c.deal]].join(' ')).includes(w)));
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    listEl.replaceChildren(items.length
      ? h('div', { class: 'list' }, items.map((c) => clientRow(c, L)))
      : h('div', { class: 'card empty' }, icon('users'), h('h3', null, 'مشتری‌ای نیست'), h('p', { class: 'small' }, 'نیاز خریدار یا مستاجر را ثبت کنید تا فایل‌های مناسب خودکار پیدا شوند.'), h('button', { class: 'btn primary', on: { click: () => go('/clients/new') } }, icon('plus'), 'مشتری جدید')));
    chips.replaceChildren(...[['active', 'در جستجو'], ['all', 'همه'], ['done', 'به نتیجه رسید'], ['review', 'از ربات']].map(([k, v]) => h('button', { class: ['chip', st === k && 'on'], on: { click: () => { st = k; apply(); } } }, v)));
  }
  apply();
  const content = h('div', null,
    h('div', { class: 'searchbar' }, icon('search'), h('input', { class: 'input', type: 'search', placeholder: 'نام، موبایل، محله...', value: q, on: { input: (e) => { q = e.target.value; apply(); } } })),
    h('div', { class: 'row spread', style: { margin: '12px 0' } }, chips, h('button', { class: 'btn sm ghost', on: { click: () => go('/clients/new') } }, icon('plus'), 'مشتری جدید')),
    listEl);
  return layout({ title: 'مشتری‌ها', content, active: '/clients' });
});

route('/clients/new', async () => {
  const pre = state.prefill?.kind === 'client' ? state.prefill.data : null;
  state.prefill = null;
  return clientForm(null, pre);
});
route('/clients/:id/edit', async ({ params }) => {
  const L = await loadLedger();
  const c = L.clients.find((x) => x.id === params.id);
  return c ? clientForm(c) : go('/clients', { replace: true }) || h('div');
});

route('/clients/:id', async ({ params }) => {
  const L = await loadLedger(true);
  const c = L.clients.find((x) => x.id === params.id);
  if (!c) return go('/clients', { replace: true }) || h('div');
  const matches = L.properties.map((p) => ({ p, sc: matchScore(p, c) })).filter((x) => x.sc >= 55).sort((a, b) => b.sc - a.sc).slice(0, 20);
  const setStatus = async (status) => {
    try { await api('PATCH', '/api/clients/' + c.id, { status }); invalidate(); toast('به‌روز شد'); go('/clients/' + c.id, { replace: true }); } catch (e) { errorToast(e); }
  };
  const kv = (k, v) => (v ? h('div', null, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)) : null);
  const content = h('div', { class: 'stack' },
    c.needsReview ? h('div', { class: 'alert info' }, icon('bot'), h('div', { class: 'grow small' }, `این مشتری از ${SOURCE[c.source] || 'ربات'} ثبت شده؛ بررسی و تأیید کنید.`),
      h('button', { class: 'btn sm primary', on: { click: async () => { await api('PATCH', '/api/clients/' + c.id, { needsReview: false }); invalidate(); go('/clients/' + c.id, { replace: true }); } } }, 'تأیید')) : null,
    h('div', { class: 'card owner-card' },
      h('div', { class: 'avatar' }, initials(c.name || 'م')),
      h('div', { class: 'grow' }, h('div', { class: 'strong' }, c.name || 'مشتری #' + fa(c.no)), h('div', { class: 'small muted ltr num', style: { textAlign: 'right' } }, fa(c.phone || 'بدون شماره'))),
      c.phone ? h('a', { class: 'btn sm primary', href: 'tel:' + c.phone }, icon('phone'), 'تماس') : null),
    h('div', { class: 'kv' },
      kv('نوع معامله', DEAL[c.deal]),
      kv('نوع ملک', c.types?.map((t) => TYPE_SHORT[t]).join('، ')),
      kv('بودجه', budgetLabel(c)),
      kv('متراژ', c.areaMin && c.areaMax ? `${fa(c.areaMin)} تا ${fa(c.areaMax)} متر` : c.areaMin ? `حداقل ${fa(c.areaMin)} متر` : c.areaMax ? `حداکثر ${fa(c.areaMax)} متر` : ''),
      kv('حداقل خواب', c.roomsMin != null ? fa(c.roomsMin) : ''),
      kv('محله‌ها', c.neighborhoods?.join('، '))),
    c.features?.length ? h('div', { class: 'feature-list' }, c.features.map((f) => h('span', { class: 'feature' }, icon(FEATURE[f]?.[1] || 'check'), FEATURE[f]?.[0]))) : null,
    c.notes ? h('div', { class: 'card pad notes' }, c.notes) : null,
    h('div', { class: 'seg' }, ...Object.entries(CSTATUS).map(([k, v]) => h('button', { class: [c.status === k && 'on'], on: { click: () => c.status !== k && setStatus(k) } }, v))),
    h('div', { class: 'section' }, h('h2', null, `فایل‌های مناسب (${fa(matches.length)})`), h('span', { class: 'tiny muted' }, 'مرتب‌شده بر اساس درصد تطابق')),
    matches.length
      ? h('div', { class: 'list' }, matches.map(({ p, sc }) => {
          const ring = h('div', { class: 'ring' }, fa(sc) + '٪');
          ring.style.setProperty('--p', sc);
          const row = propertyRow(p, L);
          row.prepend(ring);
          row.querySelector('.thumb')?.remove();
          return row;
        }))
      : h('div', { class: 'card pad small muted' }, 'فعلاً فایل مناسبی نیست. هر فایل جدیدی که ثبت شود، اینجا بررسی می‌شود.'),
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn ghost grow', on: { click: () => go(`/clients/${c.id}/edit`) } }, icon('edit'), 'ویرایش'),
      h('button', { class: 'btn danger', on: { click: async () => {
        if (!(await confirmDialog('حذف مشتری', 'این مشتری حذف می‌شود. ادامه می‌دهید؟', { ok: 'حذف', danger: true }))) return;
        try { await api('DELETE', '/api/clients/' + c.id); invalidate(); toast('حذف شد'); go('/clients'); } catch (e) { errorToast(e); }
      } } }, icon('trash'), 'حذف')));
  return layout({ title: c.name || 'مشتری', content, backTo: '/clients', active: '/clients' });
});

export function clientFields(c = {}) {
  let deal = c.deal || 'sale';
  const types = new Set(c.types || []);
  const feats = new Set(c.features || []);
  const f = {
    name: h('input', { class: 'input', placeholder: 'مثلاً آقای مرادی', value: c.name || '' }),
    phone: h('input', { class: 'input ltr num', inputmode: 'tel', placeholder: '09...', value: c.phone ? fa(c.phone) : '' }),
    budgetMin: moneyInput(c.budgetMin), budgetMax: moneyInput(c.budgetMax), depositMax: moneyInput(c.depositMax), rentMax: moneyInput(c.rentMax),
    areaMin: numInput(c.areaMin, 'از'), areaMax: numInput(c.areaMax, 'تا'), roomsMin: numInput(c.roomsMin),
    hoods: h('input', { class: 'input', placeholder: 'با ویرگول جدا کنید: الهیه، فرامرز', value: (c.neighborhoods || []).join('، ') }),
    notes: h('textarea', { class: 'input', placeholder: 'شرایط خاص، زمان نیاز، نحوه پرداخت...' }, c.notes || ''),
  };
  const dealSeg = h('div', { class: 'seg' });
  const budget = h('div');
  const draw = () => {
    dealSeg.replaceChildren(...Object.entries(DEAL).map(([k, v]) => h('button', { type: 'button', class: [deal === k && 'on'], on: { click: () => { deal = k; draw(); } } }, v)));
    budget.replaceChildren(deal === 'rent'
      ? h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'حداکثر رهن'), f.depositMax.input, f.depositMax.hint), h('div', { class: 'field' }, h('label', null, 'حداکثر اجاره'), f.rentMax.input, f.rentMax.hint))
      : h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'بودجه از'), f.budgetMin.input, f.budgetMin.hint), h('div', { class: 'field' }, h('label', null, 'بودجه تا'), f.budgetMax.input, f.budgetMax.hint)));
  };
  draw();
  const typeChips = h('div', { class: 'chips' }, ...Object.entries(TYPE_SHORT).map(([k, v]) => {
    const el = h('button', { type: 'button', class: ['chip', types.has(k) && 'on'], on: { click: () => { types.has(k) ? types.delete(k) : types.add(k); el.classList.toggle('on'); } } }, v);
    return el;
  }));
  const featChips = h('div', { class: 'chips' }, ...['parking', 'elevator', 'storage', 'balcony', 'yard', 'renovated'].map((k) => {
    const el = h('button', { type: 'button', class: ['chip', feats.has(k) && 'on'], on: { click: () => { feats.has(k) ? feats.delete(k) : feats.add(k); el.classList.toggle('on'); } } }, icon(FEATURE[k][1]), FEATURE[k][0]);
    return el;
  }));
  const sections = [
    h('div', { class: 'form-section' }, h('h3', null, icon('users'), 'مشخصات مشتری'), h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'نام'), f.name), h('div', { class: 'field' }, h('label', null, 'موبایل'), f.phone))),
    h('div', { class: 'form-section' }, h('h3', null, icon('target'), 'چه می‌خواهد؟'), h('div', { class: 'stack' }, dealSeg, h('div', { class: 'field' }, h('label', null, 'نوع ملک'), typeChips), budget,
      h('div', { class: 'grid3' }, h('div', { class: 'field' }, h('label', null, 'متراژ از'), f.areaMin), h('div', { class: 'field' }, h('label', null, 'متراژ تا'), f.areaMax), h('div', { class: 'field' }, h('label', null, 'حداقل خواب'), f.roomsMin)),
      h('div', { class: 'field' }, h('label', null, 'محله‌های مورد نظر'), f.hoods), h('div', { class: 'field' }, h('label', null, 'امکانات ضروری'), featChips))),
    h('div', { class: 'form-section' }, h('h3', null, icon('doc'), 'یادداشت'), f.notes),
  ];
  const n = (el) => (el.value.trim() === '' ? null : parseNumber(el.value));
  const read = () => ({
    name: f.name.value, phone: en(f.phone.value), deal, types: [...types], features: [...feats],
    budgetMin: deal === 'rent' ? null : f.budgetMin.value, budgetMax: deal === 'rent' ? null : f.budgetMax.value,
    depositMax: deal === 'rent' ? f.depositMax.value : null, rentMax: deal === 'rent' ? f.rentMax.value : null,
    areaMin: n(f.areaMin), areaMax: n(f.areaMax), roomsMin: n(f.roomsMin),
    neighborhoods: f.hoods.value.split(/[،,]/).map((s) => s.trim()).filter(Boolean), notes: f.notes.value,
  });
  return { sections, read };
}

async function clientForm(c, pre = null) {
  const { sections, read } = clientFields(c || pre || {});
  const save = h('button', { class: 'btn primary grow lg', type: 'submit' }, icon('check'), c ? 'ذخیره' : 'ثبت مشتری');
  const form = h('form', { on: { submit: async (e) => {
    e.preventDefault();
    busy(save, true);
    try {
      const r = c ? await api('PATCH', '/api/clients/' + c.id, { ...read(), needsReview: false }) : await api('POST', '/api/clients', read());
      invalidate();
      toast('ذخیره شد');
      go('/clients/' + r.client.id, { replace: true });
    } catch (ex) { errorToast(ex); busy(save, false); }
  } } }, h('div', { class: 'card' }, sections), h('div', { class: 'sticky-actions' }, save, h('button', { type: 'button', class: 'btn ghost lg', on: { click: () => history.back() } }, 'انصراف')));
  return layout({ title: c ? 'ویرایش مشتری' : 'مشتری جدید', content: form, backTo: c ? '/clients/' + c.id : '/clients', active: '/clients' });
}
