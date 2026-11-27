// Platform staff panel: orders, agencies, users, bots, system status.
import { h, icon, api, fa, money, date, dateTime, ago, toast, errorToast, sheet, busy, confirmDialog, parseNumber, faInt } from '../core.js';
import { route, layout, state, go, render } from '../app.js';
import { ORDER_STATUS, ROLE, STAFF } from '../labels.js';
import { catalog } from './services.js';
import { secretSheet } from './settings.js';

let tab = 'orders';

route('/admin', async () => {
  const [d, cat] = await Promise.all([api('GET', '/api/admin/overview'), catalog()]);
  const body = h('div');
  const tabs = h('div', { class: 'scroll-x', style: { marginBottom: '14px' } });
  const newOrders = d.orders.filter((o) => o.status === 'new').length;
  const drawTabs = () => tabs.replaceChildren(...[['orders', `سفارش‌ها${newOrders ? ' (' + fa(newOrders) + ' جدید)' : ''}`], ['tenants', 'دفترهای املاک'], ['users', 'کاربران'], ['bots', 'ربات‌ها'], ['system', 'سیستم']].map(([k, v]) => h('button', { class: ['chip', tab === k && 'on'], on: { click: () => { tab = k; drawTabs(); draw(); } } }, v)));
  const tenantName = Object.fromEntries(d.tenants.map((t) => [t.id, t.name]));

  const draw = () => {
    if (tab === 'orders') body.replaceChildren(ordersTab(d, cat, tenantName));
    else if (tab === 'tenants') body.replaceChildren(tenantsTab(d));
    else if (tab === 'users') body.replaceChildren(usersTab(d, tenantName));
    else if (tab === 'bots') body.replaceChildren(botsTab(d));
    else body.replaceChildren(systemTab(d));
  };
  drawTabs();
  draw();
  return layout({ title: 'پنل مدیریت ملک‌نگار', content: h('div', null, tabs, body), active: '/admin', backTo: '/' });
}, { staff: true });

function ordersTab(d, cat, tenantName) {
  let filter = 'open';
  const list = h('div', { class: 'stack', style: { gap: '10px' } });
  const chips = h('div', { class: 'chips', style: { marginBottom: '12px' } });
  const draw = () => {
    chips.replaceChildren(...[['open', 'در جریان'], ['all', 'همه'], ['content', 'محتوا'], ['inspection', 'بازدید فنی']].map(([k, v]) => h('button', { class: ['chip', filter === k && 'on'], on: { click: () => { filter = k; draw(); } } }, v)));
    let items = d.orders;
    if (filter === 'open') items = items.filter((o) => !['done', 'canceled'].includes(o.status));
    if (filter === 'content' || filter === 'inspection') items = items.filter((o) => o.kind === filter);
    list.replaceChildren(...(items.length ? items.map((o) => {
      const pkg = cat[o.kind]?.packages.find((p) => p.id === o.package);
      return h('button', { class: 'card pad', style: { textAlign: 'start', width: '100%' }, on: { click: () => editOrder(o, cat) } },
        h('div', { class: 'row spread' }, h('div', { class: 'strong' }, `${o.code}، ${cat[o.kind].title}`), h('span', { class: ['badge', 'b-' + o.status] }, ORDER_STATUS[o.status])),
        h('div', { class: 'small muted', style: { marginTop: '4px' } }, [pkg?.title, o.tenantId ? tenantName[o.tenantId] || o.agency : 'فرم عمومی (خریدار)', o.location?.neighborhood || o.location?.address].filter(Boolean).join('، ')),
        h('div', { class: 'row spread small', style: { marginTop: '6px' } }, h('span', null, `${o.contact?.name || ''} `, h('span', { class: 'ltr num' }, fa(o.contact?.phone || ''))), h('span', { class: 'strong' }, money(o.price || o.estimate))),
        h('div', { class: 'tiny muted' }, ago(o.createdAt)));
    }) : [h('div', { class: 'card empty' }, icon('inbox'), h('h3', null, 'سفارشی نیست'))]));
  };
  draw();
  return h('div', null, chips, list);
}

