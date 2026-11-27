import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const seed = execFileSync('node', ['scripts/make_seed.js', JSON.stringify({ tenant: { name: 'املاک تست' }, demo: true, users: [
  { name: 'علی', username: 'ali', phone: '09358595056', staff: 'superadmin', role: 'owner', password: 'Sup3r-secret-pw' },
  { name: 'شریک', username: 'partner', staff: 'admin', role: 'owner', password: 'Temp-pass-123', mustChange: true },
] })]).toString();
let srv;
test.before(async () => {
  srv = spawn('node', ['scripts/dev.js'], { env: { ...process.env, PORT: String(PORT), LOCAL_DATA_DIR: dir, SEED_DATA: seed, MASTER_KEY: Buffer.alloc(32, 3).toString('base64') }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => srv.stdout.once('data', r));
});
test.after(() => srv.kill());

function client() {
  let cookie = '';
  return async (method, p, body, headers = {}) => {
    const res = await fetch(BASE + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-mn': '1', origin: BASE, cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, json, headers: res.headers };
  };
}

test('auth, ledger, capture, services, admin', async () => {
  const a = client();
  assert.equal((await a('GET', '/api/auth/me')).status, 401);
  assert.equal((await a('POST', '/api/auth/login', { identifier: 'ali', password: 'wrong-password' })).status, 400);
  const login = await a('POST', '/api/auth/login', { identifier: '۰۹۳۵۸۵۹۵۰۵۶', password: 'Sup3r-secret-pw' });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  assert.equal(login.json.user.staff, 'superadmin');
  const led = await a('GET', '/api/ledger');
  assert.equal(led.status, 200);
  assert.ok(led.json.properties.length >= 8);
  assert.ok(led.json.summary.stale >= 1);

  // CSRF: missing header is refused
  const noHdr = await fetch(BASE + '/api/properties', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noHdr.status, 403);
  const evil = await a('POST', '/api/properties', { area: 1 }, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);

  const cap = await a('POST', '/api/capture/text', { text: 'فروش آپارتمان الهیه ۱۲۰ متر ۳ خواب طبقه ۲ پارکینگ آسانسور انباری قیمت ۹ میلیارد و ۵۰۰ آقای رضایی ۰۹۱۵۱۲۳۴۵۶۷' });
  assert.equal(cap.status, 200);
  const it = cap.json.items[0];
  assert.equal(it.kind, 'property');
  assert.equal(it.data.area, 120);
  assert.equal(it.data.rooms, 3);
  assert.equal(it.data.price, 9_500_000_000);
  assert.equal(it.data.neighborhood, 'الهیه');
  assert.equal(it.data.ownerPhone, '09151234567');
  assert.deepEqual(it.data.features.sort(), ['elevator', 'parking', 'storage']);
  const saved = await a('POST', '/api/capture/save', { items: cap.json.items });
  assert.equal(saved.status, 200);
  const pid = saved.json.properties[0].id;
  const upd = await a('PATCH', '/api/properties/' + pid, { status: 'sold' });
  assert.equal(upd.json.property.status, 'sold');

  const rent = await a('POST', '/api/capture/text', { text: 'رهن و اجاره خیام ۹۰ متری دو خواب رهن ۵۰۰ میلیون اجاره ۱۲ میلیون' });
  assert.equal(rent.json.items[0].data.deal, 'rent');
  assert.equal(rent.json.items[0].data.deposit, 500_000_000);
  assert.equal(rent.json.items[0].data.rent, 12_000_000);
  const cl = await a('POST', '/api/capture/text', { text: 'مشتری خریدار آقای مرادی دنبال آپارتمان ۳ خواب الهیه تا ۱۵ میلیارد ۰۹۱۲۱۱۱۲۲۳۳' });
  assert.equal(cl.json.items[0].kind, 'client');
  assert.equal(cl.json.items[0].data.budgetMax, 15_000_000_000);

  const ord = await a('POST', '/api/services/orders', { kind: 'content', package: 'reels', propertyId: pid });
  assert.equal(ord.status, 200, JSON.stringify(ord.json));
  assert.match(ord.json.order.code, /^MN-\d+$/);

  // public inspection request + tracking
  const pub = client();
  const tooFast = await pub('POST', '/api/public/orders', { kind: 'inspection', name: 'سارا', phone: '09121234567', address: 'سجاد', startedAt: Date.now() });
  assert.equal(tooFast.status, 400);
  const po = await pub('POST', '/api/public/orders', { kind: 'inspection', package: 'medium', name: 'سارا', phone: '09121234567', address: 'سجاد ۱۰', area: 150, startedAt: Date.now() - 20000 });
  assert.equal(po.status, 200, JSON.stringify(po.json));
  const tr = await pub('GET', `/api/public/track?code=${po.json.order.code}&phone=09121234567`);
  assert.equal(tr.json.order.status, 'new');
  assert.equal((await pub('GET', `/api/public/track?code=${po.json.order.code}&phone=09120000000`)).status, 404);
  assert.equal((await pub('GET', '/api/ledger')).status, 401);
  assert.equal((await pub('GET', '/api/admin/overview')).status, 401);

  // admin: create agency, its owner must change password, isolation between tenants
  const ov = await a('GET', '/api/admin/overview');
  assert.equal(ov.status, 200);
  assert.ok(ov.json.orders.length >= 2);
  const nt = await a('POST', '/api/admin/tenants', { name: 'املاک پارسا', ownerName: 'حمید پارسا', ownerPhone: '09150000001' });
  assert.equal(nt.status, 200, JSON.stringify(nt.json));
  const b = client();
  const bl = await b('POST', '/api/auth/login', { identifier: '09150000001', password: nt.json.tempPassword });
  assert.equal(bl.status, 200);
  assert.equal(bl.json.user.mustChange, true);
  assert.equal((await b('GET', '/api/ledger')).status, 403);
  assert.equal((await b('POST', '/api/auth/password', { next: '12345678' })).status, 400);
  assert.equal((await b('POST', '/api/auth/password', { next: 'Parsa-strong-1405' })).status, 200);
  const bled = await b('GET', '/api/ledger');
  assert.equal(bled.status, 200);
  assert.equal(bled.json.properties.length, 0);
  assert.equal((await b('PATCH', '/api/properties/' + pid, { status: 'active' })).status, 404); // other tenant's record
  assert.equal((await b('GET', '/api/admin/overview')).status, 403);
  // team member
  const tm = await b('POST', '/api/team', { name: 'مشاور یک', username: 'agent.one' });
  assert.equal(tm.status, 200, JSON.stringify(tm.json));

  // data at rest is encrypted
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!txt.includes('الهیه') && !txt.includes('09358595056'), 'plaintext leaked in ' + f);
  }
  // logout
  await a('POST', '/api/auth/logout');
  assert.equal((await a('GET', '/api/auth/me')).status, 401);
});
