// Module 1: the agency's smart ledger (files and clients).
import { mutateTenant, loadTenant, addActivity } from './data.js';
import { cleanProperty, cleanClient, isStale } from './domain.js';
import { id } from './util.js';
import { notFound, forbidden, bad } from './http.js';

const MAX_PROPERTIES = 20000;
const MAX_CLIENTS = 10000;

export function canSee(user, t, rec) {
  if (user.role === 'owner' || user.staff) return true;
  if (t.settings?.agentsSeeAll !== false) return true;
  return rec.agentId === user.id;
}

function canEdit(user, rec) {
  return user.role === 'owner' || user.staff || rec.agentId === user.id || !rec.agentId;
}

// Owner phone numbers stay hidden from other agents when the agency restricts it.
export function viewProperty(user, t, p) {
  if (canSee(user, t, p)) return p;
  return null;
}

export async function listAll(user) {
  const t = await loadTenant(user.tenantId);
  const props = Object.values(t.properties).filter((p) => !p.deleted && canSee(user, t, p));
  const clients = Object.values(t.clients).filter((c) => !c.deleted && canSee(user, t, c));
  return { t, props, clients };
}

export async function createRecords(user, items, source = 'app') {
  const created = { properties: [], clients: [] };
  await mutateTenant(user.tenantId, (t) => {
    created.properties = [];
    created.clients = [];
    for (const it of items) {
      const at = Date.now();
      if (it.kind === 'client') {
        if (Object.keys(t.clients).length >= MAX_CLIENTS) throw bad('سقف تعداد مشتری پر شده است');
        const c = cleanClient(it.data || {});
        c.id = id('c_');
        c.no = ++t.seq;
        c.agentId = user.id;
        c.createdAt = at;
        c.updatedAt = at;
        c.source = source;
        t.clients[c.id] = c;
        created.clients.push(c);
        addActivity(t, { by: user.id, kind: 'client.create', ref: c.id, text: `مشتری جدید: ${c.name || 'بدون نام'}` });
      } else {
        if (Object.keys(t.properties).length >= MAX_PROPERTIES) throw bad('سقف تعداد فایل پر شده است');
        const p = cleanProperty(it.data || {});
        p.id = id('p_');
        p.no = ++t.seq;
        p.agentId = user.id;
        p.createdAt = at;
        p.updatedAt = at;
        p.confirmedAt = at;
        p.source = source;
        t.properties[p.id] = p;
        created.properties.push(p);
        addActivity(t, { by: user.id, kind: 'property.create', ref: p.id, text: `فایل جدید #${p.no} ${p.neighborhood || ''}`.trim() });
      }
    }
  });
  return created;
}

export async function updateProperty(user, pid, patch) {
  let out;
  await mutateTenant(user.tenantId, (t) => {
    const p = t.properties[pid];
    if (!p || p.deleted) throw notFound('فایل پیدا نشد');
    if (!canEdit(user, p)) throw forbidden('فقط مشاور ثبت‌کننده یا مدیر دفتر می‌تواند این فایل را ویرایش کند');
    const prevStatus = p.status;
    const next = cleanProperty(patch, p);
    next.updatedAt = Date.now();
    if (patch.confirm || next.status !== prevStatus) next.confirmedAt = Date.now();
    if (next.status !== prevStatus && ['sold', 'rented'].includes(next.status)) next.closedAt = Date.now();
    if (patch.needsReview === undefined && patch.reviewed) next.needsReview = false;
    t.properties[pid] = next;
    out = next;
    const label = { sold: 'فروخته شد', rented: 'اجاره رفت', withdrawn: 'از دسترس خارج شد', active: 'فعال شد', unknown: 'وضعیت نامعلوم' }[next.status];
    addActivity(t, { by: user.id, kind: 'property.update', ref: pid, text: next.status !== prevStatus ? `فایل #${p.no} ${label}` : patch.confirm ? `فایل #${p.no} تأیید شد (هنوز موجود)` : `فایل #${p.no} ویرایش شد` });
  });
  return out;
}

export async function deleteProperty(user, pid) {
  await mutateTenant(user.tenantId, (t) => {
    const p = t.properties[pid];
    if (!p || p.deleted) throw notFound('فایل پیدا نشد');
    if (!canEdit(user, p)) throw forbidden();
    p.deleted = true;
    p.deletedAt = Date.now();
    addActivity(t, { by: user.id, kind: 'property.delete', ref: pid, text: `فایل #${p.no} حذف شد` });
  });
}

export async function updateClient(user, cid, patch) {
  let out;
  await mutateTenant(user.tenantId, (t) => {
    const c = t.clients[cid];
    if (!c || c.deleted) throw notFound('مشتری پیدا نشد');
    if (!canEdit(user, c)) throw forbidden();
    const next = cleanClient(patch, c);
    next.updatedAt = Date.now();
    if (patch.reviewed) next.needsReview = false;
    t.clients[cid] = next;
    out = next;
    addActivity(t, { by: user.id, kind: 'client.update', ref: cid, text: `مشتری ${next.name || '#' + c.no} ویرایش شد` });
  });
  return out;
}

export async function deleteClient(user, cid) {
  await mutateTenant(user.tenantId, (t) => {
    const c = t.clients[cid];
    if (!c || c.deleted) throw notFound('مشتری پیدا نشد');
    if (!canEdit(user, c)) throw forbidden();
    c.deleted = true;
    c.deletedAt = Date.now();
    addActivity(t, { by: user.id, kind: 'client.delete', ref: cid, text: `مشتری ${c.name || '#' + c.no} حذف شد` });
  });
}

export function summarize(props, clients) {
  const t = Date.now();
  const month = 30 * 86400000;
  return {
    active: props.filter((p) => p.status === 'active').length,
    closedMonth: props.filter((p) => ['sold', 'rented'].includes(p.status) && t - (p.closedAt || 0) < month).length,
    stale: props.filter((p) => isStale(p, t)).length,
    review: props.filter((p) => p.needsReview).length + clients.filter((c) => c.needsReview).length,
    clients: clients.filter((c) => c.status === 'active').length,
    total: props.length,
  };
}
