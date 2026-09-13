const { db, getOptional } = require('./db');
const { COLLECTIONS, PAYMENT_STATUS, REFUND_STATUS, ORDER_STATUS } = require('./constants');
const { assert } = require('./errors');
const { requireOpenId } = require('./auth');
const { preparePaymentRecord, markPaymentSuccess, markPaymentClosed, markRefundSuccess, markRefundAbnormal, publicOrder } = require('./booking');
const wechat = require('./wechat-pay');
const { addMinutes } = require('./time');

async function scheduleRefundRetry(orderId, refundId) {
  const jobId = `job_refund_retry_${orderId}`;
  const existing = await getOptional(COLLECTIONS.jobs, jobId);
  const now = Date.now();
  if (existing && existing.status === 'RUNNING') return;
  if (existing && existing.status === 'PENDING' && Number(existing.nextRunAt || 0) > now) return;
  await db.collection(COLLECTIONS.jobs).doc(jobId).set({ data: {
    ...(existing || {}),
    _id: jobId,
    id: jobId,
    type: 'REFUND_RETRY',
    businessId: refundId,
    status: 'PENDING',
    nextRunAt: addMinutes(now, 30),
    retryCount: Number(existing && existing.retryCount || 0),
    createdAt: existing && existing.createdAt || now,
    updatedAt: now
  } });
}

function parseProviderTime(value, fallback = Date.now()) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function providerRefundStatus(provider) {
  return String(provider && provider.status || 'PROCESSING').toUpperCase();
}

async function reconcileRefund(order, existing) {
  if (!existing || existing.status !== REFUND_STATUS.PROCESSING) return existing;
  let provider;
  try {
    provider = await wechat.queryRefund(existing.refundNo);
  } catch (error) {
    if (error.code === 'PAYMENT_PROVIDER_ERROR' && error.details && error.details.providerCode === 'RESOURCE_NOT_EXISTS') return null;
    throw error;
  }
  const status = providerRefundStatus(provider);
  const providerRefundId = provider.refund_id || existing.providerRefundId || '';
  if (status === 'SUCCESS') {
    await markRefundSuccess(existing.id || existing._id, {
      refundId: providerRefundId,
      successAt: parseProviderTime(provider.success_time)
    });
    return { ...existing, status: REFUND_STATUS.SUCCESS, providerRefundId };
  }
  if (status === 'ABNORMAL' || status === 'CLOSED') {
    const localStatus = status === 'CLOSED' ? REFUND_STATUS.CLOSED : REFUND_STATUS.ABNORMAL;
    await markRefundAbnormal(existing.id || existing._id, {
      status: localStatus,
      refundId: providerRefundId,
      providerStatus: status,
      message: provider.refund_remark || provider.reason || ''
    });
    return { ...existing, status: localStatus, providerRefundId, providerStatus: status };
  }
  const processing = {
    ...existing,
    status: REFUND_STATUS.PROCESSING,
    providerRefundId,
    providerStatus: status,
    updatedAt: Date.now()
  };
  await db.collection(COLLECTIONS.refunds).doc(existing.id || existing._id).set({ data: processing });
  await db.collection(COLLECTIONS.orders).doc(order.id).set({ data: { ...order, refundId: existing.id || existing._id, refundStatus: REFUND_STATUS.PROCESSING, updatedAt: Date.now() } });
  await scheduleRefundRetry(order.id, existing.id || existing._id);
  return processing;
}

async function preparePayment(orderId) {
  const { openid, appid } = requireOpenId();
  const { order, payment } = await preparePaymentRecord(orderId);
  if (!wechat.isConfigured()) {
    return { configured: false, missing: wechat.getMissingConfig(), message: '微信支付资质尚未配置，订单已保留。补齐商户配置后可重新发起支付。' };
  }
  const payParams = await wechat.createJsapiPrepay({
    description: order.serviceSnapshot.name,
    outTradeNo: payment.merchantOrderNo,
    amountFen: order.paidFen,
    openid
  });
  await db.collection(COLLECTIONS.payments).doc(payment.id || payment._id).set({ data: { ...payment, appid, mchid: wechat.config().mchid, status: PAYMENT_STATUS.PREPAY_CREATED, prepayCreatedAt: Date.now(), updatedAt: Date.now() } });
  return { configured: true, ...payParams, orderId: order.id };
}

