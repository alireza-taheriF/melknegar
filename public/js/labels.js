export const DEAL = { sale: 'فروش', rent: 'رهن و اجاره', presale: 'پیش‌فروش' };
export const TYPE = { apartment: 'آپارتمان', villa: 'ویلایی / حیاط‌دار', land: 'زمین', commercial: 'تجاری / مغازه', office: 'اداری', garden: 'باغ', other: 'سایر' };
export const TYPE_SHORT = { apartment: 'آپارتمان', villa: 'ویلایی', land: 'زمین', commercial: 'تجاری', office: 'اداری', garden: 'باغ', other: 'سایر' };
export const TYPE_ICON = { apartment: 'building', villa: 'villa', land: 'land', commercial: 'shop', office: 'building', garden: 'land', other: 'building' };
export const PSTATUS = { active: 'فعال', sold: 'فروخته شد', rented: 'اجاره رفت', withdrawn: 'منصرف شد', unknown: 'نامعلوم' };
export const CSTATUS = { active: 'فعال', done: 'به نتیجه رسید', paused: 'متوقف' };
export const FEATURE = {
  parking: ['پارکینگ', 'car'],
  elevator: ['آسانسور', 'elevator'],
  storage: ['انباری', 'box'],
  balcony: ['بالکن', 'sun'],
  lobby: ['لابی / سرایدار', 'building'],
  pool: ['استخر', 'star'],
  gym: ['سونا / جکوزی / باشگاه', 'star'],
  renovated: ['بازسازی‌شده', 'spark'],
  single_unit: ['تک‌واحدی', 'layers'],
  yard: ['حیاط', 'villa'],
  furnished: ['مبله', 'home'],
  document: ['سند تک‌برگ', 'doc'],
};
export const ORDER_STATUS = { new: 'ثبت شد', scheduled: 'زمان‌بندی شد', in_progress: 'در حال انجام', delivered: 'تحویل شد', done: 'تکمیل', canceled: 'لغو شد' };
export const ROLE = { owner: 'مدیر دفتر', agent: 'مشاور' };
export const STAFF = { superadmin: 'مدیر کل', admin: 'مدیر پلتفرم' };
export const SOURCE = { app: 'اپ', telegram: 'تلگرام', bale: 'بله', seed: 'نمونه', public: 'فرم عمومی' };
