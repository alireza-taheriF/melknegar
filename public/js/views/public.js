// Public pages (no login): buyers request a technical inspection; anyone can track a request.
import { h, icon, api, fa, money, date, toast, errorToast, busy, parseNumber, clear, copyText } from '../core.js';
import { route, go, state } from '../app.js';
import { ORDER_STATUS } from '../labels.js';
import { catalog, packagePicker } from './services.js';

function publicShell(content, sub) {
  return h('div', null,
    h('header', { class: 'public-head' }, h('div', { class: 'container' },
      h('img', { src: '/img/wordmark-light.png', alt: 'پلاک‌نگار' }),
      state.user ? h('button', { class: 'btn glass sm', on: { click: () => go('/') } }, 'ورود به اپ') : h('button', { class: 'btn glass sm', on: { click: () => go('/login') } }, 'ورود املاکی‌ها')),
      sub ? h('div', { class: 'container', style: { marginTop: '18px' } }, sub) : null),
    h('main', { class: 'container public-body', style: { maxWidth: '760px' } }, content));
}

route('/inspect', async ({ query }) => {
  const cat = await catalog();
  const kind = query.get('kind') === 'content' ? 'content' : 'inspection';
  const def = cat[kind];
  let pkg = def.packages[0].id;
  const startedAt = Date.now();
  const f = {
    name: h('input', { class: 'input', autocomplete: 'name', placeholder: 'نام و نام خانوادگی' }),
    phone: h('input', { class: 'input ltr num', inputmode: 'tel', autocomplete: 'tel', placeholder: '09...' }),
    city: h('input', { class: 'input', value: 'مشهد' }),
    neighborhood: h('input', { class: 'input', placeholder: 'محله' }),
    address: h('input', { class: 'input', placeholder: 'آدرس ملک' }),
    area: h('input', { class: 'input num', inputmode: 'numeric', placeholder: 'متر' }),
    when: h('input', { class: 'input', placeholder: 'روز و ساعت مناسب' }),
    notes: h('textarea', { class: 'input', rows: 3, placeholder: kind === 'inspection' ? 'نوع ملک، نگرانی‌های خاص، قیمت پیشنهادی فروشنده...' : 'توضیحات' }),
    website: h('input', { class: 'input', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' }),
  };
  const honeypot = h('div', { style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap', opacity: '0' } }, h('label', null, 'website'), f.website);
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, icon('send'), 'ثبت درخواست');
  const box = h('div');
  const form = h('form', { on: { submit: async (e) => {
    e.preventDefault();
    busy(btn, true, 'در حال ثبت...');
    try {
      const r = await api('POST', '/api/public/orders', { kind, package: pkg, name: f.name.value, phone: f.phone.value, city: f.city.value, neighborhood: f.neighborhood.value, address: [f.neighborhood.value, f.address.value].filter(Boolean).join('، '), area: parseNumber(f.area.value), preferredAt: f.when.value, notes: f.notes.value, website: f.website.value, startedAt });
      clear(box, h('div', { class: 'card pad stack center' },
        h('div', { class: 'avatar', style: { margin: '0 auto', width: '64px', height: '64px', borderRadius: '20px' } }, icon('check')),
        h('h2', { style: { margin: '0' } }, 'درخواست شما ثبت شد'),
        h('p', { class: 'muted small', style: { margin: '0' } }, 'کارشناس ما به زودی برای هماهنگی زمان بازدید تماس می‌گیرد.'),
        h('div', { class: 'secret-box', style: { textAlign: 'center' } }, r.order.code),
        h('div', { class: 'small muted' }, 'با این کد و شماره موبایلتان می‌توانید وضعیت را پیگیری کنید.'),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost grow', on: { click: () => copyText(r.order.code) } }, icon('copy'), 'کپی کد'), h('button', { class: 'btn primary grow', on: { click: () => go('/track?code=' + r.order.code) } }, 'پیگیری'))));
      window.scrollTo(0, 0);
    } catch (ex) { errorToast(ex); busy(btn, false); }
  } } },
  h('div', { class: 'card' },
    h('div', { class: 'form-section' }, h('h3', null, icon('layers'), 'انتخاب بسته'), packagePicker(def.packages, pkg, (v) => (pkg = v))),
    h('div', { class: 'form-section' }, h('h3', null, icon('pin'), 'مشخصات ملک'), h('div', { class: 'stack' },
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'شهر'), f.city), h('div', { class: 'field' }, h('label', null, 'محله'), f.neighborhood)),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'آدرس'), f.address), h('div', { class: 'field' }, h('label', null, 'متراژ تقریبی'), f.area)))),
    h('div', { class: 'form-section' }, h('h3', null, icon('phone'), 'اطلاعات تماس'), h('div', { class: 'stack' },
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'نام'), f.name), h('div', { class: 'field' }, h('label', null, 'موبایل'), f.phone)),
      h('div', { class: 'field' }, h('label', null, 'زمان مناسب بازدید'), f.when),
      h('div', { class: 'field' }, h('label', null, 'توضیحات'), f.notes), honeypot)),
    h('div', { class: 'form-section' }, btn, h('p', { class: 'tiny muted center', style: { margin: '10px 0 0' } }, 'پرداخت بعد از هماهنگی و تأیید زمان بازدید انجام می‌شود.'))));
  clear(box, form);

  const steps = kind === 'inspection'
    ? [['calendar', 'هماهنگی زمان', 'کارشناس تماس می‌گیرد و زمان بازدید را با شما و فروشنده هماهنگ می‌کند.'], ['shield', 'بازدید مهندس', 'نم، ترک، تأسیسات، مشاعات، سند و پایان‌کار با چک‌لیست بررسی می‌شود.'], ['doc', 'گزارش و قیمت', 'گزارش تصویری، برآورد هزینه تعمیرات و بازه قیمت منصفانه.']]
    : [['calendar', 'هماهنگی', 'زمان مناسب نور و حضور در ملک تنظیم می‌شود.'], ['camera', 'عکاسی و فیلم‌برداری', 'تیم حرفه‌ای با تجهیزات کامل.'], ['video', 'تحویل', 'عکس‌ها و ریلز آماده انتشار.']];
  const intro = h('div', null,
    h('h1', { style: { margin: '0 0 6px', fontSize: '24px', fontWeight: '850' } }, kind === 'inspection' ? 'قبل از خرید خانه، یک مهندس ببیندش' : def.title),
    h('p', { style: { margin: '0', color: 'rgba(255,255,255,.78)', maxWidth: '560px' } }, def.subtitle));
  return publicShell(h('div', { class: 'stack' },
    h('div', { class: 'card pad' }, h('div', { class: 'grid3', style: { gap: '14px' } }, steps.map(([ic, t, d]) => h('div', { class: 'stack', style: { gap: '4px' } }, h('div', { class: 'row', style: { gap: '8px', color: 'var(--teal-500)' } }, icon(ic), h('span', { class: 'strong', style: { color: 'var(--text)' } }, t)), h('div', { class: 'small muted' }, d))))),
    def.note ? h('div', { class: 'alert info' }, icon('info'), h('div', { class: 'small' }, def.note)) : null,
    box,
    h('div', { class: 'center' }, h('button', { class: 'btn ghost', on: { click: () => go('/track') } }, icon('search'), 'پیگیری درخواست قبلی'))), intro);
}, { public: true });

