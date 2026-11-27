import { h, icon, api, busy, errorToast, toast, wordmark } from '../core.js';
import { route, go, state } from '../app.js';

const homeFor = (u) => (u.mustChange ? '/password' : u.staff && !u.tenantId ? '/admin' : '/');

async function afterAuth() {
  const me = await api('GET', '/api/auth/me');
  state.user = me.user;
  state.ai = me.ai;
  state.bots = me.bots;
  state.ledger = null;
  go(homeFor(me.user));
}

function authShell(formCard, below) {
  const point = (ic, t, d) => h('div', { class: 'point' }, icon(ic), h('div', null, h('div', { class: 'strong' }, t), h('div', { class: 'small muted' }, d)));
  return h('div', { class: 'auth' },
    h('section', { class: 'auth-art' },
      h('img', { src: '/img/wordmark-light.png', alt: 'پلاک‌نگار', style: { height: '40px', width: 'auto', position: 'relative' } }),
      h('div', null,
        h('h2', null, 'دفتر املاکی‌تان، این بار هوشمند.'),
        h('p', null, 'فایل‌ها و مشتری‌ها یک‌جا، جستجو در یک ثانیه، ثبت با پیام صوتی و عکس از دفتر قدیمی.'),
        h('div', { class: 'points' },
          point('mic', 'ثبت با صدا و پیام در بله و تلگرام', 'فایل را بگویید؛ پلاک‌نگار خودش ثبتش می‌کند.'),
          point('camera', 'دیجیتال‌کردن دفترهای قدیمی', 'از صفحه دفتر عکس بگیرید؛ همه فایل‌ها استخراج می‌شود.'),
          point('target', 'تطبیق خودکار فایل و مشتری', 'برای هر خریدار، مناسب‌ترین فایل‌ها با درصد تطابق.'),
          point('video', 'تیم محتوا و بازدید فنی', 'عکاس، ریلز و مهندس بازدید، با یک سفارش.'))),
      h('div', { class: 'small muted', style: { position: 'relative' } }, '© پلاک‌نگار')),
    h('section', { class: 'auth-form' },
      h('img', { class: 'mark only-light', src: '/img/mark.png', alt: '' }),
      h('img', { class: 'mark only-dark', src: '/img/mark-light.png', alt: '' }),
      wordmark({ class: 'logo', style: { height: '40px', width: 'auto', margin: '0 auto' } }),
      h('p', { class: 'center muted small', style: { margin: '8px 0 22px' } }, 'دفتر هوشمند املاکی'),
      formCard,
      ...below));
}

route('/login', () => {
  if (state.user) {
    setTimeout(() => go(homeFor(state.user), { replace: true }));
    return h('div');
  }
  const idInput = h('input', { class: 'input', name: 'username', autocomplete: 'username', inputmode: 'text', placeholder: 'مثلاً ۰۹۱۵۱۲۳۴۵۶۷', required: true, dir: 'auto' });
  const pwInput = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', placeholder: 'رمز عبور', required: true, dir: 'ltr' });
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, 'ورود');
  const err = h('div', { class: 'alert danger', hidden: true });
  const show = h('button', { type: 'button', class: 'icon-btn plain', 'aria-label': 'نمایش رمز', on: { click: () => (pwInput.type = pwInput.type === 'password' ? 'text' : 'password') } }, icon('eye'));

  const form = h('form', {
    class: 'stack',
    on: {
      submit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        busy(btn, true, 'در حال ورود...');
        try {
          await api('POST', '/api/auth/login', { identifier: idInput.value, password: pwInput.value });
          await afterAuth();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
          busy(btn, false);
        }
      },
    },
  },
  h('div', { class: 'field' }, h('label', null, 'موبایل یا نام کاربری'), idInput),
  h('div', { class: 'field' }, h('label', null, 'رمز عبور'), h('div', { class: 'row' }, pwInput, show)),
  err,
  btn);

  return authShell(h('div', { class: 'card pad' }, form), [
    h('div', { class: 'auth-switch' }, 'املاکی هستید و حساب ندارید؟', h('button', { on: { click: () => go('/signup') } }, 'ثبت‌نام رایگان')),
    h('div', { class: 'alert info', style: { marginTop: '14px' } }, icon('bot'), h('div', { class: 'small' }, 'اگر حسابتان به ربات بله یا تلگرام وصل است، در ربات بنویسید «ورود» تا لینک ورود بگیرید.')),
    h('div', { class: 'divider' }, 'خریدار ملک هستید؟'),
    h('button', { class: 'btn ghost block', on: { click: () => go('/inspect') } }, icon('shield'), 'درخواست بازدید فنی قبل از خرید'),
  ]);
}, { public: true });