function editOrder(o, cat) {
  sheet((close) => {
    let status = o.status;
    const seg = h('div', { class: 'chips' });
    const drawSeg = () => seg.replaceChildren(...Object.entries(ORDER_STATUS).map(([k, v]) => h('button', { type: 'button', class: ['chip', status === k && 'on'], on: { click: () => { status = k; drawSeg(); } } }, v)));
    drawSeg();
    const price = h('input', { class: 'input num', inputmode: 'numeric', value: o.price ? faInt(o.price) : '', placeholder: faInt(o.estimate) });
    const when = h('input', { class: 'input', value: o.scheduledAt || '', placeholder: 'مثلاً شنبه ۱۰ صبح' });
    const assignee = h('input', { class: 'input', value: o.assignee || '', placeholder: 'عکاس / مهندس' });
    const link = h('input', { class: 'input ltr', value: o.deliveryLink || '', placeholder: 'https://...' });
    const note = h('input', { class: 'input', placeholder: 'یادداشت این تغییر (اختیاری)' });
    const save = h('button', { class: 'btn primary block lg' }, 'ذخیره');
    save.addEventListener('click', async () => {
      busy(save, true);
      try {
        await api('PATCH', '/api/admin/orders/' + o.id, { status, price: parseNumber(price.value.replace(/[٬,]/g, '')), scheduledAt: when.value, assignee: assignee.value, deliveryLink: link.value.trim(), note: note.value });
        toast('سفارش به‌روز شد');
        close();
        render();
      } catch (e) { errorToast(e); busy(save, false); }
    });
    const d = o.details || {};
    return h('div', { class: 'stack' },
      h('h3', null, `سفارش ${o.code}`),
      h('div', { class: 'small muted' }, `${cat[o.kind].title} — ${cat[o.kind].packages.find((p) => p.id === o.package)?.title || ''}، ${dateTime(o.createdAt)}`),
      h('div', { class: 'card pad small stack', style: { gap: '4px' } },
        h('div', null, 'تماس: ', h('span', { class: 'strong' }, o.contact?.name || '—'), ' ', h('a', { class: 'ltr num', href: 'tel:' + (o.contact?.phone || '') }, fa(o.contact?.phone || ''))),
        h('div', null, 'آدرس: ', [o.location?.city, o.location?.neighborhood, o.location?.address].filter(Boolean).join('، ')),
        d.area ? h('div', null, 'متراژ: ', fa(d.area), ' متر') : null,
        d.preferredAt ? h('div', null, 'زمان پیشنهادی: ', d.preferredAt) : null,
        d.notes ? h('div', null, 'توضیحات: ', d.notes) : null),
      h('div', { class: 'field' }, h('label', null, 'وضعیت'), seg),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'مبلغ نهایی (تومان)'), price), h('div', { class: 'field' }, h('label', null, 'زمان بازدید'), when)),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'مسئول'), assignee), h('div', { class: 'field' }, h('label', null, 'لینک تحویل فایل‌ها'), link)),
      h('div', { class: 'field' }, h('label', null, 'یادداشت'), note),
      save,
      o.history?.length ? h('div', { class: 'timeline' }, o.history.slice().reverse().map((x) => h('div', { class: 'tl' }, h('span', { class: 'dot' }), h('div', null, h('div', { class: 'small strong' }, ORDER_STATUS[x.status] + (x.note ? ' — ' + x.note : '')), h('div', { class: 'tiny muted' }, [x.by, dateTime(x.at)].filter(Boolean).join('، ')))))) : null);
  });
}

