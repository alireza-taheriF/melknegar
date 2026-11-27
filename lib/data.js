// Document keys and typed accessors on top of the store.
import { load, mutate } from './store.js';

export const USERS = 'sys:users';
export const PLATFORM = 'sys:platform';
export const tenantKey = (id) => `tenant:${id}`;

export const initUsers = () => ({ users: {}, byLogin: {}, byChat: {} });
export const initPlatform = () => ({ tenants: {}, orders: {}, orderSeq: 1000, bots: {}, publicRequests: 0 });
export const initTenant = () => ({ properties: {}, clients: {}, activity: [], settings: { agentsSeeAll: true }, seq: 100 });

export const loadUsers = async (opts) => (await load(USERS, opts)) || initUsers();
export const loadPlatform = async (opts) => (await load(PLATFORM, opts)) || initPlatform();
export const loadTenant = async (id, opts) => (await load(tenantKey(id), opts)) || initTenant();

export const mutateUsers = (fn) => mutate(USERS, fn, { init: initUsers });
export const mutatePlatform = (fn) => mutate(PLATFORM, fn, { init: initPlatform });
export const mutateTenant = (id, fn) => mutate(tenantKey(id), fn, { init: initTenant });

export function loginKeys(user) {
  const keys = [];
  if (user.username) keys.push('u:' + user.username.toLowerCase());
  if (user.phone) keys.push('p:' + user.phone);
  return keys;
}

export function addActivity(t, entry) {
  t.activity.unshift({ at: Date.now(), ...entry });
  if (t.activity.length > 300) t.activity.length = 300;
}

// What a user record looks like to the client (never secrets).
export function publicUser(u, tenant) {
  return {
    id: u.id,
    name: u.name,
    username: u.username || '',
    phone: u.phone || '',
    role: u.role,
    staff: u.staff || null,
    tenantId: u.tenantId || null,
    tenantName: tenant?.name || '',
    mustChange: Boolean(u.mustChange),
    telegram: Boolean(u.tg?.chatId),
    bale: Boolean(u.bale?.chatId),
  };
}
