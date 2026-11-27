// Quick capture: text, voice note or a photo of the old paper ledger.
import { h, icon, api, fa, money, toast, errorToast, sheet, busy, clear } from '../core.js';
import { go, state, invalidate, render } from '../app.js';
import { DEAL, TYPE_SHORT } from '../labels.js';

function describe(it) {
  const d = it.data;
  if (it.kind === 'client') {
    return [d.name || 'مشتری', DEAL[d.deal], d.types?.map((t) => TYPE_SHORT[t]).join('، '), d.budgetMax && 'تا ' + money(d.budgetMax, { unit: false }), d.neighborhoods?.join('، ')].filter(Boolean).join('، ');
  }
  const price = d.deal === 'rent' ? [d.deposit && 'رهن ' + money(d.deposit, { unit: false }), d.rent && 'اجاره ' + money(d.rent, { unit: false })].filter(Boolean).join(' / ') : d.price && money(d.price, { unit: false });
  return [DEAL[d.deal], TYPE_SHORT[d.type], d.neighborhood, d.area && fa(d.area) + ' متر', d.rooms != null && fa(d.rooms) + ' خواب', price, d.ownerPhone && fa(d.ownerPhone)].filter(Boolean).join('، ');
}

function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function downscale(file, max = 1800) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    return { blob, preview: c.toDataURL('image/jpeg', 0.6) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function openCapture(initial = 'text') {
  let cleanup = () => {};
  sheet((close) => {
    let mode = initial;
    const body = h('div');
    const modes = h('div', { class: 'capture-modes' });
    const drawModes = () => modes.replaceChildren(
      ...[['text', 'edit', 'تایپ یا چسباندن'], ['voice', 'mic', 'پیام صوتی'], ['photo', 'camera', 'عکس از دفتر']].map(([k, ic, label]) =>
        h('button', { class: ['mode', mode === k && 'on'], on: { click: () => { stopRec(); mode = k; drawModes(); draw(); } } }, icon(ic), label)));

    let recorder = null;
    let stream = null;
    let timerId = null;
    const stopRec = () => {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      stream?.getTracks().forEach((t) => t.stop());
      clearInterval(timerId);
    };
    let closed = false;
    cleanup = () => { closed = true; stopRec(); };

    const showResults = (res) => {
      const items = res.items.map((it) => ({ ...it, on: true }));
      if (!items.length) {
        clear(body, h('div', { class: 'alert warn' }, icon('alert'), h('div', { class: 'small' }, 'چیزی برای ثبت پیدا نشد. مشخصات را واضح‌تر بنویسید یا بگویید (محله، متراژ، قیمت...).')),
          h('button', { class: 'btn ghost block', style: { marginTop: '12px' }, on: { click: draw } }, 'تلاش دوباره'));
        return;
      }
      if (items.length === 1) {
        close();
        state.prefill = { kind: items[0].kind, data: items[0].data };
        go(items[0].kind === 'client' ? '/clients/new' : '/files/new');
        return;
      }
      const saveBtn = h('button', { class: 'btn primary lg block' }, icon('check'), `ثبت ${fa(items.length)} مورد`);
      const updateBtn = () => {
        const n = items.filter((x) => x.on).length;
        saveBtn.lastChild.textContent = `ثبت ${fa(n)} مورد`;
        saveBtn.disabled = !n;
      };
      clear(body,
        res.transcript ? h('div', { class: 'card pad small notes', style: { marginBottom: '12px' } }, res.transcript) : null,
        h('div', { class: 'small muted', style: { marginBottom: '8px' } }, `${fa(items.length)} مورد پیدا شد. موارد اشتباه را از انتخاب خارج کنید؛ بعد از ثبت، همه قابل ویرایش‌اند.`),
        h('div', { class: 'stack' }, items.map((it) => {
          const chk = h('button', { class: ['check', 'on'], 'aria-label': 'انتخاب' }, icon('check'));
          const card = h('div', { class: 'extract-item' }, chk,
            h('div', { class: 'grow' },
              h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: ['badge', it.kind === 'client' ? 'b-review' : 'b-deal'] }, it.kind === 'client' ? 'مشتری' : 'فایل'), it.data.status === 'sold' ? h('span', { class: 'badge b-sold' }, 'فروخته‌شده') : null),
              h('div', { class: 'small strong', style: { marginTop: '4px' } }, describe(it)),
              it.data.notes ? h('div', { class: 'tiny muted ellipsis' }, it.data.notes) : null));
          chk.addEventListener('click', () => { it.on = !it.on; chk.classList.toggle('on', it.on); card.classList.toggle('off', !it.on); updateBtn(); });
          return card;
        })),
        h('div', { style: { marginTop: '14px' } }, saveBtn));
      saveBtn.addEventListener('click', async () => {
        busy(saveBtn, true, 'در حال ثبت...');
        try {
          const r = await api('POST', '/api/capture/save', { items: items.filter((x) => x.on).map(({ kind, data }) => ({ kind, data: { ...data, needsReview: false } })) });
          invalidate();
          toast(`${fa(r.properties.length + r.clients.length)} مورد ثبت شد`);
          close();
          go('/files');
          render();
        } catch (e) {
          errorToast(e);
          busy(saveBtn, false);
        }
      });
    };

    const working = (label) => clear(body, h('div', { class: 'loading-block' }, h('div', { class: 'spinner' }), label));

    const draw = () => {
      if (mode === 'text') {
        const ta = h('textarea', { class: 'input', rows: 6, placeholder: 'مثلاً: فروش آپارتمان الهیه ۱۲۰ متر، ۳ خواب، طبقه ۲، پارکینگ و انباری، ۹ میلیارد و ۵۰۰، آقای رضایی ۰۹۱۵...\n\nیا: مشتری آقای مرادی دنبال ۳ خواب الهیه تا ۱۵ میلیارد' });
        const btn = h('button', { class: 'btn primary lg block' }, icon('spark'), 'استخراج مشخصات');
        btn.addEventListener('click', async () => {
          if (!ta.value.trim()) return ta.focus();
          busy(btn, true, 'در حال تحلیل...');
          try { showResults(await api('POST', '/api/capture/text', { text: ta.value })); } catch (e) { errorToast(e); busy(btn, false); }
        });
        clear(body, h('div', { class: 'stack' }, ta,
          h('div', { class: 'tiny muted' }, 'نکته: با دکمه میکروفون کیبورد گوشی هم می‌توانید متن را دیکته کنید.'), btn,
          h('div', { class: 'row' }, h('button', { class: 'btn ghost grow sm', on: { click: () => { close(); go('/files/new'); } } }, 'فرم کامل فایل'), h('button', { class: 'btn ghost grow sm', on: { click: () => { close(); go('/clients/new'); } } }, 'فرم کامل مشتری'))));
        setTimeout(() => ta.focus(), 100);
      } else if (!state.ai) {
        clear(body, h('div', { class: 'alert info' }, icon('info'), h('div', { class: 'small' }, 'تبدیل صدا و عکس به فایل به هوش مصنوعی نیاز دارد که هنوز روی این نصب فعال نشده. فعلاً از حالت متن استفاده کنید.')));
      } else if (mode === 'voice') {
        if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
          clear(body, h('div', { class: 'alert warn' }, icon('alert'), h('div', { class: 'small' }, 'مرورگر شما ضبط صدا را پشتیبانی نمی‌کند. پیام صوتی را در ربات بله یا تلگرام بفرستید.')));
          return;
        }
        const timer = h('div', { class: 'timer' }, '۰:۰۰');
        const hint = h('div', { class: 'small muted center' }, 'دکمه را بزنید و مشخصات فایل یا مشتری را بگویید. حداکثر ۳ دقیقه.');
        const btn = h('button', { class: 'rec-btn', 'aria-label': 'شروع ضبط' }, icon('mic'));
        btn.addEventListener('click', async () => {
          if (recorder && recorder.state === 'recording') return stopRec();
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch {
            return errorToast(new Error('دسترسی به میکروفون داده نشد'));
          }
          const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
          recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
          const chunks = [];
          recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          recorder.onstop = async () => {
            stream?.getTracks().forEach((t) => t.stop());
            if (closed) return;
            const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
            if (blob.size < 1500) return draw();
            working('در حال تبدیل صدا به فایل...');
            try { showResults(await api('POST', '/api/capture/voice', { data: await fileToBase64(blob), mime: blob.type })); } catch (e) { errorToast(e); draw(); }
          };
          recorder.start(1000);
          btn.classList.add('live');
          btn.replaceChildren(icon('stop'));
          hint.textContent = 'در حال ضبط... برای پایان دوباره بزنید.';
          const start = Date.now();
          timerId = setInterval(() => {
            const s = Math.floor((Date.now() - start) / 1000);
            timer.textContent = fa(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
            if (s >= 180) stopRec();
          }, 250);
        });
        clear(body, h('div', { class: 'recorder' }, btn, timer, hint));
      } else {
        const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
        const zone = h('button', { class: 'dropzone', style: { width: '100%' }, on: { click: () => input.click() } }, icon('camera'),
          h('div', { class: 'strong', style: { color: 'var(--text)', marginTop: '6px' } }, 'عکس گرفتن یا انتخاب از گالری'),
          h('div', { class: 'small' }, 'یک صفحه از دفتر فایل‌ها را صاف و با نور کافی عکس بگیرید.'));
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const { blob, preview } = await downscale(file);
            clear(body, h('img', { class: 'preview-img', src: preview, alt: 'پیش‌نمایش' }), h('div', { class: 'loading-block' }, h('div', { class: 'spinner' }), 'در حال خواندن دست‌خط... (تا یک دقیقه)'));
            showResults(await api('POST', '/api/capture/image', { data: await fileToBase64(blob), mime: 'image/jpeg' }));
          } catch (e) {
            errorToast(e);
            draw();
          }
        });
        clear(body, input, zone);
      }
    };

    drawModes();
    draw();
    return h('div', null,
      h('h3', null, 'ثبت سریع'),
      h('p', { class: 'small muted', style: { margin: '0' } }, 'فایل یا مشتری را هر طور راحت‌اید وارد کنید؛ پلاک‌نگار مشخصات را جدا می‌کند.'),
      modes, body);
  }, { onClose: () => cleanup() });
}
