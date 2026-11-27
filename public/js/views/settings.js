import { h, icon, api, fa, toast, errorToast, sheet, busy, confirmDialog, copyText, initials } from '../core.js';
import { route, layout, state, go, loadLedger, invalidate, render } from '../app.js';
import { ROLE, STAFF } from '../labels.js';

export function secretSheet(title, login, pw, note) {
  sheet((close) => h('div', { class: 'stack' },
    h('h3', null, title),
    h('div', { class: 'alert warn' }, icon('key'), h('div', { class: 'small' }, note || 'این رمز فقط یک بار نمایش داده می‌شود. آن را برای کاربر بفرستید؛ در اولین ورود باید رمز شخصی بگذارد.')),
    h('div', { class: 'field' }, h('label', null, 'نام کاربری / موبایل'), h('div', { class: 'secret-box' }, login)),
    h('div', { class: 'field' }, h('label', null, 'رمز موقت'), h('div', { class: 'secret-box' }, pw)),
    h('button', { class: 'btn ghost block', on: { click: () => copyText(`ورود به پلاک‌نگار\n${location.origin}\nنام کاربری: ${login}\nرمز موقت: ${pw}`) } }, icon('copy'), 'کپی اطلاعات ورود'),
    h('button', { class: 'btn primary block', on: { click: close } }, 'متوجه شدم')));
}

route('/settings', async () => {
  const u = state.user;
  const L = u.tenantId ? await loadLedger() : null;
  const me = await api('GET', '/api/auth/me');
  state.bots = me.bots;
  Object.assign(state.user, me.user);

  const botRow = (platform, label, linked) => {
    const conf = state.bots?.[platform];
    return h('div', { class: 'row', style: { padding: '13px 14px' } },
      h('div', { class: 'avatar sm', style: { background: platform === 'telegram' ? 'linear-gradient(135deg,#2aa3df,#1c84c6)' : 'linear-gradient(135deg,#3fc28c,#1d9c6b)' } }, icon('send')),
      h('div', { class: 'grow' }, h('div', { class: 'strong small' }, label), h('div', { class: 'tiny muted' }, !conf?.connected ? 'ربات هنوز توسط مدیر پلتفرم راه‌اندازی نشده' : linked ? 'متصل است — پیام، صدا و عکس بفرستید' : '@' + conf.username)),
      linked
        ? h('button', { class: 'btn sm ghost', on: { click: async () => { if (!(await confirmDialog('قطع اتصال ربات', `اتصال ${label} از حساب شما قطع شود؟`))) return; await api('POST', '/api/bot-unlink', { platform }).catch(errorToast); render(); } } }, 'قطع')
        : h('button', { class: 'btn sm primary', disabled: !conf?.connected, on: { click: (e) => linkBot(platform, label, e.currentTarget) } }, 'اتصال'));
  };

  const pwaInstalled = window.matchMedia('(display-mode: standalone)').matches;
  const content = h('div', { class: 'stack' },
    h('div', { class: 'card owner-card' },
      h('div', { class: 'avatar' }, initials(u.name)),
      h('div', { class: 'grow' }, h('div', { class: 'strong' }, u.name), h('div', { class: 'small muted' }, [u.staff ? STAFF[u.staff] : ROLE[u.role], u.tenantName].filter(Boolean).join('، ')), h('div', { class: 'tiny muted ltr', style: { textAlign: 'right' } }, fa(u.phone || u.username)))),

    h('div', { class: 'section' }, h('h2', null, 'اتصال ربات بله و تلگرام')),
    h('div', { class: 'list' }, botRow('bale', 'ربات بله', u.bale), botRow('telegram', 'ربات تلگرام', u.telegram)),
    h('div', { class: 'small muted', style: { padding: '0 4px' } }, 'بعد از اتصال، هر متن، پیام صوتی یا عکس صفحه دفتر را به ربات بفرستید تا به فایل تبدیل شود. با نوشتن «ورود» هم لینک ورود به اپ می‌گیرید.'),

    !pwaInstalled ? [
      h('div', { class: 'section' }, h('h2', null, 'نصب اپ روی گوشی')),
      h('div', { class: 'card pad stack' },
        state.installPrompt
          ? h('button', { class: 'btn accent block', on: { click: () => { state.installPrompt.prompt(); state.installPrompt = null; } } }, icon('download'), 'نصب پلاک‌نگار')
          : h('div', { class: 'small text-2' }, 'اندروید (کروم): منوی سه‌نقطه ← «افزودن به صفحه اصلی» یا «نصب برنامه».', h('br'), 'آیفون (سافاری): دکمه اشتراک‌گذاری ← ', h('span', { class: 'ltr' }, 'Add to Home Screen'))),
    ] : null,

    L && (u.role === 'owner' || u.staff) ? teamSection(L) : null,

    h('div', { class: 'section' }, h('h2', null, 'امنیت حساب')),
    h('div', { class: 'list' },
      h('button', { class: 'prow', style: { border: '0', width: '100%', background: 'none', textAlign: 'start' }, on: { click: () => go('/password') } }, h('div', { class: 'grow strong small' }, 'تغییر رمز عبور'), icon('chevron')),
      h('button', { class: 'prow', style: { border: '0', width: '100%', background: 'none', textAlign: 'start' }, on: { click: async () => {
        if (!(await confirmDialog('خروج از همه دستگاه‌ها', 'همه نشست‌ها (از جمله همین دستگاه) بسته می‌شوند.'))) return;
        await api('POST', '/api/auth/logout-all').catch(() => {});
        state.user = null;
        go('/login');
      } } }, h('div', { class: 'grow strong small' }, 'خروج از همه دستگاه‌ها'), icon('chevron'))),

    h('button', { class: 'btn danger block', on: { click: async () => { await api('POST', '/api/auth/logout').catch(() => {}); state.user = null; state.ledger = null; go('/login'); } } }, icon('logout'), 'خروج از حساب'),
    h('div', { class: 'center tiny muted' }, 'پلاک‌نگار، نسخه ۱.۰'));
  return layout({ title: 'تنظیمات', content, backTo: '/', active: '/settings' });
});

