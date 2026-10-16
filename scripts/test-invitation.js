const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const lib = path.resolve(process.argv[2] || path.join(__dirname, '../cloudfunctions/api/lib'));
const { COLLECTIONS: C } = require(path.join(lib, 'constants'));
const clone = value => structuredClone(value);
const now = Date.parse('2026-10-12T12:00:00+08:00');
class ClockDate extends Date { static now() { return now; } }
let rows, context, reward, failWrite;
const find = async (table, where, options = {}) => {
  let result = Object.values(rows[table] || {}).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  if (options.orderBy) {
    const { field, direction } = options.orderBy;
    result.sort((a, b) => (Number(a[field] || 0) - Number(b[field] || 0)) * (direction === 'desc' ? -1 : 1));
  }
  return clone(result.slice(options.skip || 0, (options.skip || 0) + (options.limit || 10000)));
};
const getOptional = async (table, id) => clone(rows[table]?.[id] || null);
const db = {
  collection: table => ({ doc: id => ({ set: async ({ data }) => {
    if (failWrite && failWrite.table === table && failWrite.id === id) throw new Error('WRITE_FAILED');
    (rows[table] ||= {})[id] = clone(data);
  } }) }),
  insertIfAbsent: async (table, id, data) => { if (!rows[table]?.[id]) (rows[table] ||= {})[id] = clone(data); },
  runTransaction: async callback => {
    const before = clone(rows);
    try { return await callback(db); } catch (error) { rows = before; throw error; }
  }
};
const stubs = {
  './db': { db, getOptional, find },
  './auth': {
    requireOpenId: () => context,
    requireRole: async () => ({ context, account: { role: 'OWNER' } }),
    ensureUser: async id => rows[C.users][id],
    safeUser: (user, points) => ({ invited: !!user.invitedBy, points: points.available, inviteCode: user.inviteCode })
  },
  './settings': { getCurrentSettings: async () => ({ points: { inviteRewardPoints: reward } }) },
  './notification-service': { notifyOrderEvent: async () => {} }
};
const modules = {};
function load(name) {
  if (modules[name]) return modules[name].exports;
  const mod = { exports: {} }; modules[name] = mod;
  vm.runInNewContext(fs.readFileSync(path.join(lib, `${name}.js`), 'utf8'), {
    module: mod, exports: mod.exports, Date: ClockDate, Buffer, console, process,
    require: ref => stubs[ref] || (ref.startsWith('./') ? load(ref.slice(2)) : require(ref))
  }, { filename: `${name}.js` });
  return mod.exports;
}
const invitation = load('invitation'), booking = load('booking');
function reset() {
  context = { openid: 'friend' }; reward = 10; failWrite = null;
  rows = { [C.users]: {
    inviter: { openid: 'inviter', inviteCode: 'ABC12345', nickname: '邀请者' },
    friend: { openid: 'friend', inviteCode: 'FRIEND12', nickname: '好友', phoneCipher: 'private', phoneMasked: 'private' }
  }, [C.pointsAccounts]: { inviter: { available: 50, frozen: 7, debt: 0, version: 1 } } };
}
function order(id = 'first', overrides = {}) {
  const value = { id, userId: 'friend', status: 'RESERVED', paymentStatus: 'SUCCESS', refundStatus: 'NOT_REQUIRED',
    technicianId: 'tech', date: '2026-10-12', startAt: now - 3600000, endAt: now, paidFen: 3000,
    pointRuleSnapshot: { pointRateFen: 100 }, ...overrides };
  (rows[C.orders] ||= {})[id] = value;
  return value;
}
async function bind() { return invitation.bindInviteCode({ inviteCode: 'abc12345' }); }
async function history() { context = { openid: 'inviter' }; return invitation.listInviteRecords(); }

async function testPointsPage() {
  let page, clipboard, response, failure = false;
  const cursors = [];
  const api = {
    listPoints: async () => ({ account: { available: 60 }, ledger: [] }),
    getProfile: async () => ({ inviteCode: 'ABC12345' }),
    getSettings: async () => ({ points: { inviteRewardPoints: 0 } }),
    listInviteRecords: async cursor => {
      cursors.push(cursor);
      if (failure) throw new Error('暂时加载失败');
      return response;
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/points/index.js'), 'utf8'), {
    Page: definition => { page = definition; },
    wx: { setClipboardData: value => { clipboard = value.data; }, showToast: () => {} },
    require: ref => ref === '../../utils/api' ? api : require(path.resolve(__dirname, '../pages/points', ref))
  });
  page.setData = values => Object.assign(page.data, values);
  await page.loadPoints();
  assert.equal(page.data.inviteRewardPoints, 0, 'zero rewards must not be displayed as ten');
  page.copyInviteCode(); assert.equal(clipboard, 'ABC12345');
  response = { records: [{ id: 'first', status: 'PENDING', rewardPoints: 10, boundAt: now }], nextCursor: 20 };
  await page.loadInviteRecords();
  assert.equal(page.data.inviteRecords[0].rewardLabel, '10 积分');
  assert.equal(page.data.inviteRecords[0].boundTimeLabel, '2026年10月12日 12:00');
  response = { records: [{ id: 'second', status: 'GRANTED', rewardPoints: 10, boundAt: now, grantedAt: now }], nextCursor: null };
  failure = true;
  await page.loadInviteRecords({ currentTarget: { dataset: { more: true } } });
  assert.equal(page.data.inviteRecords.length, 1);
  assert.equal(page.data.inviteRecordsError, '暂时加载失败');
  failure = false;
  await page.loadInviteRecords({ currentTarget: { dataset: { retry: true } } });
  assert.equal(page.data.inviteRecords.length, 2);
  assert.equal(page.data.inviteRecords[1].rewardLabel, '+10 积分');
  assert.equal(page.data.inviteRecords[1].grantedTimeLabel, '2026年10月12日 12:00');
  assert.equal(page.data.inviteRecordsError, '');
  // A failed refresh after the last page must retry page zero, without appending stale records.
  failure = true; await page.loadInviteRecords();
  failure = false; await page.loadInviteRecords({ currentTarget: { dataset: { retry: true } } });
  assert.equal(page.data.inviteRecords.length, 1);
  assert.deepStrictEqual(cursors, [0, 20, 20, 0, 0]);
  console.log('invitation page passed: zero reward, full-code copy, status/time labels, pagination and retry after failed refresh');
}

