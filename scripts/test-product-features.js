const assert = require('assert');
const crypto = require('crypto');

process.env.WX_API_V3_KEY = '12345678901234567890123456789012';
process.env.CHECKIN_SIGNING_SECRET = 'checkin-test-secret-at-least-32-bytes-long';

const { decryptNotification } = require('../cloudfunctions/api/lib/wechat-pay');
const { encodeToken, decodeToken } = require('../cloudfunctions/api/lib/checkin');
const { noShowSettlement } = require('../cloudfunctions/api/lib/booking');
const { cumulativeRefundedFen, remainingRefundableFen, refundInProgress } = require('../cloudfunctions/api/lib/finance-state');

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

test('partial refunds keep only the unpaid remainder refundable', () => {
  const order = { paidFen: 10000, refundedFen: 3500, refundStatus: 'SUCCESS' };
  assert.strictEqual(cumulativeRefundedFen(order), 3500);
  assert.strictEqual(remainingRefundableFen(order), 6500);
  assert.strictEqual(refundInProgress(order), false);
  assert.strictEqual(refundInProgress({ ...order, refundStatus: 'PROCESSING' }), true);
});

console.log(`product feature tests passed: ${passed} QR, refund and notification crypto invariants`);