async function linkBot(platform, label, btn) {
  busy(btn, true);
  try {
    const r = await api('POST', '/api/bot-link');
    busy(btn, false);
    const link = r.links[platform];
    if (!link) return errorToast(new Error('این ربات راه‌اندازی نشده است'));
    sheet((close) => h('div', { class: 'stack' },
      h('h3', null, `اتصال به ${label}`),
      h('p', { class: 'small muted', style: { margin: '0' } }, 'دکمه زیر را بزنید؛ ربات باز می‌شود. دکمه «شروع / Start» را بزنید تا حساب وصل شود. این لینک ۱۵ دقیقه اعتبار دارد.'),
      h('a', { class: 'btn accent lg block', href: link.url, target: '_blank', rel: 'noopener noreferrer', on: { click: () => setTimeout(() => { close(); render(); }, 1500) } }, icon('send'), `باز کردن @${link.username}`),
      h('div', { class: 'small muted' }, 'اگر دکمه کار نکرد، ربات را جستجو کنید و این پیام را بفرستید:'),
      h('div', { class: 'secret-box' }, `/start ${r.token}`),
      h('button', { class: 'btn ghost block', on: { click: () => copyText(`/start ${r.token}`) } }, icon('copy'), 'کپی پیام')));
  } catch (e) {
    busy(btn, false);
    errorToast(e);
  }
}

function teamSection(L) {
  const name = h('input', { class: 'input', placeholder: 'نام و نام خانوادگی' });
  const phone = h('input', { class: 'input ltr num', inputmode: 'tel', placeholder: '09...' });
  const add = h('button', { class: 'btn primary sm' }, icon('plus'), 'افزودن مشاور');
  add.addEventListener('click', async () => {
    busy(add, true);
    try {
      const r = await api('POST', '/api/team', { name: name.value, phone: phone.value });
      invalidate();
      secretSheet('مشاور اضافه شد', r.login, r.tempPassword);
      render();
    } catch (e) { errorToast(e); busy(add, false); }
  });
  const seeAll = h('input', { type: 'checkbox', checked: L.settings?.agentsSeeAll !== false });
  seeAll.addEventListener('change', async () => {
    try { await api('PATCH', '/api/agency/settings', { agentsSeeAll: seeAll.checked }); invalidate(); toast('ذخیره شد'); } catch (e) { errorToast(e); }
  });
  return [
    h('div', { class: 'section' }, h('h2', null, `تیم دفتر (${fa(L.team.length)})`)),
    h('div', { class: 'list' }, L.team.map((m) => h('div', { class: 'row', style: { padding: '12px 14px' } },
      h('div', { class: 'avatar sm' }, initials(m.name)),
      h('div', { class: 'grow' }, h('div', { class: 'small strong' }, m.name), h('div', { class: 'tiny muted' }, ROLE[m.role] + (m.active ? '' : '، غیرفعال'))),
      m.id !== state.user.id ? h('button', { class: 'btn sm ghost', on: { click: async (e) => {
        const b = e.currentTarget;
        if (!(await confirmDialog('رمز جدید', `برای ${m.name} رمز موقت جدید ساخته شود؟ نشست‌های فعلی او بسته می‌شود.`))) return;
        busy(b, true);
        try { const r = await api('POST', `/api/team/${m.id}/reset`); secretSheet('رمز موقت جدید', r.login, r.tempPassword); } catch (ex) { errorToast(ex); }
        busy(b, false);
      } } }, icon('key')) : null,
      m.id !== state.user.id ? h('button', { class: 'btn sm ghost', on: { click: async () => {
        try { await api('PATCH', '/api/team/' + m.id, { active: !m.active }); invalidate(); toast(m.active ? 'غیرفعال شد' : 'فعال شد'); render(); } catch (e) { errorToast(e); }
      } } }, m.active ? 'غیرفعال' : 'فعال') : null))),
    h('div', { class: 'card pad stack' }, h('div', { class: 'strong small' }, 'افزودن مشاور جدید'), h('div', { class: 'grid2' }, name, phone), h('div', null, add)),
    h('label', { class: 'card pad row', style: { cursor: 'pointer' } }, seeAll, h('div', { class: 'grow small' }, h('div', { class: 'strong' }, 'مشاورها همه فایل‌های دفتر را ببینند'), h('div', { class: 'tiny muted' }, 'اگر خاموش باشد، هر مشاور فقط فایل‌ها و مشتری‌های خودش را می‌بیند.'))),
  ];
}