function tenantsTab(d) {
  const name = h('input', { class: 'input', placeholder: 'نام دفتر، مثلاً املاک پارسا' });
  const city = h('input', { class: 'input', value: 'مشهد' });
  const owner = h('input', { class: 'input', placeholder: 'نام مدیر دفتر' });
  const phone = h('input', { class: 'input ltr num', inputmode: 'tel', placeholder: 'موبایل مدیر 09...' });
  const btn = h('button', { class: 'btn primary' }, icon('plus'), 'ساخت دفتر و حساب مدیر');
  btn.addEventListener('click', async () => {
    busy(btn, true);
    try {
      const r = await api('POST', '/api/admin/tenants', { name: name.value, city: city.value, ownerName: owner.value, ownerPhone: phone.value });
      secretSheet('دفتر ساخته شد', r.login, r.tempPassword, 'اطلاعات ورود را برای مدیر دفتر بفرستید. در اولین ورود باید رمز شخصی بگذارد.');
      render();
    } catch (e) { errorToast(e); busy(btn, false); }
  });
  return h('div', { class: 'stack' },
    h('div', { class: 'card pad stack' }, h('div', { class: 'strong' }, 'افزودن دفتر املاک جدید (مشتری)'), h('div', { class: 'grid2' }, name, city), h('div', { class: 'grid2' }, owner, phone), h('div', null, btn)),
    h('div', { class: 'list' }, d.tenants.map((t) => {
      const members = d.users.filter((u) => u.tenantId === t.id);
      return h('div', { class: 'row', style: { padding: '12px 14px' } },
        h('div', { class: 'avatar sm' }, t.name.slice(0, 1)),
        h('div', { class: 'grow' }, h('div', { class: 'strong small' }, t.name, t.demo ? h('span', { class: 'badge b-new', style: { marginInlineStart: '6px' } }, 'دفتر دمو') : null), h('div', { class: 'tiny muted' }, `${t.city}، ${fa(members.length)} کاربر، ${date(t.createdAt)}${t.active ? '' : '، غیرفعال'}`)),
        t.demo ? null : h('button', { class: 'btn sm ghost', on: { click: async () => {
          if (!(await confirmDialog(t.active ? 'غیرفعال‌کردن دفتر' : 'فعال‌کردن دفتر', t.active ? 'کاربران این دفتر دیگر نمی‌توانند وارد شوند.' : 'کاربران این دفتر دوباره می‌توانند وارد شوند.', { danger: t.active }))) return;
          try { await api('PATCH', '/api/admin/tenants/' + t.id, { active: !t.active }); render(); } catch (e) { errorToast(e); }
        } } }, t.active ? 'غیرفعال' : 'فعال'));
    })));
}

function usersTab(d, tenantName) {
  const isSuper = state.user.staff === 'superadmin';
  let form = null;
  if (isSuper) {
    const name = h('input', { class: 'input', placeholder: 'نام' });
    const phone = h('input', { class: 'input ltr num', placeholder: 'موبایل 09...' });
    const username = h('input', { class: 'input ltr', placeholder: 'نام کاربری انگلیسی (اختیاری)' });
    const btn = h('button', { class: 'btn primary' }, icon('plus'), 'افزودن مدیر پلتفرم');
    btn.addEventListener('click', async () => {
      busy(btn, true);
      try { const r = await api('POST', '/api/admin/staff', { name: name.value, phone: phone.value, username: username.value }); secretSheet('مدیر جدید اضافه شد', r.login, r.tempPassword); render(); } catch (e) { errorToast(e); busy(btn, false); }
    });
    form = h('div', { class: 'card pad stack' }, h('div', { class: 'strong' }, 'افزودن مدیر پلتفرم (مثلاً شریک تجاری)'), h('div', { class: 'grid3' }, name, phone, username), h('div', null, btn));
  }
  return h('div', { class: 'stack' }, form,
    h('div', { class: 'card table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ...['نام', 'ورود', 'نقش', 'دفتر', 'آخرین ورود', ''].map((x) => h('th', null, x)))),
      h('tbody', null, d.users.map((u) => h('tr', null,
        h('td', { class: 'strong' }, u.name, u.active ? null : h('span', { class: 'badge b-canceled', style: { marginInlineStart: '6px' } }, 'غیرفعال')),
        h('td', { class: 'ltr num small' }, fa(u.username || u.phone)),
        h('td', { class: 'small' }, u.staff ? STAFF[u.staff] : ROLE[u.role]),
        h('td', { class: 'small' }, tenantName[u.tenantId] || '—'),
        h('td', { class: 'small muted' }, u.lastLoginAt ? ago(u.lastLoginAt) : 'هرگز'),
        h('td', null, u.id === state.user.id || (u.staff === 'superadmin' && !isSuper) ? null : h('div', { class: 'row', style: { gap: '6px' } },
          h('button', { class: 'btn sm ghost', title: 'رمز موقت جدید', on: { click: async () => {
            if (!(await confirmDialog('رمز موقت جدید', `برای ${u.name} رمز جدید ساخته شود؟`))) return;
            try { const r = await api('POST', `/api/admin/users/${u.id}/reset`); secretSheet('رمز موقت جدید', r.login, r.tempPassword); } catch (e) { errorToast(e); }
          } } }, icon('key')),
          h('button', { class: 'btn sm ghost', on: { click: async () => { try { await api('PATCH', '/api/admin/users/' + u.id, { active: !u.active }); render(); } catch (e) { errorToast(e); } } } }, u.active ? 'غیرفعال' : 'فعال')))))))));
}

