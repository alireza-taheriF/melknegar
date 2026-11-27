import { h, icon, api, busy, errorToast, toast } from '../core.js';
import { route, go, state } from '../app.js';

route('/login', () => {
  if (state.user) {
    setTimeout(() => go('/', { replace: true }));
    return h('div');
  }
  const idInput = h('input', { class: 'input', name: 'username', autocomplete: 'username', inputmode: 'text', placeholder: 'موبایل یا نام کاربری', required: true, dir: 'auto' });
  const pwInput = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', placeholder: 'رمز عبور', required: true, dir: 'ltr' });
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, 'ورود به ملک‌نگار');
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
          const r = await api('POST', '/api/auth/login', { identifier: idInput.value, password: pwInput.value });
          const me = await api('GET', '/api/auth/me');
          state.user = me.user;
          state.ai = me.ai;
          state.bots = me.bots;
          go(r.user.mustChange ? '/password' : '/');
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

  const point = (ic, t, d) => h('div', { class: 'point' }, icon(ic), h('div', null, h('div', { class: 'strong' }, t), h('div', { class: 'small', style: { opacity: '0.75' } }, d)));

  return h('div', { class: 'auth' },
    h('section', { class: 'auth-art' },
      h('img', { src: '/img/wordmark-light.png', alt: 'ملک‌نگار', style: { height: '46px', width: 'auto', position: 'relative' } }),
      h('div', null,
        h('h2', null, 'دفتر املاکی‌تان، این بار هوشمند.'),
        h('p', null, 'فایل‌ها و مشتری‌ها یک‌جا، جستجو در یک ثانیه، ثبت با پیام صوتی و عکس از دفتر قدیمی.'),
        h('div', { class: 'points' },
          point('mic', 'ثبت با صدا و پیام در بله و تلگرام', 'فایل را بگویید؛ ملک‌نگار خودش ثبتش می‌کند.'),
          point('camera', 'دیجیتال‌کردن دفترهای قدیمی', 'از صفحه دفتر عکس بگیرید؛ همه فایل‌ها استخراج می‌شود.'),
          point('target', 'تطبیق خودکار فایل و مشتری', 'برای هر خریدار، مناسب‌ترین فایل‌ها با درصد تطابق.'),
          point('video', 'تیم محتوا و بازدید فنی', 'عکاس، ریلز و مهندس بازدید، با یک سفارش.'))),
      h('div', { class: 'small', style: { opacity: '0.55', position: 'relative' } }, '© ملک‌نگار')),
    h('section', { class: 'auth-form' },
      h('img', { class: 'mark', src: '/img/mark.png', alt: '' }),
      h('img', { class: 'logo', src: '/img/wordmark.png', alt: 'ملک‌نگار', style: { height: '44px' } }),
      h('p', { class: 'center muted small', style: { margin: '4px 0 22px' } }, 'دفتر هوشمند املاکی'),
      h('div', { class: 'card pad' }, form),
      h('div', { class: 'alert info', style: { marginTop: '14px' } }, icon('bot'), h('div', { class: 'small' }, 'اگر حسابتان به ربات بله یا تلگرام وصل است، در ربات بنویسید «ورود» تا لینک ورود بگیرید.')),
      h('div', { class: 'divider' }, 'خریدار ملک هستید؟'),
      h('button', { class: 'btn ghost block', on: { click: () => go('/inspect') } }, icon('shield'), 'درخواست بازدید فنی قبل از خرید'),
    ));
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
          go('/');
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

  return h('div', { class: 'auth' }, h('section', { class: 'auth-art' }),
    h('section', { class: 'auth-form' },
      h('img', { class: 'logo', src: '/img/wordmark.png', alt: 'ملک‌نگار', style: { height: '40px' } }),
      h('h1', null, forced ? 'تعیین رمز عبور شخصی' : 'تغییر رمز عبور'),
      h('p', { class: 'center muted small' }, state.user?.name || ''),
      h('div', { class: 'card pad' }, form),
      forced ? null : h('button', { class: 'btn ghost block', style: { marginTop: '12px' }, on: { click: () => go('/settings') } }, 'بازگشت')));
});
