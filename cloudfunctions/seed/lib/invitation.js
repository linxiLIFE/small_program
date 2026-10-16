const crypto = require('crypto');
const { COLLECTIONS, ORDER_STATUS, PAYMENT_STATUS } = require('./constants');
const { db, find, getOptional } = require('./db');
const { requireOpenId, ensureUser, safeUser } = require('./auth');
const { getCurrentSettings } = require('./settings');
const { assert } = require('./errors');
const { awardPoints } = require('./money');

function newInviteCode() {
  return crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase();
}

function emptyAccount(userId, now = Date.now()) {
  return { _id: userId, id: userId, userId, available: 0, frozen: 0, debt: 0, version: 1, createdAt: now, updatedAt: now };
}

async function ensureInviteCode(openid, context = {}) {
  await ensureUser(openid, context);
  return db.runTransaction(async (transaction) => {
    const user = await getOptional(COLLECTIONS.users, openid, transaction);
    if (user.inviteCode) return user;
    const next = { ...user, inviteCode: newInviteCode(), updatedAt: Date.now() };
    await transaction.collection(COLLECTIONS.users).doc(openid).set({ data: next });
    return next;
  });
}

async function bindInviteCode(payload = {}) {
  const context = requireOpenId();
  const code = String(payload.inviteCode || '').trim().toUpperCase();
  assert(/^[A-Z0-9]{6,16}$/.test(code), 'INVITE_CODE_INVALID', '邀请码格式不正确');
  await ensureInviteCode(context.openid, context);
  const candidates = await find(COLLECTIONS.users, { inviteCode: code }, { limit: 1 });
  const inviterSnapshot = candidates[0];
  assert(inviterSnapshot, 'INVITE_CODE_NOT_FOUND', '邀请码不存在');
  const inviterId = inviterSnapshot.openid || inviterSnapshot.id || inviterSnapshot._id;
  assert(inviterId !== context.openid, 'INVITE_SELF_NOT_ALLOWED', '不能绑定自己的邀请码');
  const settings = await getCurrentSettings();
  const reward = Number(settings.points && settings.points.inviteRewardPoints || 0);
  const ids = [context.openid, inviterId].sort();
  const result = await db.runTransaction(async (transaction) => {
    const locked = {};
    for (const id of ids) locked[id] = await getOptional(COLLECTIONS.users, id, transaction);
    const invitee = locked[context.openid];
    const inviter = locked[inviterId];
    assert(invitee && inviter && inviter.inviteCode === code, 'INVITE_CODE_NOT_FOUND', '邀请码不存在');
    assert(!invitee.invitedBy, 'INVITE_ALREADY_BOUND', '你已经绑定过邀请码', 409);
    const previousOrders = await find(COLLECTIONS.orders, { userId: context.openid }, { limit: 1 }, transaction);
    assert(!previousOrders.length, 'INVITE_NEW_USER_ONLY', '邀请码仅限还没有下过单的新用户绑定', 409);
    const now = Date.now();
    const points = await getOptional(COLLECTIONS.pointsAccounts, context.openid, transaction) || emptyAccount(context.openid, now);
    const nextInvitee = { ...invitee, invitedBy: inviterId, inviteCodeBoundAt: now, inviteRewardSnapshot: reward, inviterRewardStatus: reward > 0 ? 'PENDING' : 'DISABLED', updatedAt: now };
    await transaction.collection(COLLECTIONS.users).doc(context.openid).set({ data: nextInvitee });
    return { user: nextInvitee, points, reward };
  });
  return { profile: safeUser(result.user, result.points), rewardPoints: 0, inviterRewardPoints: result.reward };
}

// The invitee row is locked in the completion transaction, so different orders
// and job retries can only award this invitation once. Legacy paid rewards use
// the same ledger ID and must never be paid again.
async function awardInviterReward(transaction, order, now = Date.now()) {
  if (order.status !== ORDER_STATUS.COMPLETED || order.paymentStatus !== PAYMENT_STATUS.SUCCESS
    || !['NOT_REQUIRED', '', undefined, null].includes(order.refundStatus)) return;
  const invitee = await getOptional(COLLECTIONS.users, order.userId, transaction);
  if (!invitee || !invitee.invitedBy || invitee.inviterRewardStatus !== 'PENDING') return;
  const reward = Number(invitee.inviteRewardSnapshot || 0);
  if (!Number.isSafeInteger(reward) || reward <= 0) return;
  const ledgerId = `invite_${order.userId}_inviter`;
  const existing = await getOptional(COLLECTIONS.pointsLedger, ledgerId, transaction);
  if (existing) return;
  const inviterId = invitee.invitedBy;
  await transaction.insertIfAbsent(COLLECTIONS.pointsAccounts, inviterId, emptyAccount(inviterId, now));
  const account = await getOptional(COLLECTIONS.pointsAccounts, inviterId, transaction);
  const balance = awardPoints({ availablePoints: account.available || 0, debtPoints: account.debt || 0, earnedPoints: reward });
  await transaction.collection(COLLECTIONS.pointsAccounts).doc(inviterId).set({ data: { ...account, ...balance, version: Number(account.version || 0) + 1, updatedAt: now } });
  await transaction.collection(COLLECTIONS.pointsLedger).doc(ledgerId).set({ data: {
    _id: ledgerId, id: ledgerId, userId: inviterId, type: 'INVITE_REWARD', amount: reward,
    balanceAfter: balance.available, debtAfter: balance.debt,
    debtRepaid: Number(account.debt || 0) - balance.debt,
    description: '好友首次到店完成服务邀请奖励', relatedUserId: order.userId,
    orderId: order.id, createdAt: now, updatedAt: now
  } });
  await transaction.collection(COLLECTIONS.users).doc(order.userId).set({ data: {
    ...invitee, inviterRewardStatus: 'GRANTED', inviterRewardGrantedAt: now,
    inviterRewardOrderId: order.id, updatedAt: now
  } });
}

async function listInviteRecords(payload = {}) {
  const { openid } = requireOpenId();
  const cursor = Math.max(0, Math.floor(Number(payload.cursor) || 0));
  const limit = 20;
  const invitees = await find(COLLECTIONS.users, { invitedBy: openid }, {
    orderBy: { field: 'inviteCodeBoundAt', direction: 'desc' }, limit: limit + 1, skip: cursor
  });
  const records = await Promise.all(invitees.slice(0, limit).map(async (invitee, index) => {
    const inviteeId = invitee.openid || invitee.id || invitee._id;
    const ledger = await getOptional(COLLECTIONS.pointsLedger, `invite_${inviteeId}_inviter`);
    const granted = !!ledger && ledger.userId === openid;
    const rewardPoints = granted ? Number(ledger.amount || 0) : Number(invitee.inviteRewardSnapshot || 0);
    const status = granted ? 'GRANTED' : rewardPoints > 0 ? 'PENDING' : 'DISABLED';
    return {
      // Do not expose a friend's openid, phone or account balances.
      id: `invitation_${cursor + index}`,
      nickname: invitee.nickname || '微信用户', boundAt: Number(invitee.inviteCodeBoundAt || 0),
      rewardPoints, status, statusLabel: { GRANTED: '已到账', PENDING: '待发放', DISABLED: '无积分奖励' }[status],
      grantedAt: granted ? Number(ledger.createdAt || 0) : 0,
      debtRepaid: granted ? Number(ledger.debtRepaid || 0) : 0
    };
  }));
  return { records, nextCursor: invitees.length > limit ? cursor + limit : null };
}

module.exports = { ensureInviteCode, bindInviteCode, newInviteCode, awardInviterReward, listInviteRecords };