function botsTab(d) {
  const block = (platform, label, howto) => {
    const b = d.bots[platform];
    const token = h('input', { class: 'input ltr', placeholder: '123456789:AA...', autocomplete: 'off' });
    const btn = h('button', { class: 'btn primary' }, 'اتصال');
    btn.addEventListener('click', async () => {
      busy(btn, true);
      try { const r = await api('POST', '/api/admin/bots', { platform, token: token.value.trim() }); toast(`ربات @${r.username} وصل شد`); render(); } catch (e) { errorToast(e); busy(btn, false); }
    });
    return h('div', { class: 'card pad stack' },
      h('div', { class: 'row spread' }, h('div', { class: 'strong' }, label), b.connected ? h('span', { class: 'badge b-active' }, icon('check'), '@' + b.username) : h('span', { class: 'badge b-unknown' }, 'وصل نیست')),
      b.connected
        ? h('div', { class: 'row' }, h('div', { class: 'grow small muted' }, `اتصال از ${date(b.connectedAt)}. کاربران از تنظیمات اپ حسابشان را وصل می‌کنند.`),
            h('button', { class: 'btn sm danger', on: { click: async () => { if (!(await confirmDialog('قطع ربات', 'وب‌هوک ربات حذف می‌شود.', { danger: true }))) return; await api('DELETE', '/api/admin/bots/' + platform).catch(errorToast); render(); } } }, 'قطع'))
        : [h('div', { class: 'small muted' }, howto), h('div', { class: 'row' }, token, btn)]);
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'alert info' }, icon('shield'), h('div', { class: 'small' }, 'توکن ربات رمزنگاری‌شده ذخیره می‌شود و دیگر نمایش داده نمی‌شود. وب‌هوک با کلید مخفی تصادفی محافظت می‌شود.')),
    block('bale', 'ربات بله', 'در بله به @botfather پیام دهید، ربات بسازید (مثلاً melknegar_bot) و توکن را اینجا بچسبانید.'),
    block('telegram', 'ربات تلگرام', 'در تلگرام به @BotFather پیام دهید، /newbot بزنید و توکن را اینجا بچسبانید.'));
}

function systemTab(d) {
  const s = d.system.storage;
  const row = (k, v) => h('div', { class: 'row spread', style: { padding: '11px 14px' } }, h('span', { class: 'small muted' }, k), h('span', { class: 'small strong' }, v));
  return h('div', { class: 'stack' },
    h('div', { class: 'list' },
      row('آدرس اپ', d.system.appUrl || '—'),
      row('ذخیره‌ساز', { blob: 'Vercel Blob (رمزنگاری‌شده)', redis: 'Upstash Redis (رمزنگاری‌شده)', local: 'فایل محلی' }[s.backend] || s.backend),
      row('هوش مصنوعی (صدا و عکس)', d.system.ai ? 'فعال' : 'غیرفعال'),
      row('نوشتن از آخرین راه‌اندازی این سرور', fa(s.writes)),
      row('دفترها / کاربران / سفارش‌ها', `${fa(d.tenants.length)} / ${fa(d.users.length)} / ${fa(d.orders.length)}`)),
    s.backend === 'blob' ? h('div', { class: 'alert warn' }, icon('info'), h('div', { class: 'small' }, 'پلن رایگان Vercel Blob ماهانه حدود ۲٬۰۰۰ عملیات نوشتن دارد؛ برای آزمایش و چند دفتر اول کافی است. وقتی مشتری‌ها زیاد شدند، از داشبورد Vercel بخش Storage، «Upstash Redis» رایگان را به پروژه وصل کنید؛ اپ خودکار به آن منتقل می‌شود.')) : null);
}
