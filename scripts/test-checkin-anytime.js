const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const lib = path.resolve(process.argv[2] || path.join(__dirname, '../cloudfunctions/api/lib'));
const { COLLECTIONS } = require(path.join(lib, 'constants'));
const now = Date.parse('2026-10-10T12:00:00+08:00');
class ClockDate extends Date { static now() { return now; } }
let rows;
let account;
let writes;
const transaction = {
  collection: name => ({ doc: id => ({ set: async ({ data }) => {
    rows[name] ||= {};
    rows[name][id] = structuredClone(data);
    writes.push({ name, id });
  } }) })
};
const stubs = {
  './db': {
    db: { runTransaction: async callback => callback(transaction) },
    getOptional: async (name, id) => rows[name]?.[id] || null
  },
  './auth': {
    requireRole: async () => ({ context: {}, account }),
    requireOpenId: () => ({ openid: 'customer' })
  },
  './notification-service': { notifyOrderEvent: async () => {} },
  qrcode: { toDataURL: async () => 'data:image/png;base64,test' }
};
const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const filename = path.join(lib, `${name}.js`);
  const nativeRequire = createRequire(filename);
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: mod, exports: mod.exports, Date: ClockDate, Buffer, console,
    process: { env: { CHECKIN_SIGNING_SECRET: 'checkin-test-secret-at-least-32-bytes-long' } },
    require: ref => stubs[ref] || (['./booking', './finance-state'].includes(ref) ? load(ref.slice(2)) : nativeRequire(ref))
  }, { filename });
  return modules[name] = mod.exports;
}
const booking = load('booking');
const checkin = load('checkin');
function reset(offsetDays = 3, overrides = {}) {
  const startAt = now + offsetDays * 86400000;
  const order = {
    id: 'order', userId: 'customer', technicianId: 'tech', date: '2026-10-13',
    status: 'RESERVED', paymentStatus: 'SUCCESS', refundStatus: 'NOT_REQUIRED',
    startAt, endAt: startAt + 3600000, checkInNonce: 'nonce', paidFen: 3000,
    bookingRuleSnapshot: { noShowGraceMinutes: 15 }, ...overrides
  };
  rows = {
    [COLLECTIONS.orders]: { order },
    [COLLECTIONS.technicianDays]: { 'tech_2026-10-13': {
      id: 'tech_2026-10-13', occupancies: [{ orderId: 'order', startAt, endAt: order.endAt, status: order.status }]
    } }
  };
  account = { role: 'OWNER' };
  writes = [];
  return order;
}
function token() {
  return checkin.encodeToken({ v: 1, orderId: 'order', nonce: 'nonce', expiresAt: now + 60000 });
}

(async () => {
  for (const days of [3, 14, -7]) {
    const original = reset(days);
    const result = await booking.transitionStaff('order', 'checkIn');
    assert.equal(result.status, 'ARRIVED');
    assert.equal(result.arrivedAt, now);
    assert.equal(rows[COLLECTIONS.technicianDays]['tech_2026-10-13'].occupancies[0].status, 'ARRIVED');
    assert.equal(rows[COLLECTIONS.jobs].job_service_complete_order.nextRunAt, Math.max(now, original.endAt));
    const writeCount = writes.length;
    await booking.transitionStaff('order', 'checkIn');
    assert.equal(writes.length, writeCount, 'duplicate check-in must not write the order or job again');
    if (days > 0) {
      await assert.rejects(booking.transitionStaff('order', 'start'), error => error.code === 'SERVICE_TOO_EARLY');
      await assert.rejects(booking.markServiceCompleted('order'), error => error.code === 'SERVICE_COMPLETE_TOO_EARLY');
    }
  }
  reset();
  account = { role: 'TECHNICIAN', technicianId: 'tech' };
  assert.equal((await checkin.redeemCheckInCode(token())).order.status, 'ARRIVED');
  assert.equal((await checkin.redeemCheckInCode(token())).duplicate, true);
  reset(-7, { status: 'NO_SHOW_REVIEW' });
  const generated = await checkin.getCheckInCode('order');
  assert.equal(checkin.decodeToken(generated.token).expiresAt, now + 86400000);
  assert.equal((await checkin.redeemCheckInCode(generated.token)).order.status, 'ARRIVED');
  reset();
  account = { role: 'TECHNICIAN', technicianId: 'other' };
  await assert.rejects(checkin.redeemCheckInCode(token()), error => error.code === 'FORBIDDEN');
  assert.equal(writes.length, 0);
  for (const status of ['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED', 'COMPLETED']) {
    reset(3, { status });
    await assert.rejects(checkin.redeemCheckInCode(token()), error => error.code === 'INVALID_TRANSITION');
    assert.equal(writes.length, 0);
  }
  for (const overrides of [{ paymentStatus: 'UNKNOWN' }, { refundStatus: 'PROCESSING' }]) {
    reset(3, overrides);
    await assert.rejects(checkin.redeemCheckInCode(token()), error => error.code === 'REFUND_IN_PROGRESS');
    assert.equal(writes.length, 0);
  }
  reset();
  await assert.rejects(checkin.redeemCheckInCode(`${token()}x`), error => error.code === 'CHECKIN_CODE_INVALID');
  const expired = checkin.encodeToken({ orderId: 'order', nonce: 'nonce', expiresAt: now - 1 });
  await assert.rejects(checkin.redeemCheckInCode(expired), error => error.code === 'CHECKIN_CODE_EXPIRED');
  const wrongNonce = checkin.encodeToken({ orderId: 'order', nonce: 'wrong', expiresAt: now + 60000 });
  await assert.rejects(checkin.redeemCheckInCode(wrongNonce), error => error.code === 'CHECKIN_CODE_INVALID');
  assert.equal(writes.length, 0);
  console.log('anytime check-in passed: early/late QR and manual check-in, occupancy, scheduled completion, duplicates, technician ownership, order/payment/refund guards and signed token expiry');
})().catch(error => { console.error(error); process.exitCode = 1; });