route('/signup', () => {
  if (state.user) {
    setTimeout(() => go(homeFor(state.user), { replace: true }));
    return h('div');
  }
  const startedAt = Date.now();
  const f = {
    agency: h('input', { class: 'input', name: 'organization', autocomplete: 'organization', placeholder: 'مثلاً املاک آرین', required: true, maxlength: 80 }),
    name: h('input', { class: 'input', name: 'name', autocomplete: 'name', placeholder: 'نام و نام خانوادگی مدیر', required: true, maxlength: 80 }),
    phone: h('input', { class: 'input ltr', name: 'tel', type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '09151234567', required: true, dir: 'ltr' }),
    city: h('input', { class: 'input', name: 'city', autocomplete: 'address-level2', value: 'مشهد', maxlength: 40 }),
    password: h('input', { class: 'input', name: 'new-password', type: 'password', autocomplete: 'new-password', minlength: 8, required: true, dir: 'ltr', placeholder: 'حداقل ۸ کاراکتر' }),
    website: h('input', { name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', style: { position: 'absolute', opacity: '0', height: '1px', width: '1px', pointerEvents: 'none', clipPath: 'inset(50%)' } }),
  };
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, 'ساخت حساب املاکی');
  const err = h('div', { class: 'alert danger', hidden: true });
  const form = h('form', {
    class: 'stack',
    on: {
      submit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        busy(btn, true, 'در حال ساخت حساب...');
        try {
          await api('POST', '/api/auth/signup', {
            agency: f.agency.value, name: f.name.value, phone: f.phone.value, city: f.city.value,
            password: f.password.value, website: f.website.value, startedAt,
          });
          toast('حساب املاکی شما ساخته شد');
          await afterAuth();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
          busy(btn, false);
        }
      },
    },
  },
  h('div', { class: 'field' }, h('label', null, 'نام املاکی'), f.agency),
  h('div', { class: 'field' }, h('label', null, 'نام مدیر'), f.name),
  h('div', { class: 'grid2' },
    h('div', { class: 'field' }, h('label', null, 'موبایل'), f.phone),
    h('div', { class: 'field' }, h('label', null, 'شهر'), f.city)),
  h('div', { class: 'field' }, h('label', null, 'رمز عبور'), f.password, h('div', { class: 'hint' }, 'با همین موبایل و رمز وارد می‌شوید.')),
  f.website,
  err,
  btn,
  h('p', { class: 'tiny muted center', style: { margin: '0' } }, 'فایل‌ها و مشتری‌های هر املاکی فقط برای همان املاکی قابل مشاهده است.'));

  return authShell(h('div', { class: 'card pad' }, h('h1', { style: { margin: '0 0 14px', fontSize: '18px', textAlign: 'start' } }, 'ثبت‌نام املاکی'), form), [
    h('div', { class: 'auth-switch' }, 'قبلاً ثبت‌نام کرده‌اید؟', h('button', { on: { click: () => go('/login') } }, 'ورود')),
  ]);
}, { public: true });

route('/password', () => {
  const forced = state.user?.mustChange;
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', dir: 'ltr' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', dir: 'ltr', minlength: 8 });
  const rep = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', dir: 'ltr' });
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, 'ذخیره رمز جدید');
  const form = h('form', {
    class: 'stack',
    on: {
      submit: async (e) => {
        e.preventDefault();
        if (next.value !== rep.value) return errorToast(new Error('تکرار رمز با رمز جدید یکی نیست'));
        busy(btn, true);
        try {
          await api('POST', '/api/auth/password', { current: cur.value, next: next.value });
          state.user.mustChange = false;
          toast('رمز عبور تغییر کرد');
          go(homeFor(state.user));
        } catch (ex) {
          errorToast(ex);
          busy(btn, false);
        }
      },
    },
  },
  forced ? h('div', { class: 'alert warn' }, icon('key'), h('div', { class: 'small' }, 'برای امنیت حساب، رمز موقت را با یک رمز شخصی عوض کنید.')) : null,
  forced ? null : h('div', { class: 'field' }, h('label', null, 'رمز فعلی'), cur),
  h('div', { class: 'field' }, h('label', null, 'رمز جدید'), next, h('div', { class: 'hint' }, 'حداقل ۸ کاراکتر؛ ترکیب حروف و عدد امن‌تر است.')),
  h('div', { class: 'field' }, h('label', null, 'تکرار رمز جدید'), rep),
  btn,
  forced ? h('button', { type: 'button', class: 'btn ghost block', on: { click: async () => { await api('POST', '/api/auth/logout').catch(() => {}); state.user = null; go('/login'); } } }, 'خروج') : null);

  return h('div', { class: 'auth' }, h('section', { class: 'auth-art' }, h('img', { src: '/img/wordmark-light.png', alt: 'پلاک‌نگار', style: { height: '40px', width: 'auto', position: 'relative' } })),
    h('section', { class: 'auth-form' },
      wordmark({ class: 'logo', style: { height: '36px', width: 'auto', margin: '0 auto' } }),
      h('h1', null, forced ? 'تعیین رمز عبور شخصی' : 'تغییر رمز عبور'),
      h('p', { class: 'center muted small' }, state.user?.name || ''),
      h('div', { class: 'card pad' }, form),
      forced ? null : h('button', { class: 'btn ghost block', style: { marginTop: '12px' }, on: { click: () => go('/settings') } }, 'بازگشت')));
});
