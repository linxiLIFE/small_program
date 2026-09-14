const crypto = require('crypto');
const { ORDER_STATUS, PAYMENT_STATUS, REFUND_STATUS } = require('./constants');

const CANCELLED_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.CANCELLED_BY_USER,
  ORDER_STATUS.CANCELLED_NO_SHOW,
  ORDER_STATUS.CANCEL_PENDING_REFUND,
  ORDER_STATUS.REFUNDED
]);

const REFUND_TERMINAL_STATUSES = Object.freeze([
  REFUND_STATUS.SUCCESS,
  REFUND_STATUS.MANUAL_ACTION
]);

function isCancelledOrderStatus(status) {
  return CANCELLED_ORDER_STATUSES.includes(status);
}

function needsCashRefund(order, refund) {
  return Number(order && order.paidFen || 0) > 0
    && isCancelledOrderStatus(order && order.status)
    && (!refund || refund.status !== REFUND_STATUS.SUCCESS);
}

function canAdvanceService(order) {
  return !!order
    && order.paymentStatus === PAYMENT_STATUS.SUCCESS
    && [REFUND_STATUS.NOT_REQUIRED, '', undefined, null].includes(order.refundStatus);
}

function refundStatusFromProvider(status) {
  switch (String(status || '').toUpperCase()) {
    case 'SUCCESS': return REFUND_STATUS.SUCCESS;
    case 'RETRY_REQUIRED':
    case 'CLOSED': return REFUND_STATUS.RETRY_REQUIRED;
    case 'MANUAL_ACTION':
    case 'ABNORMAL': return REFUND_STATUS.MANUAL_ACTION;
    default: return REFUND_STATUS.PROCESSING;
  }
}

const RETRYABLE_REFUND_PROVIDER_CODES = new Set(['SYSTEM_ERROR', 'FREQUENCY_LIMITED']);
const CONFIG_REFUND_PROVIDER_CODES = new Set([
  'PARAM_ERROR',
  'INVALID_REQUEST',
  'SIGN_ERROR',
  'MCH_NOT_EXISTS',
  'RESOURCE_NOT_EXISTS',
  'NO_AUTH'
]);

function refundFailureDisposition(error) {
  const providerCode = String(error && error.details && error.details.providerCode || '').toUpperCase();
  if (providerCode === 'NOT_ENOUGH') return { status: REFUND_STATUS.WAITING_FUNDS, retry: false, providerCode };
  if (providerCode === 'USER_ACCOUNT_ABNORMAL') return { status: REFUND_STATUS.MANUAL_ACTION, retry: false, providerCode };
  if (CONFIG_REFUND_PROVIDER_CODES.has(providerCode)) return { status: REFUND_STATUS.CONFIG_OR_DATA_ERROR, retry: false, providerCode };
  if (RETRYABLE_REFUND_PROVIDER_CODES.has(providerCode)) return { status: REFUND_STATUS.SUBMITTING, retry: true, providerCode };
  if (!providerCode || ['PAYMENT_TIMEOUT', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(String(error && error.code || '').toUpperCase())) {
    return { status: REFUND_STATUS.SUBMITTING, retry: true, providerCode };
  }
  return { status: REFUND_STATUS.CONFIG_OR_DATA_ERROR, retry: false, providerCode };
}

function bookingRequestHash(payload = {}) {
  const normalized = {
    serviceId: String(payload.serviceId || ''),
    workId: String(payload.workId || ''),
    technicianId: String(payload.technicianId || ''),
    date: String(payload.date || ''),
    startAt: Number(payload.startAt || 0),
    pointsToUse: Number(payload.pointsToUse || 0),
    quoteId: String(payload.quoteId || '')
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function assertServiceTransitionTime(order, action, now = Date.now()) {
  const startAt = Number(order && order.startAt || 0);
  const endAt = Number(order && order.endAt || 0);
  const grace = Number(order && order.bookingRuleSnapshot && order.bookingRuleSnapshot.noShowGraceMinutes || 30);
  if (!Number.isFinite(startAt) || startAt <= 0) return { allowed: false, code: 'ORDER_TIME_INVALID' };
  if (action === 'checkIn') {
    const earliest = startAt - 60 * 60 * 1000;
    const latest = order.status === ORDER_STATUS.NO_SHOW_REVIEW && endAt > startAt
      ? endAt + grace * 60 * 1000
      : startAt + grace * 60 * 1000;
    return { allowed: now >= earliest && now <= latest, code: now < earliest ? 'CHECK_IN_TOO_EARLY' : 'CHECK_IN_TOO_LATE' };
  }
  if (action === 'start') {
    return { allowed: now >= startAt - 15 * 60 * 1000, code: 'SERVICE_TOO_EARLY' };
  }
  if (action === 'complete') {
    if (!Number.isFinite(endAt) || endAt <= startAt) return { allowed: false, code: 'ORDER_TIME_INVALID' };
    return { allowed: now >= endAt, code: 'SERVICE_COMPLETE_TOO_EARLY' };
  }
  return { allowed: false, code: 'INVALID_TRANSITION' };
}

function canDeleteCustomerOrder(order) {
  return !!order
    && [ORDER_STATUS.CANCELLED, ORDER_STATUS.CANCELLED_BY_USER, ORDER_STATUS.CANCELLED_NO_SHOW, ORDER_STATUS.REFUNDED].includes(order.status)
    && [REFUND_STATUS.NOT_REQUIRED, REFUND_STATUS.SUCCESS, '', undefined, null].includes(order.refundStatus);
}

function canCommitPaymentAttempt(order, payment, paymentAttemptId) {
  return !!order
    && !!payment
    && order.status === ORDER_STATUS.PENDING_PAYMENT
    && payment.status === PAYMENT_STATUS.PREPAY_SUBMITTING
    && payment.paymentAttemptId === paymentAttemptId;
}

function nextRefundIdentity(orderId, current) {
  const attempt = Math.max(1, Number(current && current.attempt || 1) + 1);
  const suffix = attempt === 1 ? '' : `_${attempt}`;
  const id = `rf_${orderId}${suffix}`;
  return { id, refundNo: id, attempt };
}

function notificationRecordId(notificationId) {
  return `wxnotify_${crypto.createHash('sha256').update(String(notificationId || '')).digest('hex')}`;
}

module.exports = {
  CANCELLED_ORDER_STATUSES,
  REFUND_TERMINAL_STATUSES,
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
};