async function queryPayment(orderId) {
  const { openid } = requireOpenId();
  const { order, payment } = await preparePaymentRecord(orderId).catch(async (error) => {
    if (error.code === 'ORDER_NOT_PAYABLE') {
      const found = await getOptional(COLLECTIONS.orders, orderId);
      if (found && found.userId === openid) return { order: found, payment: await getOptional(COLLECTIONS.payments, `pay_${orderId}`) };
    }
    throw error;
  });
  assert(payment, 'PAYMENT_NOT_FOUND', '支付记录不存在', 404);
  if (!wechat.isConfigured()) return { configured: false, status: payment.status, order: publicOrder(order), message: '微信支付资质尚未配置' };
  const result = await wechat.queryOrder(payment.merchantOrderNo);
  if (result.trade_state === 'SUCCESS') {
    const marked = await markPaymentSuccess(orderId, { amountFen: result.amount && result.amount.total, transactionId: result.transaction_id, paidAt: result.success_time ? Date.parse(result.success_time) : Date.now() });
    if (marked.shouldRefund) await requestRefund(orderId, '迟到支付自动退款');
    return { configured: true, status: PAYMENT_STATUS.SUCCESS, order: marked.order };
  }
  if (result.trade_state === 'CLOSED' || result.trade_state === 'REVOKED') {
    const closed = await markPaymentClosed(orderId);
    return { configured: true, status: PAYMENT_STATUS.CLOSED, order: closed };
  }
  return { configured: true, status: PAYMENT_STATUS.UNKNOWN, providerState: result.trade_state || 'UNKNOWN', order: publicOrder(order) };
}

async function requestRefund(orderId, reason = '预约取消退款') {
  const order = await getOptional(COLLECTIONS.orders, orderId);
  assert(order, 'ORDER_NOT_FOUND', '订单不存在', 404);
  const payment = await getOptional(COLLECTIONS.payments, `pay_${orderId}`);
  assert(payment && payment.status === PAYMENT_STATUS.SUCCESS, 'PAYMENT_NOT_SUCCESS', '支付尚未确认，不能发起退款');
  const refundId = order.refundId || `rf_${orderId}`;
  const existing = await getOptional(COLLECTIONS.refunds, refundId);
  if (existing && existing.status === REFUND_STATUS.SUCCESS) return existing;
  if (existing && [REFUND_STATUS.CLOSED, REFUND_STATUS.ABNORMAL].includes(existing.status)) return existing;
  if (!wechat.isConfigured()) {
    const pending = { ...(existing || {}), _id: refundId, id: refundId, orderId, userId: order.userId, refundNo: refundId, amountFen: order.paidFen, status: REFUND_STATUS.PENDING_CONFIG, reason, retryCount: Number(existing && existing.retryCount || 0), updatedAt: Date.now(), createdAt: existing && existing.createdAt || Date.now() };
    await db.collection(COLLECTIONS.refunds).doc(refundId).set({ data: pending });
    await db.collection(COLLECTIONS.orders).doc(orderId).set({ data: { ...order, refundId, refundStatus: REFUND_STATUS.PENDING_CONFIG, updatedAt: Date.now() } });
    await scheduleRefundRetry(orderId, refundId);
    return pending;
  }
  if (existing && existing.status === REFUND_STATUS.PROCESSING) {
    const reconciled = await reconcileRefund(order, existing);
    if (reconciled) return reconciled;
  }
  const result = await wechat.createRefund({ outTradeNo: payment.merchantOrderNo, outRefundNo: refundId, amountFen: order.paidFen, totalFen: order.paidFen, reason });
  const processing = { ...(existing || {}), _id: refundId, id: refundId, orderId, userId: order.userId, refundNo: refundId, amountFen: order.paidFen, status: REFUND_STATUS.PROCESSING, providerRefundId: result.refund_id || '', reason, retryCount: 0, updatedAt: Date.now(), createdAt: existing && existing.createdAt || Date.now() };
  await db.collection(COLLECTIONS.refunds).doc(refundId).set({ data: processing });
  await db.collection(COLLECTIONS.orders).doc(orderId).set({ data: { ...order, refundId, refundStatus: REFUND_STATUS.PROCESSING, updatedAt: Date.now() } });
  const providerStatus = String(result.status || '').toUpperCase();
  if (providerStatus === 'SUCCESS') {
    await markRefundSuccess(refundId, { refundId: result.refund_id || '', successAt: parseProviderTime(result.success_time) });
    return { ...processing, status: REFUND_STATUS.SUCCESS };
  }
  if (providerStatus === 'ABNORMAL' || providerStatus === 'CLOSED') {
    const status = providerStatus === 'CLOSED' ? REFUND_STATUS.CLOSED : REFUND_STATUS.ABNORMAL;
    await markRefundAbnormal(refundId, { status, refundId: result.refund_id || '', providerStatus, message: result.refund_remark || result.reason || '' });
    return { ...processing, status };
  }
  await scheduleRefundRetry(orderId, refundId);
  return processing;
}