route('/track', async ({ query }) => {
  const code = h('input', { class: 'input ltr', placeholder: 'MN-1001', value: query.get('code') || '' });
  const phone = h('input', { class: 'input ltr num', inputmode: 'tel', placeholder: '09...' });
  const out = h('div');
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'پیگیری');
  const cat = await catalog();
  const form = h('form', { class: 'card pad stack', on: { submit: async (e) => {
    e.preventDefault();
    busy(btn, true);
    try {
      const r = await api('GET', `/api/public/track?code=${encodeURIComponent(code.value.trim())}&phone=${encodeURIComponent(phone.value)}`);
      const o = r.order;
      clear(out, h('div', { class: 'card pad stack' },
        h('div', { class: 'row spread' }, h('div', { class: 'strong' }, `${o.code}، ${cat[o.kind]?.title}`), h('span', { class: ['badge', 'b-' + o.status] }, ORDER_STATUS[o.status])),
        h('div', { class: 'small muted' }, `ثبت: ${date(o.createdAt)}`),
        o.scheduledAt ? h('div', { class: 'small' }, 'زمان بازدید: ', h('span', { class: 'strong' }, o.scheduledAt)) : null,
        h('div', { class: 'small' }, 'هزینه: ', h('span', { class: 'strong' }, money(o.price)))));
    } catch (ex) { clear(out, h('div', { class: 'alert danger' }, icon('alert'), ex.message)); }
    busy(btn, false);
  } } },
  h('div', { class: 'field' }, h('label', null, 'کد پیگیری'), code), h('div', { class: 'field' }, h('label', null, 'موبایل ثبت‌شده'), phone), btn);
  return publicShell(h('div', { class: 'stack' }, form, out, h('div', { class: 'center' }, h('button', { class: 'btn ghost', on: { click: () => go('/inspect') } }, 'ثبت درخواست جدید'))),
    h('h1', { style: { margin: '0', fontSize: '22px' } }, 'پیگیری درخواست'));
}, { public: true });