(async () => {
  reset();
  const binding = await bind();
  assert.equal(binding.profile.points, 0);
  assert.equal(binding.rewardPoints, 0, 'the binding response must not report an invitee reward');
  assert.equal(binding.inviterRewardPoints, 10);
  assert.equal(rows[C.pointsAccounts].inviter.available, 50, 'binding must not reward the inviter');
  assert(!rows[C.pointsAccounts].friend, 'binding must not create or credit an invitee wallet');
  assert.equal(Object.keys(rows[C.pointsLedger] || {}).length, 0, 'binding must not write any points ledger');
  assert.equal((await history()).records[0].status, 'PENDING');
  context = { openid: 'friend' };
  order('first', { startAt: now, endAt: now + 3600000 });
  await assert.rejects(booking.markServiceCompleted('first'), error => error.code === 'INVALID_TRANSITION');
  await booking.transitionStaff('first', 'checkIn');
  assert.equal(rows[C.pointsAccounts].inviter.available, 50, 'arrival must not issue the reward');
  await assert.rejects(booking.markServiceCompleted('first'), error => error.code === 'SERVICE_COMPLETE_TOO_EARLY');
  await booking.markServiceCompleted('first', now + 3600000);
  assert.equal(rows[C.pointsAccounts].inviter.available, 60);
  assert.equal(rows[C.pointsAccounts].friend.available, 30, 'invitees still earn normal service points, without an invitation bonus');
  assert(!rows[C.pointsLedger].invite_friend_invitee);
  assert.equal(rows[C.pointsLedger].invite_friend_inviter.createdAt, now + 3600000);
  assert.equal(rows[C.pointsLedger].invite_friend_inviter.orderId, 'first');
  const beforeRetry = clone(rows);
  await booking.markServiceCompleted('first', now + 3600000);
  assert.deepStrictEqual(rows, beforeRetry);
  order('second', { status: 'IN_SERVICE', arrivedAt: now - 1000 });
  await booking.transitionStaff('second', 'complete');
  assert.equal(rows[C.pointsAccounts].inviter.available, 60, 'additional services and cart child orders must not issue another reward');
  const record = (await history()).records[0];
  assert.equal(record.status, 'GRANTED'); assert.equal(record.rewardPoints, 10);
  assert.equal(record.boundAt, now); assert.equal(record.grantedAt, now + 3600000);
  for (const key of ['openid', 'phoneMasked', 'phoneCipher', 'invitedBy', 'balanceAfter']) assert(!(key in record));
  context = { openid: 'unrelated' };
  assert.equal((await invitation.listInviteRecords({ userId: 'inviter' })).records.length, 0);

  reset();
  const originalAccount = { id: 'friend', available: 23, frozen: 4, debt: 8, version: 7 };
  rows[C.pointsAccounts].friend = clone(originalAccount);
  const walletsBeforeBinding = clone(rows[C.pointsAccounts]);
  assert.equal((await bind()).profile.points, 23);
  assert.deepStrictEqual(rows[C.pointsAccounts], walletsBeforeBinding, 'binding must preserve both existing wallets, including debt and frozen points');
  assert.equal(Object.keys(rows[C.pointsLedger] || {}).length, 0);

  for (const overrides of [{ status: 'CANCELLED' }, { status: 'REFUNDED' }, { status: 'NO_SHOW_REVIEW' },
    { status: 'ARRIVED', paymentStatus: 'NOT_STARTED' }, { status: 'ARRIVED', refundStatus: 'PROCESSING' }]) {
    reset(); await bind(); order('invalid', overrides);
    await assert.rejects(booking.markServiceCompleted('invalid'));
    assert.equal(rows[C.pointsAccounts].inviter.available, 50);
    assert(!rows[C.pointsLedger]?.invite_friend_inviter);
  }
  reset(); await bind(); reward = 100;
  rows[C.pointsAccounts].inviter.debt = 6;
  order('first', { status: 'ARRIVED' });
  await booking.markServiceCompleted('first');
  assert.equal(rows[C.pointsLedger].invite_friend_inviter.amount, 10, 'use binding-time rule snapshot');
  assert.equal(rows[C.pointsAccounts].inviter.available, 54);
  assert.equal(rows[C.pointsAccounts].inviter.debt, 0);
  assert.equal(rows[C.pointsAccounts].inviter.frozen, 7);
  assert.equal((await history()).records[0].debtRepaid, 6);

  reset(); reward = 0; await bind(); reward = 10;
  order('first', { status: 'ARRIVED' }); await booking.markServiceCompleted('first');
  assert.equal(rows[C.pointsAccounts].inviter.available, 50);
  assert.equal((await history()).records[0].status, 'DISABLED');

  reset();
  Object.assign(rows[C.users].friend, { invitedBy: 'inviter', inviteCodeBoundAt: now - 86400000, inviteRewardSnapshot: 10 });
  rows[C.pointsLedger] = { invite_friend_inviter: { userId: 'inviter', amount: 10, createdAt: now - 86400000 } };
  assert.equal((await history()).records[0].status, 'GRANTED', 'legacy immediate rewards must show their actual ledger time');
  order('first', { status: 'ARRIVED' }); await booking.markServiceCompleted('first');
  assert.equal(rows[C.pointsAccounts].inviter.available, 50, 'legacy reward must not be paid again');
  rows[C.users].friend.inviterRewardStatus = 'PENDING';
  order('second', { status: 'ARRIVED' }); await booking.markServiceCompleted('second');
  assert.equal(rows[C.pointsAccounts].inviter.available, 50, 'ledger provides a second duplicate guard');

  // Old invitees may already have received a binding bonus. Keep that history
  // intact while allowing the pending inviter reward to settle at completion.
  reset();
  Object.assign(rows[C.users].friend, { invitedBy: 'inviter', inviteCodeBoundAt: now - 86400000,
    inviteRewardSnapshot: 10, inviterRewardStatus: 'PENDING' });
  rows[C.pointsAccounts].friend = { available: 10, frozen: 0, debt: 0, version: 2 };
  const historicalBonus = { userId: 'friend', type: 'INVITE_REWARD', amount: 10, createdAt: now - 86400000 };
  rows[C.pointsLedger] = { invite_friend_invitee: clone(historicalBonus) };
  order('first', { status: 'ARRIVED' }); await booking.markServiceCompleted('first');
  assert.equal(rows[C.pointsAccounts].inviter.available, 60);
  assert.equal(rows[C.pointsAccounts].friend.available, 40, 'historical points remain alongside normal service points');
  assert.deepStrictEqual(rows[C.pointsLedger].invite_friend_invitee, historicalBonus);
  await booking.markServiceCompleted('first');
  assert.equal(rows[C.pointsAccounts].inviter.available, 60);

  reset(); await bind(); order('first', { status: 'ARRIVED' });
  failWrite = { table: C.pointsLedger, id: 'invite_friend_inviter' };
  const beforeFailure = clone(rows);
  await assert.rejects(booking.markServiceCompleted('first'), /WRITE_FAILED/);
  assert.deepStrictEqual(rows, beforeFailure, 'order, both wallets and ledgers roll back together');
  failWrite = null; await booking.markServiceCompleted('first');
  assert.equal(rows[C.pointsAccounts].inviter.available, 60);

  reset(); await assert.rejects(invitation.bindInviteCode({ inviteCode: 'FRIEND12' }), error => error.code === 'INVITE_SELF_NOT_ALLOWED');
  await assert.rejects(invitation.bindInviteCode({ inviteCode: 'MISSING1' }), error => error.code === 'INVITE_CODE_NOT_FOUND');
  await bind(); await assert.rejects(bind(), error => error.code === 'INVITE_ALREADY_BOUND');
  reset(); order('old', { deletedAt: now, status: 'CANCELLED' });
  await assert.rejects(bind(), error => error.code === 'INVITE_NEW_USER_ONLY');

  reset(); context = { openid: 'inviter' };
  for (let index = 0; index < 23; index++) rows[C.users][`friend-${index}`] = {
    openid: `friend-${index}`, invitedBy: 'inviter', nickname: `好友${index}`,
    inviteCodeBoundAt: now + index, inviteRewardSnapshot: 10, inviterRewardStatus: 'PENDING'
  };
  const firstPage = await invitation.listInviteRecords();
  assert.equal(firstPage.records.length, 20); assert.equal(firstPage.nextCursor, 20);
  assert.equal(firstPage.records[0].nickname, '好友22');
  const lastPage = await invitation.listInviteRecords({ cursor: firstPage.nextCursor });
  assert.equal(lastPage.records.length, 3); assert.equal(lastPage.nextCursor, null);
  await testPointsPage();
  console.log('invitation passed: inviter-only rewards, no binding wallet/ledger writes, deferred one-time payout, normal service points, snapshots, legacy history, rollback, privacy, binding guards and pagination');
})().catch(error => { console.error(error); process.exitCode = 1; });
