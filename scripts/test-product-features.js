const assert = require('assert');
const crypto = require('crypto');

process.env.WX_API_V3_KEY = '12345678901234567890123456789012';
process.env.CHECKIN_SIGNING_SECRET = 'checkin-test-secret-at-least-32-bytes-long';

const { decryptNotification } = require('../cloudfunctions/api/lib/wechat-pay');
const { encodeToken, decodeToken } = require('../cloudfunctions/api/lib/checkin');
const { noShowSettlement, successfulRefundedFen, addonTypeOf, serviceIncludesBuilder, footTipAddonSnapshot, publicOrder } = require('../cloudfunctions/api/lib/booking');
const { addonPriceFen, isFreeRemovalAddon, serviceBookableStandalone, supportsFootTipAddon } = require('../cloudfunctions/api/lib/catalog');
const { cumulativeRefundedFen, remainingRefundableFen, refundInProgress } = require('../cloudfunctions/api/lib/finance-state');
const { templateData, subscriptionQuota } = require('../cloudfunctions/api/lib/notification-service');

let passed = 0;
function test(name, callback) { callback(); passed += 1; }

test('WeChat API v3 notification reads the appended GCM tag', () => {
  const nonce = 'abcdefghijkl';
  const associated_data = 'refund';
  const payload = { refund_id: '5030001', refund_status: 'SUCCESS' };
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(process.env.WX_API_V3_KEY), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associated_data));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()]).toString('base64');
  assert.deepStrictEqual(decryptNotification({ nonce, associated_data, ciphertext }), payload);
});

test('check-in QR token detects tampering', () => {
  const token = encodeToken({ v:1, orderId:'ord_1', nonce:'nonce_1', expiresAt:Date.now()+60000 });
  assert.strictEqual(decodeToken(token).orderId, 'ord_1');
  assert.throws(() => decodeToken(`${token}x`), /核销码校验失败/);
});

test('no-show penalty consumes points before cash', () => {
  assert.deepStrictEqual(noShowSettlement({ totalFen:5000, paidFen:3000, pointsConsumed:400, bookingRuleSnapshot:{noShowPenaltyFen:3000}, pointRuleSnapshot:{unit:20,discountFen:100} }), { penaltyFen:3000, penaltyPoints:400, refundPoints:0, refundCashFen:2000, noRefund:false });
});

test('orders below the penalty are not refunded', () => {
  assert.deepStrictEqual(noShowSettlement({ totalFen:2500, paidFen:1500, pointsConsumed:200, bookingRuleSnapshot:{noShowPenaltyFen:3000}, pointRuleSnapshot:{unit:20,discountFen:100} }), { penaltyFen:2500, penaltyPoints:200, refundPoints:0, refundCashFen:0, noRefund:true });
});

test('hand-nail removal pricing follows the 30-yuan threshold', () => {
  assert.strictEqual(addonTypeOf({ name: '卸甲片', tags: ['卸除'] }), 'REMOVAL');
  assert.strictEqual(addonTypeOf({ name: '塑形建构', isAddon: true }), 'BUILDER');
  assert.strictEqual(addonTypeOf({ name: '本甲建构纯色', isAddon: false }), '');
  assert.strictEqual(serviceIncludesBuilder({ name: '本甲建构纯色' }), true);
  assert.strictEqual(serviceIncludesBuilder({ name: '本甲纯色' }), false);
  assert.strictEqual(isFreeRemovalAddon({ id: 'svc-nail-removal-natural', name: '卸本甲', priceFen: 1000 }), true);
  const removals = [
    { id: 'svc-nail-removal-natural', name: '卸本甲', priceFen: 1000 },
    { id: 'svc-nail-removal-tips', name: '卸甲片', priceFen: 2000 },
    { id: 'svc-nail-removal-thick-builder', name: '卸超厚本甲建构', priceFen: 2000 }
  ];
  const nail30 = { id: 'svc-nail-natural-color-30', categoryId: 'nail', name: '本甲纯色｜30元色板', priceFen: 3000 };
  const vBuilder15 = { id: 'svc-nail-addon-v-builder', categoryId: 'nail', name: 'V建构', priceFen: 1500 };
  const nail50 = { id: 'svc-nail-natural-color-50', categoryId: 'nail', name: '本甲纯色｜50元色板', priceFen: 5000 };
  assert.deepStrictEqual(removals.map((item) => addonPriceFen(item, 'REMOVAL', nail30)), [0, 2000, 2000]);
  assert.deepStrictEqual(removals.map((item) => addonPriceFen(item, 'REMOVAL', vBuilder15)), [1000, 2000, 2000]);
  assert.deepStrictEqual(removals.map((item) => addonPriceFen(item, 'REMOVAL', nail50)), [0, 0, 0]);
  assert.strictEqual(addonPriceFen({ id: 'svc-foot-nail-removal-natural', name: '卸脚部本甲', priceFen: 1000 }, 'REMOVAL'), 0);
  assert.strictEqual(addonPriceFen({ id: 'svc-foot-nail-removal-tips', name: '卸脚甲片', priceFen: 2000 }, 'REMOVAL'), 2000);
});

