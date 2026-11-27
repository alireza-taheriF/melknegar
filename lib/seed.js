// First-run bootstrap from SEED_DATA (pre-hashed passwords, no plaintext).
import { config } from './config.js';
import { loadUsers, mutateUsers, mutatePlatform, mutateTenant } from './data.js';
import { registerLogins } from './auth.js';
import { NO_WRITE } from './store.js';
import { id } from './util.js';
import { cleanProperty, cleanClient } from './domain.js';

let done = false;

export async function ensureSeeded() {
  if (done || !config.seed) return;
  const users = await loadUsers();
  if (Object.keys(users.users).length) {
    done = true;
    return;
  }
  let seed;
  try {
    seed = JSON.parse(Buffer.from(config.seed, 'base64').toString('utf8'));
  } catch {
    console.error('SEED_DATA is not valid base64 JSON');
    done = true;
    return;
  }
  const tenantId = id('t_');
  let created = false;
  await mutateUsers((d) => {
    if (Object.keys(d.users).length) return NO_WRITE;
    for (const s of seed.users || []) {
      const u = {
        id: id('u_'),
        name: s.name,
        username: s.username,
        phone: s.phone || '',
        role: s.role || 'owner',
        staff: s.staff || null,
        tenantId,
        pass: s.passHash,
        mustChange: Boolean(s.mustChange),
        sv: 1,
        active: true,
        createdAt: Date.now(),
      };
      registerLogins(d, u);
      d.users[u.id] = u;
    }
    created = true;
  });
  if (!created) {
    done = true;
    return;
  }
  await mutatePlatform((p) => {
    p.tenants[tenantId] = { id: tenantId, name: seed.tenant?.name || 'دفتر نمونه', city: seed.tenant?.city || 'مشهد', active: true, createdAt: Date.now(), demo: true };
  });
  if (seed.demo) await seedDemo(tenantId);
  done = true;
}

const DAY = 86400000;
export async function seedDemo(tenantId) {
  const t0 = Date.now();
  const P = [
    { deal: 'sale', type: 'apartment', neighborhood: 'الهیه', address: 'الهیه ۱۸، نبش مروارید', area: 142, rooms: 3, floor: 3, totalFloors: 5, buildYear: 1401, price: 14_500_000_000, features: ['parking', 'elevator', 'storage', 'balcony', 'lobby'], ownerName: 'آقای رضایی', ownerPhone: '09151234567', notes: 'نورگیر جنوبی، کابینت هایگلاس. مالک برای فروش عجله دارد.', age: 3 },
    { deal: 'sale', type: 'apartment', neighborhood: 'سرافرازان', address: 'سرافرازان ۱۲', area: 118, rooms: 2, floor: 2, totalFloors: 4, buildYear: 1398, price: 9_200_000_000, features: ['parking', 'elevator', 'storage'], ownerName: 'خانم محمدی', ownerPhone: '09157654321', notes: 'قابل معاوضه با زمین', age: 12 },
    { deal: 'sale', type: 'villa', neighborhood: 'هاشمیه', address: 'هاشمیه ۲۴، کوچه دوم', area: 260, landArea: 220, rooms: 4, buildYear: 1390, price: 21_000_000_000, features: ['parking', 'yard', 'document'], ownerName: 'آقای کریمی', ownerPhone: '09151112233', notes: 'دوبلکس، حیاط با درخت', age: 41 },
    { deal: 'rent', type: 'apartment', neighborhood: 'خیام', address: 'خیام شمالی ۱۴', area: 95, rooms: 2, floor: 1, totalFloors: 4, buildYear: 1399, deposit: 900_000_000, rent: 15_000_000, features: ['parking', 'elevator'], ownerName: 'آقای حسینی', ownerPhone: '09153334455', notes: 'فقط خانواده', age: 6 },
    { deal: 'sale', type: 'apartment', neighborhood: 'فرامرز', address: 'فرامرز عباسی ۳۰', area: 165, rooms: 3, floor: 6, totalFloors: 8, buildYear: 1403, price: 17_800_000_000, features: ['parking', 'elevator', 'storage', 'lobby', 'pool', 'gym'], ownerName: 'آقای نوری', ownerPhone: '09155556677', notes: 'برج با امکانات کامل، ویو شهر', age: 45 },
    { deal: 'presale', type: 'apartment', neighborhood: 'امامت', address: 'امامت ۴۲', area: 130, rooms: 3, floor: 4, totalFloors: 7, price: 11_000_000_000, features: ['parking', 'elevator', 'storage'], ownerName: 'شرکت ساختمانی آرین', ownerPhone: '05138001234', notes: 'تحویل خرداد ۱۴۰۶، ۶۰٪ نقد', age: 2 },
    { deal: 'sale', type: 'commercial', neighborhood: 'سجاد', address: 'بلوار سجاد، پاساژ', area: 38, price: 12_500_000_000, features: ['document'], ownerName: 'آقای صادقی', ownerPhone: '09152223344', notes: 'دو دهنه، بر اصلی', status: 'sold', age: 20 },
    { deal: 'rent', type: 'apartment', neighborhood: 'وکیل‌آباد', address: 'وکیل‌آباد ۳۵', area: 110, rooms: 2, floor: 3, totalFloors: 5, buildYear: 1400, deposit: 600_000_000, rent: 22_000_000, features: ['parking', 'elevator', 'storage', 'balcony'], ownerName: 'خانم احمدی', ownerPhone: '09158889900', notes: '', age: 33 },
    { deal: 'sale', type: 'land', neighborhood: 'شاندیز', address: 'جاده شاندیز، ویرانی', area: 500, price: 8_500_000_000, features: ['document'], ownerName: 'آقای یزدانی', ownerPhone: '09151239876', notes: 'سند تک‌برگ، مناسب ویلا', age: 50 },
  ];
  const C = [
    { name: 'آقای مرادی', phone: '09151230000', deal: 'sale', types: ['apartment'], budgetMin: 12_000_000_000, budgetMax: 15_000_000_000, areaMin: 120, roomsMin: 3, neighborhoods: ['الهیه', 'فرامرز'], features: ['parking', 'elevator'], notes: 'زوج جوان، نقد کامل' },
    { name: 'خانم کاظمی', phone: '09154560000', deal: 'rent', types: ['apartment'], depositMax: 1_000_000_000, rentMax: 18_000_000, areaMin: 85, roomsMin: 2, neighborhoods: ['خیام', 'سرافرازان'], notes: 'از اول دی' },
    { name: 'آقای جعفری', phone: '09157890000', deal: 'sale', types: ['apartment'], budgetMax: 10_000_000_000, areaMin: 100, roomsMin: 2, neighborhoods: ['سرافرازان', 'امامت'], notes: '' },
  ];
  await mutateTenant(tenantId, (t) => {
    for (const x of P) {
      const p = cleanProperty(x);
      p.id = id('p_');
      p.no = ++t.seq;
      p.createdAt = t0 - x.age * DAY;
      p.updatedAt = p.createdAt;
      p.confirmedAt = p.createdAt;
      if (p.status === 'sold') p.closedAt = t0 - 4 * DAY;
      p.source = 'seed';
      t.properties[p.id] = p;
    }
    for (const x of C) {
      const c = cleanClient(x);
      c.id = id('c_');
      c.no = ++t.seq;
      c.createdAt = t0 - 5 * DAY;
      c.updatedAt = c.createdAt;
      c.source = 'seed';
      t.clients[c.id] = c;
    }
  });
}
