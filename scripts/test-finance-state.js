const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ORDER_STATUS, PAYMENT_STATUS, REFUND_STATUS } = require('../cloudfunctions/api/lib/constants');
const {
  isCancelledOrderStatus,
  needsCashRefund,
  canAdvanceService,
  refundStatusFromProvider,
  refundFailureDisposition,
  bookingRequestHash,
  assertServiceTransitionTime,
  canDeleteCustomerOrder,
  canCommitPaymentAttempt,
  nextRefundIdentity,
  notificationRecordId
} = require('../cloudfunctions/api/lib/finance-state');
const { compileWhere, isRetryableTransactionError } = require('../cloudfunctions/api/lib/db');

let passed = 0;
function test(name, callback) {
  callback();
  passed += 1;
}

test('user-cancelled paid order needs refund', () => assert(needsCashRefund({ status: ORDER_STATUS.CANCELLED_BY_USER, paidFen: 100 }, null)));
test('duplicate paid callback still needs missing refund', () => assert(needsCashRefund({ status: ORDER_STATUS.CANCELLED, paidFen: 100 }, { status: REFUND_STATUS.PROCESSING })));
test('successful refund is terminal', () => assert(!needsCashRefund({ status: ORDER_STATUS.CANCELLED, paidFen: 100 }, { status: REFUND_STATUS.SUCCESS })));
test('active order does not need automatic refund', () => assert(!needsCashRefund({ status: ORDER_STATUS.RESERVED, paidFen: 100 }, null)));
test('zero-cash order never calls cash refund', () => assert(!needsCashRefund({ status: ORDER_STATUS.CANCELLED, paidFen: 0 }, null)));
test('refund-pending order is a cancelled business state', () => assert(isCancelledOrderStatus(ORDER_STATUS.CANCEL_PENDING_REFUND)));
test('refunded order is a cancelled business state', () => assert(isCancelledOrderStatus(ORDER_STATUS.REFUNDED)));
test('normal paid reservation can advance', () => assert(canAdvanceService({ paymentStatus: PAYMENT_STATUS.SUCCESS, refundStatus: REFUND_STATUS.NOT_REQUIRED })));
test('processing refund blocks service', () => assert(!canAdvanceService({ paymentStatus: PAYMENT_STATUS.SUCCESS, refundStatus: REFUND_STATUS.PROCESSING })));
test('unconfirmed payment blocks service', () => assert(!canAdvanceService({ paymentStatus: PAYMENT_STATUS.UNKNOWN, refundStatus: REFUND_STATUS.NOT_REQUIRED })));
test('provider success maps to success', () => assert.strictEqual(refundStatusFromProvider('SUCCESS'), REFUND_STATUS.SUCCESS));
test('provider closed requires a new refund number', () => assert.strictEqual(refundStatusFromProvider('CLOSED'), REFUND_STATUS.RETRY_REQUIRED));
test('provider abnormal requires manual action', () => assert.strictEqual(refundStatusFromProvider('ABNORMAL'), REFUND_STATUS.MANUAL_ACTION));
test('provider processing stays processing', () => assert.strictEqual(refundStatusFromProvider('PROCESSING'), REFUND_STATUS.PROCESSING));
test('insufficient merchant funds waits for manual retry', () => assert.deepStrictEqual(refundFailureDisposition({ details: { providerCode: 'NOT_ENOUGH' } }), { status: REFUND_STATUS.WAITING_FUNDS, retry: false, providerCode: 'NOT_ENOUGH' }));
test('invalid refund request never auto retries', () => assert.strictEqual(refundFailureDisposition({ details: { providerCode: 'INVALID_REQUEST' } }).status, REFUND_STATUS.CONFIG_OR_DATA_ERROR));
test('provider timeout retries the same refund', () => assert.strictEqual(refundFailureDisposition({ details: { providerCode: 'SYSTEM_ERROR' } }).retry, true));
test('unknown network timeout is retryable', () => assert.strictEqual(refundFailureDisposition({ code: 'ETIMEDOUT' }).retry, true));
test('booking request hash is stable', () => assert.strictEqual(bookingRequestHash({ serviceId: 's', workId: 'w', technicianId: 't', date: '2026-09-14', startAt: 1, pointsToUse: 2, quoteId: 'q' }), bookingRequestHash({ serviceId: 's', workId: 'w', technicianId: 't', date: '2026-09-14', startAt: 1, pointsToUse: 2, quoteId: 'q' })));
test('booking request hash changes with the slot', () => assert.notStrictEqual(bookingRequestHash({ startAt: 1 }), bookingRequestHash({ startAt: 2 })));
test('future check-in is blocked', () => assert.strictEqual(assertServiceTransitionTime({ startAt: 10_000_000, endAt: 11_000_000, bookingRuleSnapshot: { noShowGraceMinutes: 30 } }, 'checkIn', 1).allowed, false));
test('check-in inside the window is allowed', () => assert.strictEqual(assertServiceTransitionTime({ startAt: 10_000_000, endAt: 11_000_000, bookingRuleSnapshot: { noShowGraceMinutes: 30 } }, 'checkIn', 9_000_000).allowed, true));
test('service cannot complete before its booked end', () => assert.strictEqual(assertServiceTransitionTime({ startAt: 10_000_000, endAt: 11_000_000 }, 'complete', 10_500_000).allowed, false));
test('service can complete at its booked end', () => assert.strictEqual(assertServiceTransitionTime({ startAt: 10_000_000, endAt: 11_000_000 }, 'complete', 11_000_000).allowed, true));
test('refund-in-progress cancelled order cannot be hidden', () => assert.strictEqual(canDeleteCustomerOrder({ status: ORDER_STATUS.CANCELLED_BY_USER, refundStatus: REFUND_STATUS.PROCESSING }), false));
test('refunded order can be hidden', () => assert.strictEqual(canDeleteCustomerOrder({ status: ORDER_STATUS.REFUNDED, refundStatus: REFUND_STATUS.SUCCESS }), true));
test('only the current payment attempt can commit prepay', () => assert.strictEqual(canCommitPaymentAttempt({ status: ORDER_STATUS.PENDING_PAYMENT }, { status: PAYMENT_STATUS.PREPAY_SUBMITTING, paymentAttemptId: 'current' }, 'current'), true));
test('a cancelled or superseded payment attempt cannot commit prepay', () => {
  assert.strictEqual(canCommitPaymentAttempt({ status: ORDER_STATUS.CANCELLED_BY_USER }, { status: PAYMENT_STATUS.PREPAY_SUBMITTING, paymentAttemptId: 'current' }, 'current'), false);
  assert.strictEqual(canCommitPaymentAttempt({ status: ORDER_STATUS.PENDING_PAYMENT }, { status: PAYMENT_STATUS.PREPAY_SUBMITTING, paymentAttemptId: 'new' }, 'old'), false);
});
test('closed retry increments refund identity', () => assert.deepStrictEqual(nextRefundIdentity('order1', { attempt: 1 }), { id: 'rf_order1_2', refundNo: 'rf_order1_2', attempt: 2 }));
test('notification IDs are stable and bounded', () => assert.strictEqual(notificationRecordId('event-1'), notificationRecordId('event-1')));
test('notification IDs differ by event', () => assert.notStrictEqual(notificationRecordId('event-1'), notificationRecordId('event-2')));
test('deadlock is retryable', () => assert(isRetryableTransactionError({ code: 'ER_LOCK_DEADLOCK' })));
test('lock timeout is retryable', () => assert(isRetryableTransactionError({ errno: 1205 })));
test('ordinary SQL errors are not retried', () => assert(!isRetryableTransactionError({ code: 'ER_PARSE_ERROR' })));
test('indexed payment lookup compiles to a unique column', () => assert(compileWhere({ merchantOrderNo: 'SG1' }, 'payments').sql.includes('`merchant_order_no`')));
test('due-job comparison compiles to indexed columns', () => assert(compileWhere({ status: 'PENDING', nextRunAt: { __sqlOperator: 'lte', value: 10 } }, 'jobs').sql.includes('`next_run_at` <= ?')));
test('settings version sorts by numeric generated column', () => assert(compileWhere({ version: 10 }, 'settings_versions').sql.includes('`version_num`')));

const root = path.resolve(__dirname, '..');
const wechat = fs.readFileSync(path.join(root, 'cloudfunctions/api/lib/wechat-pay.js'), 'utf8');
const paymentService = fs.readFileSync(path.join(root, 'cloudfunctions/api/lib/payment-service.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'docs/mysql-schema.sql'), 'utf8');
test('JSAPI request carries provider expiry', () => assert(wechat.includes('time_expire: new Date(Number(timeExpire)).toISOString()')));
test('payment callback queues late refund instead of calling provider synchronously', () => {
  const callbackTail = paymentService.slice(paymentService.indexOf('async function handleNotify'));
  assert(!callbackTail.includes("await requestRefund(payment.orderId, '迟到支付自动退款')"));
});
test('merchant order number is database-unique', () => assert(schema.includes('UNIQUE KEY `uq_payments_merchant_order_no`')));
test('refund number is database-unique', () => assert(schema.includes('UNIQUE KEY `uq_refunds_refund_no`')));

console.log(`finance state tests passed: ${passed} payment/refund/concurrency invariants`);