async function handleNotify(event) {
  const headers = event.headers || event.header || {};
  const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');
  const header = (name) => Object.entries(headers).find(([key]) => String(key).toLowerCase() === name.toLowerCase())?.[1] || '';
  const timestamp = header('Wechatpay-Timestamp');
  const nonce = header('Wechatpay-Nonce');
  const signature = header('Wechatpay-Signature');
  const serialNo = header('Wechatpay-Serial');
  assert(timestamp && nonce && signature && serialNo && body, 'PAYMENT_NOTIFY_INVALID', '支付回调报文不完整');
  assert(wechat.verifyNotifySignature({ timestamp, nonce, signature, serialNo, body }), 'PAYMENT_NOTIFY_SIGNATURE_INVALID', '支付回调验签失败', 401);
  const notification = JSON.parse(body);
  const resource = wechat.decryptNotification(notification.resource);
  const payConfig = wechat.config();
  if (resource.appid) assert(resource.appid === payConfig.appid, 'PAYMENT_APPID_MISMATCH', '支付回调 AppID 校验失败');
  if (resource.mchid) assert(resource.mchid === payConfig.mchid, 'PAYMENT_MCHID_MISMATCH', '支付回调商户号校验失败');
  if (['REFUND.SUCCESS', 'REFUND.ABNORMAL', 'REFUND.CLOSED'].includes(notification.event_type)) {
    assert(resource && resource.out_refund_no, 'REFUND_NOTIFY_INVALID', '退款回调缺少退款单号');
    const refunds = await db.collection(COLLECTIONS.refunds).where({ refundNo: resource.out_refund_no }).limit(1).get();
    const refund = refunds.data && refunds.data[0];
    assert(refund, 'REFUND_NOT_FOUND', '退款回调对应记录不存在', 404);
    const result = notification.event_type === 'REFUND.SUCCESS'
      ? await markRefundSuccess(refund.id || refund._id, { refundId: resource.refund_id, successAt: parseProviderTime(resource.success_time) })
      : await markRefundAbnormal(refund.id || refund._id, {
        status: notification.event_type === 'REFUND.CLOSED' ? REFUND_STATUS.CLOSED : REFUND_STATUS.ABNORMAL,
        refundId: resource.refund_id,
        providerStatus: notification.event_type,
        message: resource.refund_remark || resource.reason || ''
      });
    return { ok: true, refundId: refund.id || refund._id, duplicate: result.duplicate };
  }
  assert(notification.event_type === 'TRANSACTION.SUCCESS', 'PAYMENT_NOTIFY_UNSUPPORTED', '暂不处理该支付通知事件');
  assert(resource && resource.out_trade_no, 'PAYMENT_NOTIFY_INVALID', '支付回调缺少商户订单号');
  const payments = await db.collection(COLLECTIONS.payments).where({ merchantOrderNo: resource.out_trade_no }).limit(1).get();
  const payment = payments.data && payments.data[0];
  assert(payment, 'PAYMENT_NOT_FOUND', '支付回调对应订单不存在', 404);
  const result = await markPaymentSuccess(payment.orderId, { amountFen: resource.amount && resource.amount.total, transactionId: resource.transaction_id, paidAt: parseProviderTime(resource.success_time) });
  if (result.shouldRefund) await requestRefund(payment.orderId, '迟到支付自动退款');
  return { ok: true, orderId: payment.orderId, duplicate: result.duplicate };
}

module.exports = { preparePayment, queryPayment, requestRefund, handleNotify, scheduleRefundRetry };
