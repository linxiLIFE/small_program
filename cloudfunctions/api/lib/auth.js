const { COLLECTIONS, ROLE_LABELS } = require('./constants');
const { db, getContext, getOptional, find } = require('./db');
const { AppError, assert } = require('./errors');

function requireOpenId() {
  const context = getContext();
  assert(context.openid, 'UNAUTHENTICATED', '请先登录微信账号', 401);
  return context;
}

function userIdentityKey(openid) {
  const value = String(openid || '').trim();
  assert(value, 'UNAUTHENTICATED', '请先登录微信账号', 401);
  // 手机号只是预约联系方式，不能作为用户主键，也不能触发账号合并。
  return value;
}

async function getUser(openid, reader = db) {
  return getOptional(COLLECTIONS.users, userIdentityKey(openid), reader);
}

async function ensureUser(openid, context = {}, writer = db) {
  const identityKey = userIdentityKey(openid);
  const existing = await getUser(identityKey, writer);
  if (existing) return existing;
  const now = Date.now();
  const user = {
    _id: identityKey,
    openid: identityKey,
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
  await writer.collection(COLLECTIONS.users).doc(identityKey).set({ data: user });
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
  if (account.role === 'TECHNICIAN') {
    const technician = await getOptional(COLLECTIONS.technicians, account.technicianId);
    assert(technician && technician.enabled !== false, 'FORBIDDEN', '技师账号已停用', 403);
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

module.exports = { requireOpenId, userIdentityKey, getUser, ensureUser, getStaffAccount, requireRole, safeUser };
