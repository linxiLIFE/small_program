const { COLLECTIONS, ROLE_LABELS } = require('./constants');
const { db, getContext, getOptional, find } = require('./db');
const { AppError, assert } = require('./errors');

function requireOpenId() {
  const context = getContext();
  assert(context.openid, 'UNAUTHENTICATED', '请先登录微信账号', 401);
  return context;
}

async function getUser(openid, reader = db) {
  return getOptional(COLLECTIONS.users, openid, reader);
}

async function ensureUser(openid, context = {}, writer = db) {
  const existing = await getUser(openid, writer);
  if (existing) return existing;
  const now = Date.now();
  const user = {
    _id: openid,
    openid,
    appid: context.appid || '',
    unionid: context.unionid || '',
    nickname: '拾光访客',
    avatarUrl: '',
    phoneCipher: '',
    phoneMasked: '',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now
  };
  await writer.collection(COLLECTIONS.users).doc(openid).set({ data: user });
  return user;
}

async function getStaffAccount(openid) {
  const records = await find(COLLECTIONS.staff, { openid, active: true }, { limit: 1 });
  return records[0] || null;
}

async function requireRole(roles) {
  const context = getContext();
  assert(context.openid || context.uid, 'UNAUTHENTICATED', '请先登录管理账号', 401);
  const records = [];
  if (context.uid) records.push(...await find(COLLECTIONS.staff, { uid: context.uid, active: true }, { limit: 1 }));
  if (!records.length && context.openid) records.push(...await find(COLLECTIONS.staff, { openid: context.openid, active: true }, { limit: 1 }));
  const account = records[0] || null;
  if (!account || !roles.includes(account.role)) {
    throw new AppError('FORBIDDEN', '当前账号没有执行该操作的权限', 403);
  }
  return { context, account };
}

function safeUser(user, points = {}) {
  return {
    id: user.openid || user._id,
    nickname: user.nickname || '拾光访客',
    avatarUrl: user.avatarUrl || '',
    phoneMasked: user.phoneMasked || '',
    role: user.role || 'CUSTOMER',
    roleLabel: ROLE_LABELS[user.role] || '顾客',
    points: Number(points.available || 0),
    status: user.status || 'ACTIVE'
  };
}

module.exports = { requireOpenId, getUser, ensureUser, getStaffAccount, requireRole, safeUser };