test('foot natural-nail projects price tips by quantity without extra duration', () => {
  const service = { id: 'svc-foot-nail-natural-color-40', categoryId: 'foot-nail', name: '本甲纯色｜40元色板', tags: ['本甲'] };
  assert.strictEqual(supportsFootTipAddon(service), true);
  assert.strictEqual(supportsFootTipAddon({ id: 'svc-foot-nail-tips-40', categoryId: 'foot-nail', name: '10根脚甲片｜40元', tags: ['脚甲片'] }), false);
  assert.deepStrictEqual(footTipAddonSnapshot(service, 3), {
    id: 'svc-foot-nail-addon-single-tip', name: '加脚甲片 ×3', type: 'TIP', quantity: 3,
    unitPriceFen: 500, priceFen: 1500, originalPriceFen: 500, durationMinutes: 0
  });
  assert.throws(() => footTipAddonSnapshot(service, 11), (error) => error && error.code === 'INVALID_ADDON');
  assert.strictEqual(serviceBookableStandalone({ id: 'svc-foot-nail-removal-natural', categoryId: 'foot-nail', isAddon: true, addonType: 'REMOVAL', bookableStandalone: true }), false);
  assert.strictEqual(serviceBookableStandalone({ id: 'svc-nail-removal-natural', categoryId: 'nail', isAddon: true, addonType: 'REMOVAL', bookableStandalone: true }), true);
});

test('partial refunds keep only the unpaid remainder refundable', () => {
  const order = { paidFen: 10000, refundedFen: 3500, refundStatus: 'SUCCESS' };
  assert.strictEqual(cumulativeRefundedFen(order), 3500);
  assert.strictEqual(remainingRefundableFen(order), 6500);
  assert.strictEqual(refundInProgress(order), false);
  assert.strictEqual(refundInProgress({ ...order, refundStatus: 'PROCESSING' }), true);
});

test('failed automatic refunds expose the original amount for a locked retry', () => {
  const order = publicOrder({ id:'order1', status:'CANCELLED_NO_SHOW', paymentStatus:'SUCCESS', paidFen:4500, refundStatus:'WAITING_FUNDS', refundAmountFen:1500 });
  assert.strictEqual(order.lastRefundRequestedFen, 1500);
  assert.strictEqual(order.remainingRefundableFen, 4500);
  assert.strictEqual(order.refundInProgress, false);
});

test('explicit refund request amount wins over the legacy fallback', () => {
  const order = publicOrder({ id:'order1', status:'CANCELLED_NO_SHOW', paymentStatus:'SUCCESS', paidFen:4500, refundStatus:'WAITING_FUNDS', refundAmountFen:1500, requestedRefundFen:1000 });
  assert.strictEqual(order.lastRefundRequestedFen, 1000);
});

test('subscription template data uses the configured keyword types', () => {
  const order = { startAt: Date.parse('2026-09-15T10:30:00+08:00'), workSnapshot: { title: '奶油法式美甲' }, technicianSnapshot: { name: '林老师' }, refundAmountFen: 29900 };
  const settings = { store: { address: '哈尔滨市南岗区' } };
  assert.deepStrictEqual(templateData('appointmentSuccess', { serviceKey: 'thing1', timeKey: 'date2', technicianKey: 'thing19' }, order, settings), { thing1: { value: '奶油法式美甲' }, date2: { value: '2026-09-15' }, thing19: { value: '林老师' } });
  assert.deepStrictEqual(templateData('arrivalReminder', { serviceKey: 'thing2', timeKey: 'time1', addressKey: 'thing7' }, order, settings), { thing2: { value: '奶油法式美甲' }, time1: { value: '10:30' }, thing7: { value: '哈尔滨市南岗区' } });
  const checkInData = templateData('checkInSuccess', { serviceKey: 'thing1', timeKey: 'time5' }, order, settings);
  assert.deepStrictEqual(Object.keys(checkInData), ['thing1', 'time5']);
  assert(/^\d{2}:\d{2}$/.test(checkInData.time5.value));
  assert.deepStrictEqual(templateData('noShowRefund', { serviceKey: 'thing1', amountKey: 'amount6', storeKey: 'thing3' }, order, settings), { thing1: { value: '奶油法式美甲' }, amount6: { value: '299.00元' }, thing3: { value: '哈尔滨市南岗区' } });
});

test('subscription quota supports repeated booking authorizations', () => {
  assert.deepStrictEqual(subscriptionQuota({ status: 'accept', acceptedAt: 100, usedAt: 0 }), { acceptedCount: 1, usedCount: 0, availableCount: 1 });
  assert.deepStrictEqual(subscriptionQuota({ status: 'reject', acceptedCount: 3, usedCount: 2 }), { acceptedCount: 3, usedCount: 2, availableCount: 1 });
  assert.deepStrictEqual(subscriptionQuota({ status: 'acceptWithAudio', acceptedCount: 2, usedCount: 2 }), { acceptedCount: 2, usedCount: 2, availableCount: 0 });
});

(async () => {
  const reader = { query: async () => [[{ total_fen: 4000 }]] };
  assert.strictEqual(await successfulRefundedFen({ id: 'order1', paidFen: 4000, refundedFen: 3000 }, reader), 4000);
  await assert.rejects(successfulRefundedFen({ id: 'order1', paidFen: 4000, refundedFen: 3000 }, { query: async () => [[{ total_fen: 5000 }]] }), /退款记录与实付金额不一致/);
  passed += 1;
  console.log(`product feature tests passed: ${passed} QR, refund and notification crypto invariants`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
