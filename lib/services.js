// Module 3: content production for agencies and pre-purchase technical inspection.
import { oneLine, normText, toInt, pick, normPhone } from './util.js';

export const CATALOG = {
  content: {
    title: 'تولید محتوای ملک',
    subtitle: 'عکاس و فیلم‌بردار به محل ملک می‌آید و محتوای آماده انتشار با برند دفتر شما تحویل می‌دهد.',
    packages: [
      { id: 'photo', title: 'عکاسی حرفه‌ای', price: 2_500_000, items: ['۱۵ عکس ادیت‌شده با نور و زاویه حرفه‌ای', 'واترمارک لوگوی دفتر', 'تحویل در ۲۴ ساعت'] },
      { id: 'reels', title: 'عکس + ریلز اینستاگرام', price: 3_200_000, items: ['۱۵ عکس ادیت‌شده', 'یک ریلز ۳۰ تا ۶۰ ثانیه‌ای با موسیقی و متن', 'کپشن آماده انتشار', 'تحویل در ۴۸ ساعت'] },
      { id: 'tour', title: 'پکیج کامل (عکس، ریلز، تور ویدیویی)', price: 4_000_000, items: ['۲۰ عکس ادیت‌شده', 'ریلز ۶۰ ثانیه‌ای + تور ویدیویی کامل ملک', 'نسخه افقی برای دیوار و سایت', 'تحویل در ۴۸ ساعت'] },
    ],
  },
  inspection: {
    title: 'بازدید فنی قبل از خرید',
    subtitle: 'مهندس عضو نظام مهندسی ملک را با چک‌لیست استاندارد بررسی می‌کند؛ گزارش تصویری و بازه قیمت منصفانه تحویل می‌گیرید.',
    note: 'این خدمت بازدید فنی و مشاوره خرید است و جایگزین کارشناسی رسمی دادگستری نیست.',
    packages: [
      { id: 'small', title: 'تا ۱۰۰ متر', price: 4_000_000, items: ['بررسی نم، ترک، تأسیسات آب و برق و گاز', 'بررسی سند و وضعیت پایان‌کار (اسناد ارائه‌شده)', 'گزارش PDF با عکس', 'برآورد هزینه تعمیرات و بازه قیمت'] },
      { id: 'medium', title: '۱۰۰ تا ۲۰۰ متر', price: 6_000_000, items: ['همه موارد پکیج پایه', 'بررسی مشاعات، پارکینگ و انباری', 'مقایسه با معاملات مشابه محله'] },
      { id: 'large', title: 'بالای ۲۰۰ متر یا ویلایی', price: 8_000_000, items: ['همه موارد پکیج‌های قبل', 'بررسی سازه ظاهری، بام و حیاط', 'جلسه توضیح حضوری یا تلفنی'] },
    ],
  },
};

export const ORDER_STATUS = ['new', 'scheduled', 'in_progress', 'delivered', 'done', 'canceled'];

export function cleanOrderInput(input, { publicForm = false } = {}) {
  const kind = pick(input.kind, ['content', 'inspection'], null);
  if (!kind) throw new Error('نوع خدمت نامعتبر است');
  const pkgs = CATALOG[kind].packages.map((p) => p.id);
  const pkg = pick(input.package, pkgs, pkgs[0]);
  const phone = normPhone(input.phone);
  const name = oneLine(input.name, 80);
  if (publicForm) {
    if (!name) throw new Error('نام را وارد کنید');
    if (!phone) throw new Error('شماره موبایل معتبر وارد کنید');
  }
  const address = oneLine(input.address, 240);
  if (!address && !input.propertyId) throw new Error('آدرس یا محله ملک را وارد کنید');
  return {
    kind,
    package: pkg,
    contact: { name, phone },
    location: { city: oneLine(input.city || 'مشهد', 40), neighborhood: oneLine(input.neighborhood, 80), address },
    details: {
      area: toInt(input.area, { min: 1, max: 100000 }),
      propertyType: oneLine(input.propertyType, 40),
      preferredAt: oneLine(input.preferredAt, 80),
      notes: normText(input.notes, 1000),
    },
    propertyId: input.propertyId ? oneLine(input.propertyId, 40) : null,
    estimate: CATALOG[kind].packages.find((p) => p.id === pkg).price,
  };
}

export function publicOrderView(o) {
  return {
    code: o.code,
    kind: o.kind,
    package: o.package,
    status: o.status,
    createdAt: o.createdAt,
    scheduledAt: o.scheduledAt || '',
    price: o.price || o.estimate,
  };
}
