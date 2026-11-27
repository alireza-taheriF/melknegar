// Domain model for the agency ledger: properties (فایل) and clients (مشتری).
import { normText, oneLine, toInt, pick, normAnyPhone, normPhone, uniq } from './util.js';

export const DEALS = ['sale', 'rent', 'presale'];
export const TYPES = ['apartment', 'villa', 'land', 'commercial', 'office', 'garden', 'other'];
export const PSTATUS = ['active', 'sold', 'rented', 'withdrawn', 'unknown'];
export const FEATURES = ['parking', 'elevator', 'storage', 'balcony', 'lobby', 'pool', 'gym', 'renovated', 'single_unit', 'yard', 'furnished', 'document'];
export const CSTATUS = ['active', 'done', 'paused'];

const MAX_PRICE = 10_000_000_000_000; // 10,000 billion toman sanity cap

export function cleanProperty(input = {}, prev = {}) {
  const p = { ...prev };
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (has('deal')) p.deal = pick(input.deal, DEALS, 'sale');
  if (has('type')) p.type = pick(input.type, TYPES, 'apartment');
  if (has('status')) p.status = pick(input.status, PSTATUS, 'active');
  if (has('title')) p.title = oneLine(input.title, 120);
  if (has('neighborhood')) p.neighborhood = oneLine(input.neighborhood, 80);
  if (has('address')) p.address = oneLine(input.address, 240);
  if (has('area')) p.area = toInt(input.area, { min: 1, max: 1_000_000 });
  if (has('landArea')) p.landArea = toInt(input.landArea, { min: 1, max: 10_000_000 });
  if (has('rooms')) p.rooms = toInt(input.rooms, { min: 0, max: 50 });
  if (has('floor')) p.floor = toInt(input.floor, { min: -5, max: 200 });
  if (has('totalFloors')) p.totalFloors = toInt(input.totalFloors, { min: 0, max: 200 });
  if (has('buildYear')) p.buildYear = toInt(input.buildYear, { min: 1300, max: 1500 });
  if (has('price')) p.price = toInt(input.price, { min: 0, max: MAX_PRICE });
  if (has('deposit')) p.deposit = toInt(input.deposit, { min: 0, max: MAX_PRICE });
  if (has('rent')) p.rent = toInt(input.rent, { min: 0, max: MAX_PRICE });
  if (has('features')) p.features = Array.isArray(input.features) ? uniq(input.features.filter((f) => FEATURES.includes(f))) : [];
  if (has('ownerName')) p.ownerName = oneLine(input.ownerName, 80);
  if (has('ownerPhone')) p.ownerPhone = normAnyPhone(input.ownerPhone);
  if (has('notes')) p.notes = normText(input.notes, 2000);
  if (has('needsReview')) p.needsReview = Boolean(input.needsReview);
  p.deal ||= 'sale';
  p.type ||= 'apartment';
  p.status ||= 'active';
  p.features ||= [];
  return p;
}

export function cleanClient(input = {}, prev = {}) {
  const c = { ...prev };
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (has('name')) c.name = oneLine(input.name, 80);
  if (has('phone')) c.phone = normPhone(input.phone) || normAnyPhone(input.phone);
  if (has('deal')) c.deal = pick(input.deal, DEALS, 'sale');
  if (has('types')) c.types = Array.isArray(input.types) ? uniq(input.types.filter((t) => TYPES.includes(t))) : [];
  if (has('budgetMin')) c.budgetMin = toInt(input.budgetMin, { min: 0, max: MAX_PRICE });
  if (has('budgetMax')) c.budgetMax = toInt(input.budgetMax, { min: 0, max: MAX_PRICE });
  if (has('depositMax')) c.depositMax = toInt(input.depositMax, { min: 0, max: MAX_PRICE });
  if (has('rentMax')) c.rentMax = toInt(input.rentMax, { min: 0, max: MAX_PRICE });
  if (has('areaMin')) c.areaMin = toInt(input.areaMin, { min: 0, max: 1_000_000 });
  if (has('areaMax')) c.areaMax = toInt(input.areaMax, { min: 0, max: 1_000_000 });
  if (has('roomsMin')) c.roomsMin = toInt(input.roomsMin, { min: 0, max: 50 });
  if (has('neighborhoods')) {
    const arr = Array.isArray(input.neighborhoods) ? input.neighborhoods : String(input.neighborhoods || '').split(/[،,]/);
    c.neighborhoods = uniq(arr.map((n) => oneLine(n, 60)).filter(Boolean)).slice(0, 12);
  }
  if (has('features')) c.features = Array.isArray(input.features) ? uniq(input.features.filter((f) => FEATURES.includes(f))) : [];
  if (has('notes')) c.notes = normText(input.notes, 2000);
  if (has('status')) c.status = pick(input.status, CSTATUS, 'active');
  if (has('needsReview')) c.needsReview = Boolean(input.needsReview);
  c.deal ||= 'sale';
  c.types ||= [];
  c.neighborhoods ||= [];
  c.features ||= [];
  c.status ||= 'active';
  return c;
}

const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک');

// Score 0..100 of how well a property fits a client's request.
export function matchScore(p, c) {
  if (!p || !c || p.status !== 'active' || c.status !== 'active') return 0;
  if (p.deal !== c.deal) return 0;
  let score = 0;
  let weight = 0;
  const part = (w, ok) => {
    weight += w;
    if (ok === true) score += w;
    else if (typeof ok === 'number') score += w * ok;
  };
  if (c.types?.length) {
    if (!c.types.includes(p.type)) return 0;
    part(10, true);
  }
  const within = (v, min, max, slack) => {
    if (v == null) return 0.5; // unknown: neutral
    if (min != null && v < min * (1 - slack)) return 0;
    if (max != null && v > max * (1 + slack)) return 0;
    if (min != null && v < min) return 0.6;
    if (max != null && v > max) return 0.6;
    return 1;
  };
  if (c.deal === 'rent') {
    if (c.depositMax != null) {
      const f = within(p.deposit, null, c.depositMax, 0.15);
      if (f === 0) return 0;
      part(30, f);
    }
    if (c.rentMax != null) {
      const f = within(p.rent, null, c.rentMax, 0.15);
      if (f === 0) return 0;
      part(15, f);
    }
  } else if (c.budgetMin != null || c.budgetMax != null) {
    const f = within(p.price, c.budgetMin, c.budgetMax, 0.12);
    if (f === 0) return 0;
    part(40, f);
  }
  if (c.areaMin != null || c.areaMax != null) {
    const f = within(p.area, c.areaMin, c.areaMax, 0.15);
    if (f === 0) return 0;
    part(20, f);
  }
  if (c.roomsMin != null) part(10, p.rooms == null ? 0.5 : p.rooms >= c.roomsMin ? 1 : 0.2);
  if (c.neighborhoods?.length) {
    const hood = norm(p.neighborhood) + norm(p.address);
    part(20, c.neighborhoods.some((n) => n && hood.includes(norm(n))) ? 1 : 0.1);
  }
  if (c.features?.length) {
    const have = c.features.filter((f) => p.features?.includes(f)).length;
    part(10, have / c.features.length);
  }
  if (!weight) return 50;
  return Math.round((score / weight) * 100);
}

export function topMatches(items, target, scoreFn, limit = 10, min = 55) {
  return items
    .map((it) => ({ item: it, score: scoreFn(it, target) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export const STALE_DAYS = 30;
export function isStale(p, t = Date.now()) {
  return p.status === 'active' && t - (p.confirmedAt || p.createdAt || t) > STALE_DAYS * 86400000;
}
