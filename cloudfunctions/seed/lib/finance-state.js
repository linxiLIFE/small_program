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
  nextRefundIdentity,
  notificationRecordId
};
