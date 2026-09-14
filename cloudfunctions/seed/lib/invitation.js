const crypto = require('crypto');
const { COLLECTIONS } = require('./constants');
const { db, find, getOptional } = require('./db');
const { requireOpenId, ensureUser, safeUser } = require('./auth');
const { getCurrentSettings } = require('./settings');
const { assert } = require('./errors');

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
    const now = Date.now();
    for (const id of ids) await transaction.insertIfAbsent(COLLECTIONS.pointsAccounts, id, emptyAccount(id, now));
    const accounts = {};
    for (const id of ids) accounts[id] = await getOptional(COLLECTIONS.pointsAccounts, id, transaction);
    if (reward > 0) {
      for (const [userId, role] of [[inviterId, '邀请好友奖励'], [context.openid, '新用户受邀奖励']]) {
        const account = accounts[userId];
        const available = Number(account.available || 0) + reward;
        await transaction.collection(COLLECTIONS.pointsAccounts).doc(userId).set({ data: { ...account, available, version: Number(account.version || 0) + 1, updatedAt: now } });
        const ledgerId = `invite_${context.openid}_${userId === inviterId ? 'inviter' : 'invitee'}`;
        await transaction.collection(COLLECTIONS.pointsLedger).doc(ledgerId).set({ data: { _id: ledgerId, id: ledgerId, userId, type: 'INVITE_REWARD', amount: reward, balanceAfter: available, description: role, relatedUserId: userId === inviterId ? context.openid : inviterId, createdAt: now, updatedAt: now } });
      }
    }
    const nextInvitee = { ...invitee, invitedBy: inviterId, inviteCodeBoundAt: now, inviteRewardSnapshot: reward, updatedAt: now };
    await transaction.collection(COLLECTIONS.users).doc(context.openid).set({ data: nextInvitee });
    return { user: nextInvitee, points: { ...accounts[context.openid], available: Number(accounts[context.openid].available || 0) + reward }, reward };
  });
  return { profile: safeUser(result.user, result.points), rewardPoints: result.reward };
}

module.exports = { ensureInviteCode, bindInviteCode, newInviteCode };
