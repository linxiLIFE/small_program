const crypto = require('crypto');
const { db, getOptional } = require('./db');
const { COLLECTIONS, PAYMENT_STATUS, REFUND_STATUS, ORDER_STATUS } = require('./constants');
const { AppError, assert } = require('./errors');
const { requireOpenId } = require('./auth');
const { preparePaymentRecord, markPaymentSuccess, markPaymentClosed, markRefundSuccess, markRefundAbnormal, markRefundProcessing, publicOrder } = require('./booking');
const wechat = require('./wechat-pay');
const { addMinutes } = require('./time');
const { refundStatusFromProvider, refundFailureDisposition, nextRefundIdentity, notificationRecordId, canCommitPaymentAttempt } = require('./finance-state');

async function scheduleRefundRetry(orderId, refundId) {
  const jobId = `job_refund_retry_${refundId}`;
  return db.runTransaction(async (transaction) => {
    const existing = await getOptional(COLLECTIONS.jobs, jobId, transaction);
    const now = Date.now();
    if (existing && ['RUNNING', 'PENDING'].includes(existing.status) && existing.businessId === refundId) {
      if (!existing.orderId) await transaction.collection(COLLECTIONS.jobs).doc(jobId).set({ data: { ...existing, orderId, updatedAt: now } });
      return false;
    }
    await transaction.collection(COLLECTIONS.jobs).doc(jobId).set({ data: {
      ...(existing || {}), _id: jobId, id: jobId, type: 'REFUND_RETRY', businessId: refundId, orderId,
      status: 'PENDING', nextRunAt: addMinutes(now, 2), retryCount: Number(existing && existing.retryCount || 0),
      leaseUntil: 0, claimToken: '', createdAt: existing && existing.createdAt || now, updatedAt: now
    } });
    return true;
  });
}

function parseProviderTime(value, fallback = Date.now()) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function providerRefundStatus(provider) {
  return String(provider && provider.status || 'PROCESSING').toUpperCase();
}

async function reconcileRefund(order, existing) {
  if (!existing || existing.status === REFUND_STATUS.SUCCESS) return existing;
  if ([REFUND_STATUS.MANUAL_ACTION, REFUND_STATUS.ABNORMAL].includes(existing.status)) return existing;
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
    const localStatus = refundStatusFromProvider(status);
    await markRefundAbnormal(existing.id || existing._id, {
      status: localStatus,
      refundId: providerRefundId,
      providerStatus: status,
      message: provider.refund_remark || provider.reason || ''
    });
    return { ...existing, status: localStatus, providerRefundId, providerStatus: status };
  }
  const processing = await markRefundProcessing(order.id, existing.id || existing._id, { refundId: providerRefundId, providerStatus: status });
  if (processing.status !== REFUND_STATUS.SUCCESS) await scheduleRefundRetry(order.id, existing.id || existing._id);
  return processing;
}

function isProviderMissing(error) {
  return error && error.code === 'PAYMENT_PROVIDER_ERROR'
    && error.details
    && ['ORDER_NOT_EXIST', 'RESOURCE_NOT_EXISTS'].includes(error.details.providerCode);
}

async function recordPaymentState(orderId, status, providerState) {
  return db.runTransaction(async (transaction) => {
    const order = await getOptional(COLLECTIONS.orders, orderId, transaction);
    assert(order, 'ORDER_NOT_FOUND', '订单不存在', 404);
    const payment = await getOptional(COLLECTIONS.payments, `pay_${orderId}`, transaction);
    assert(payment, 'PAYMENT_NOT_FOUND', '支付记录不存在', 404);
    if (payment.status === PAYMENT_STATUS.SUCCESS) return payment;
    if (status === PAYMENT_STATUS.PREPAY_SUBMITTING && order.status !== ORDER_STATUS.PENDING_PAYMENT) return payment;
    const now = Date.now();
    const nextPayment = { ...payment, status, providerState, updatedAt: now };
    await transaction.collection(COLLECTIONS.payments).doc(payment.id || payment._id).set({ data: nextPayment });
    await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: { ...order, paymentStatus: status, paymentProviderState: providerState, updatedAt: now } });
    return nextPayment;
  });
}

async function reconcilePaymentBeforeCancellation(order, payment) {
  if (!payment || Number(order.paidFen || 0) === 0 || payment.status === PAYMENT_STATUS.SUCCESS) return payment;
  if (!wechat.isConfigured()) {
    assert(payment.status === PAYMENT_STATUS.NOT_STARTED, 'PAYMENT_CHECK_REQUIRED', '已创建支付单但微信支付配置不可用，请稍后再取消');
    return payment;
  }
  let provider;
  try {
    provider = await wechat.queryOrder(payment.merchantOrderNo);
  } catch (error) {
    if (isProviderMissing(error)) {
      const settleUntil = Number(order.paymentDeadline || 0) + 2 * 60 * 1000;
      if (payment.status === PAYMENT_STATUS.CLOSE_PENDING && Date.now() < settleUntil) {
        throw new AppError('PAYMENT_CLOSE_PENDING', '支付单正在关闭，将由后台继续确认', 409);
      }
      await recordPaymentState(order.id, PAYMENT_STATUS.CLOSED, 'ORDER_NOT_EXIST');
      return { ...payment, status: PAYMENT_STATUS.CLOSED, providerState: 'ORDER_NOT_EXIST' };
    }
    throw error;
  }
  if (provider.trade_state === 'SUCCESS') {
    await markPaymentSuccess(order.id, {
      amountFen: provider.amount && provider.amount.total,
      currency: provider.amount && provider.amount.currency,
      payerOpenid: provider.payer && provider.payer.openid,
      transactionId: provider.transaction_id,
      paidAt: parseProviderTime(provider.success_time)
    });
    return { ...payment, status: PAYMENT_STATUS.SUCCESS };
  }
  if (provider.trade_state === 'CLOSED' || provider.trade_state === 'REVOKED') {
    await recordPaymentState(order.id, PAYMENT_STATUS.CLOSED, provider.trade_state);
    return { ...payment, status: PAYMENT_STATUS.CLOSED, providerState: provider.trade_state };
  }
  if (provider.trade_state === 'NOTPAY') {
    try {
      await wechat.closeOrder(payment.merchantOrderNo);
      await recordPaymentState(order.id, PAYMENT_STATUS.CLOSED, 'CLOSED_BEFORE_CANCEL');
      return { ...payment, status: PAYMENT_STATUS.CLOSED, providerState: 'CLOSED_BEFORE_CANCEL' };
    } catch (closeError) {
      // A payment can win between query and close. Query again before deciding.
      const latest = await wechat.queryOrder(payment.merchantOrderNo);
      if (latest.trade_state === 'SUCCESS') {
        await markPaymentSuccess(order.id, {
          amountFen: latest.amount && latest.amount.total,
          currency: latest.amount && latest.amount.currency,
          payerOpenid: latest.payer && latest.payer.openid,
          transactionId: latest.transaction_id,
          paidAt: parseProviderTime(latest.success_time)
        });
        return { ...payment, status: PAYMENT_STATUS.SUCCESS };
      }
      if (latest.trade_state === 'CLOSED' || latest.trade_state === 'REVOKED') {
        await recordPaymentState(order.id, PAYMENT_STATUS.CLOSED, latest.trade_state);
        return { ...payment, status: PAYMENT_STATUS.CLOSED, providerState: latest.trade_state };
      }
      throw closeError;
    }
  }
  await recordPaymentState(order.id, PAYMENT_STATUS.UNKNOWN, provider.trade_state || 'UNKNOWN');
  throw new AppError('PAYMENT_CHECK_REQUIRED', '支付正在处理中，暂时不能取消，请稍后重试', 409, { providerState: provider.trade_state || 'UNKNOWN' });
}

async function preparePayment(orderId) {
  const { openid, appid } = requireOpenId();
  const { order, payment } = await preparePaymentRecord(orderId);
  if (!wechat.isConfigured()) {
    return { configured: false, missing: wechat.getConfigIssues(), message: '微信支付资质尚未配置或配置无效，订单已保留。检查商户配置后可重新发起支付。' };
  }
  const paymentAttemptId = crypto.randomBytes(16).toString('hex');
  const claim = await db.runTransaction(async (transaction) => {
    const latestOrder = await getOptional(COLLECTIONS.orders, order.id, transaction);
    const latestPayment = await getOptional(COLLECTIONS.payments, payment.id || payment._id, transaction);
    assert(latestOrder && latestOrder.status === ORDER_STATUS.PENDING_PAYMENT, 'ORDER_NOT_PAYABLE', '当前订单不需要支付', 409);
    assert(Number(latestOrder.paymentDeadline || 0) > Date.now(), 'PAYMENT_DEADLINE_EXPIRED', '支付时间已结束', 409);
    assert(latestPayment && ![PAYMENT_STATUS.SUCCESS, PAYMENT_STATUS.CLOSED, PAYMENT_STATUS.CLOSE_PENDING].includes(latestPayment.status), 'ORDER_NOT_PAYABLE', '当前订单不能继续支付', 409);
    const now = Date.now();
    if (latestPayment.status === PAYMENT_STATUS.PREPAY_CREATED && latestPayment.prepayId) {
      return { reused: true, payment: latestPayment, order: latestOrder };
    }
    if (latestPayment.status === PAYMENT_STATUS.PREPAY_SUBMITTING && Number(latestPayment.prepareLeaseUntil || 0) > now) {
      throw new AppError('PAYMENT_PREPARING', '支付参数正在生成，请稍后重试', 409);
    }
    const nextPayment = { ...latestPayment, status: PAYMENT_STATUS.PREPAY_SUBMITTING, providerState: 'PREPAY_SUBMITTING', paymentAttemptId, prepareGeneration: Number(latestPayment.prepareGeneration || 0) + 1, prepareLeaseUntil: addMinutes(now, 2), updatedAt: now };
    await transaction.collection(COLLECTIONS.payments).doc(payment.id || payment._id).set({ data: nextPayment });
    await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: { ...latestOrder, paymentStatus: PAYMENT_STATUS.PREPAY_SUBMITTING, updatedAt: now } });
    return { reused: false, payment: nextPayment, order: latestOrder };
  });
  if (claim.reused) return { configured: true, ...wechat.buildJsapiPayParams(claim.payment.prepayId), orderId: order.id, reused: true };
  let payParams;
  try {
    payParams = await wechat.createJsapiPrepay({
    description: claim.order.serviceSnapshot.name,
    outTradeNo: claim.payment.merchantOrderNo,
    amountFen: claim.order.paidFen,
    openid,
    timeExpire: claim.order.paymentDeadline
  });
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const latestOrder = await getOptional(COLLECTIONS.orders, order.id, transaction);
      const latestPayment = await getOptional(COLLECTIONS.payments, payment.id || payment._id, transaction);
      if (!canCommitPaymentAttempt(latestOrder, latestPayment, paymentAttemptId)) return;
      const now = Date.now();
      await transaction.collection(COLLECTIONS.payments).doc(payment.id || payment._id).set({ data: { ...latestPayment, status: PAYMENT_STATUS.UNKNOWN, providerState: error.code || 'PREPAY_ERROR', prepareLeaseUntil: 0, updatedAt: now } });
      await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: { ...latestOrder, paymentStatus: PAYMENT_STATUS.UNKNOWN, updatedAt: now } });
    });
    throw error;
  }
  const accepted = await db.runTransaction(async (transaction) => {
    const latestOrder = await getOptional(COLLECTIONS.orders, order.id, transaction);
    const latestPayment = await getOptional(COLLECTIONS.payments, payment.id || payment._id, transaction);
    if (!canCommitPaymentAttempt(latestOrder, latestPayment, paymentAttemptId)) return false;
    const now = Date.now();
    await transaction.collection(COLLECTIONS.payments).doc(payment.id || payment._id).set({ data: { ...latestPayment, appid, mchid: wechat.config().mchid, status: PAYMENT_STATUS.PREPAY_CREATED, providerState: 'PREPAY_CREATED', prepayId: payParams.prepayId, prepareLeaseUntil: 0, prepayCreatedAt: now, updatedAt: now } });
    await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: { ...latestOrder, paymentStatus: PAYMENT_STATUS.PREPAY_CREATED, updatedAt: now } });
    return true;
  });
  if (!accepted) {
    const latestOrder = await getOptional(COLLECTIONS.orders, order.id);
    const latestPayment = await getOptional(COLLECTIONS.payments, payment.id || payment._id);
    if (latestOrder && latestPayment && (latestOrder.status !== ORDER_STATUS.PENDING_PAYMENT || latestPayment.status === PAYMENT_STATUS.CLOSE_PENDING)) {
      await reconcilePaymentBeforeCancellation(latestOrder, latestPayment);
    }
    throw new AppError('ORDER_NOT_PAYABLE', '订单状态已变化，不能继续支付', 409);
  }
  const { prepayId, ...clientParams } = payParams;
  return { configured: true, ...clientParams, orderId: order.id };
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
  const paymentDeadline = Number(order.paymentDeadline || 0);
  if (order.status === ORDER_STATUS.PENDING_PAYMENT
    && paymentDeadline > 0
    && Date.now() >= paymentDeadline
    && payment.status === PAYMENT_STATUS.NOT_STARTED) {
    const closed = await markPaymentClosed(orderId, 'NOTPAY_CLOSED');
    return { configured: wechat.isConfigured(), status: PAYMENT_STATUS.CLOSED, order: closed };
  }
  if (!wechat.isConfigured()) return { configured: false, status: payment.status, order: publicOrder(order), message: '微信支付资质尚未配置' };
  let result;
  try {
    result = await wechat.queryOrder(payment.merchantOrderNo);
  } catch (error) {
    if (isProviderMissing(error)) {
      if (order.status === ORDER_STATUS.PENDING_PAYMENT && paymentDeadline > 0 && Date.now() >= paymentDeadline) {
        const closed = await markPaymentClosed(orderId, 'ORDER_NOT_EXIST');
        return { configured: true, status: PAYMENT_STATUS.CLOSED, providerState: 'ORDER_NOT_EXIST', order: closed };
      }
      if (order.status !== ORDER_STATUS.PENDING_PAYMENT && payment.status === PAYMENT_STATUS.CLOSE_PENDING) {
        if (Date.now() < paymentDeadline + 2 * 60 * 1000) {
          return { configured: true, status: PAYMENT_STATUS.CLOSE_PENDING, providerState: 'ORDER_NOT_EXIST_PENDING_SETTLEMENT', order: publicOrder(order) };
        }
        await recordPaymentState(orderId, PAYMENT_STATUS.CLOSED, 'ORDER_NOT_EXIST');
        return { configured: true, status: PAYMENT_STATUS.CLOSED, providerState: 'ORDER_NOT_EXIST', order: publicOrder(await getOptional(COLLECTIONS.orders, orderId)) };
      }
      await recordPaymentState(orderId, PAYMENT_STATUS.NOT_STARTED, 'ORDER_NOT_EXIST');
      return { configured: true, status: PAYMENT_STATUS.NOT_STARTED, providerState: 'ORDER_NOT_EXIST', order: publicOrder(order) };
    }
    throw error;
  }
  if (result.trade_state === 'SUCCESS') {
    const marked = await markPaymentSuccess(orderId, { amountFen: result.amount && result.amount.total, currency: result.amount && result.amount.currency, payerOpenid: result.payer && result.payer.openid, transactionId: result.transaction_id, paidAt: parseProviderTime(result.success_time) });
    return { configured: true, status: PAYMENT_STATUS.SUCCESS, order: marked.order };
  }
  if (result.trade_state === 'NOTPAY'
    && order.status === ORDER_STATUS.PENDING_PAYMENT
    && paymentDeadline > 0
    && Date.now() >= paymentDeadline) {
    await wechat.closeOrder(payment.merchantOrderNo);
    const closed = await markPaymentClosed(orderId, 'NOTPAY_CLOSED');
    return { configured: true, status: PAYMENT_STATUS.CLOSED, order: closed };
  }
  if (result.trade_state === 'NOTPAY' && (order.status !== ORDER_STATUS.PENDING_PAYMENT || payment.status === PAYMENT_STATUS.CLOSE_PENDING)) {
    await wechat.closeOrder(payment.merchantOrderNo);
    await recordPaymentState(orderId, PAYMENT_STATUS.CLOSED, 'NOTPAY_CLOSED');
    return { configured: true, status: PAYMENT_STATUS.CLOSED, order: publicOrder(await getOptional(COLLECTIONS.orders, orderId)) };
  }
  if (result.trade_state === 'CLOSED' || result.trade_state === 'REVOKED') {
    if (order.status === ORDER_STATUS.PENDING_PAYMENT) {
      const closed = await markPaymentClosed(orderId, result.trade_state);
      return { configured: true, status: PAYMENT_STATUS.CLOSED, order: closed };
    }
    await recordPaymentState(orderId, PAYMENT_STATUS.CLOSED, result.trade_state);
    return { configured: true, status: PAYMENT_STATUS.CLOSED, order: publicOrder(await getOptional(COLLECTIONS.orders, orderId)) };
  }
  await recordPaymentState(orderId, PAYMENT_STATUS.UNKNOWN, result.trade_state || 'UNKNOWN');
  return { configured: true, status: PAYMENT_STATUS.UNKNOWN, providerState: result.trade_state || 'UNKNOWN', order: publicOrder(await getOptional(COLLECTIONS.orders, orderId)) };
}

async function ensureDurableRefundIntent(orderId, reason, options = {}) {
  return db.runTransaction(async (transaction) => {
    const order = await getOptional(COLLECTIONS.orders, orderId, transaction);
    assert(order, 'ORDER_NOT_FOUND', '订单不存在', 404);
    const payment = await getOptional(COLLECTIONS.payments, `pay_${orderId}`, transaction);
    assert(payment && payment.status === PAYMENT_STATUS.SUCCESS && Number(payment.amountFen || 0) > 0, 'PAYMENT_NOT_SUCCESS', '支付尚未确认，不能发起退款');
    let refundId = order.refundId || `rf_${orderId}`;
    let existing = await getOptional(COLLECTIONS.refunds, refundId, transaction);
    if (existing && existing.status === REFUND_STATUS.SUCCESS) return { order, payment, refund: existing };
    if (existing && [REFUND_STATUS.MANUAL_ACTION, REFUND_STATUS.ABNORMAL].includes(existing.status)) return { order, payment, refund: existing };
    if (existing && [REFUND_STATUS.RETRY_REQUIRED, REFUND_STATUS.CLOSED].includes(existing.status)) {
      if (!options.allowClosedRetry) return { order, payment, refund: { ...existing, status: REFUND_STATUS.RETRY_REQUIRED } };
      const identity = nextRefundIdentity(orderId, existing);
      refundId = identity.id;
      existing = { _id: refundId, id: refundId, orderId, userId: order.userId, refundNo: identity.refundNo, attempt: identity.attempt, previousRefundId: order.refundId || '', amountFen: Math.max(0, Number(order.requestedRefundFen === undefined ? order.refundAmountFen === undefined ? payment.amountFen : order.refundAmountFen : order.requestedRefundFen)), status: REFUND_STATUS.INIT, reason, retryCount: 0, createdAt: Date.now(), updatedAt: Date.now() };
    }
    if (existing && options.manualRetry && [REFUND_STATUS.WAITING_FUNDS, REFUND_STATUS.CONFIG_OR_DATA_ERROR].includes(existing.status)) {
      existing = { ...existing, status: REFUND_STATUS.INIT, lastManualRetryAt: Date.now(), errorCode: '', errorMessage: '', updatedAt: Date.now() };
    }
    const now = Date.now();
    const refund = existing || { _id: refundId, id: refundId, orderId, userId: order.userId, refundNo: refundId, attempt: 1, amountFen: Math.max(0, Number(order.requestedRefundFen === undefined ? order.refundAmountFen === undefined ? payment.amountFen : order.refundAmountFen : order.requestedRefundFen)), status: REFUND_STATUS.INIT, reason, retryCount: 0, createdAt: now, updatedAt: now };
    await transaction.collection(COLLECTIONS.refunds).doc(refundId).set({ data: refund });
    await transaction.collection(COLLECTIONS.orders).doc(orderId).set({ data: { ...order, refundId, refundStatus: refund.status, updatedAt: now } });
    return { order: { ...order, refundId, refundStatus: refund.status }, payment, refund };
  });
}

async function claimRefundSubmission(orderId, refundId) {
  const submissionId = crypto.randomBytes(16).toString('hex');
  return db.runTransaction(async (transaction) => {
    const order = await getOptional(COLLECTIONS.orders, orderId, transaction);
    const refund = await getOptional(COLLECTIONS.refunds, refundId, transaction);
    assert(order, 'ORDER_NOT_FOUND', '订单不存在', 404);
    assert(refund, 'REFUND_NOT_FOUND', '退款记录不存在', 404);
    const now = Date.now();
    if (refund.status === REFUND_STATUS.SUCCESS || order.refundStatus === REFUND_STATUS.SUCCESS) return { acquired: false, refund };
    if ([REFUND_STATUS.PROCESSING, REFUND_STATUS.MANUAL_ACTION, REFUND_STATUS.ABNORMAL, REFUND_STATUS.RETRY_REQUIRED, REFUND_STATUS.WAITING_FUNDS, REFUND_STATUS.CONFIG_OR_DATA_ERROR].includes(refund.status)) {
      return { acquired: false, refund };
    }
    if (refund.status === REFUND_STATUS.SUBMITTING && refund.submissionId && Number(refund.submissionLeaseUntil || 0) > now) {
      return { acquired: false, refund };
    }
    const next = {
      ...refund,
      status: REFUND_STATUS.SUBMITTING,
      submissionId,
      submissionGeneration: Number(refund.submissionGeneration || 0) + 1,
      submissionLeaseUntil: addMinutes(now, 2),
      submitAttemptedAt: now,
      updatedAt: now
    };
    await transaction.collection(COLLECTIONS.refunds).doc(refundId).set({ data: next });
    await transaction.collection(COLLECTIONS.orders).doc(orderId).set({ data: { ...order, refundId, refundStatus: REFUND_STATUS.SUBMITTING, updatedAt: now } });
    return { acquired: true, submissionId, refund: next };
  });
}

async function requestRefund(orderId, reason = '预约取消退款', options = {}) {
  let context = await ensureDurableRefundIntent(orderId, reason, options);
  if (context.refund.status === REFUND_STATUS.SUCCESS) return context.refund;
  if ([REFUND_STATUS.MANUAL_ACTION, REFUND_STATUS.ABNORMAL, REFUND_STATUS.RETRY_REQUIRED, REFUND_STATUS.WAITING_FUNDS, REFUND_STATUS.CONFIG_OR_DATA_ERROR].includes(context.refund.status)) return context.refund;
  await scheduleRefundRetry(orderId, context.refund.id || context.refund._id);
  if (!wechat.isConfigured()) {
    const pending = await db.runTransaction(async (transaction) => {
      const order = await getOptional(COLLECTIONS.orders, orderId, transaction);
      const refund = await getOptional(COLLECTIONS.refunds, context.refund.id || context.refund._id, transaction);
      if (refund.status === REFUND_STATUS.SUCCESS) return refund;
      const next = { ...refund, status: REFUND_STATUS.PENDING_CONFIG, updatedAt: Date.now() };
      await transaction.collection(COLLECTIONS.refunds).doc(refund.id || refund._id).set({ data: next });
      await transaction.collection(COLLECTIONS.orders).doc(orderId).set({ data: { ...order, refundId: refund.id || refund._id, refundStatus: REFUND_STATUS.PENDING_CONFIG, updatedAt: Date.now() } });
      return next;
    });
    await scheduleRefundRetry(orderId, pending.id || pending._id);
    return pending;
  }
  if ([REFUND_STATUS.INIT, REFUND_STATUS.SUBMITTING, REFUND_STATUS.PROCESSING].includes(context.refund.status)) {
    const reconciled = await reconcileRefund(context.order, context.refund);
    if (reconciled) return reconciled;
  }
  const refundId = context.refund.id || context.refund._id;
  const claim = await claimRefundSubmission(orderId, refundId);
  if (!claim.acquired) return claim.refund;
  context = { ...context, refund: claim.refund };
  let result;
  try {
    result = await wechat.createRefund({ outTradeNo: context.payment.merchantOrderNo, outRefundNo: context.refund.refundNo, amountFen: context.refund.amountFen, totalFen: context.payment.amountFen, reason });
  } catch (error) {
    const disposition = refundFailureDisposition(error);
    if (disposition.retry) {
      await scheduleRefundRetry(orderId, refundId);
      throw error;
    }
    await markRefundAbnormal(refundId, {
      status: disposition.status,
      providerStatus: disposition.providerCode,
      message: error && error.details && error.details.providerMessage || error.message || '',
      submissionId: claim.submissionId
    });
    return getOptional(COLLECTIONS.refunds, refundId);
  }
  const providerStatus = String(result.status || 'PROCESSING').toUpperCase();
  const localStatus = refundStatusFromProvider(providerStatus);
  if (localStatus === REFUND_STATUS.SUCCESS) {
    await markRefundSuccess(refundId, { refundId: result.refund_id || '', successAt: parseProviderTime(result.success_time), submissionId: claim.submissionId });
  } else if ([REFUND_STATUS.RETRY_REQUIRED, REFUND_STATUS.MANUAL_ACTION].includes(localStatus)) {
    await markRefundAbnormal(refundId, { status: localStatus, refundId: result.refund_id || '', providerStatus, message: result.refund_remark || result.reason || '', submissionId: claim.submissionId });
  } else {
    await markRefundProcessing(orderId, refundId, { refundId: result.refund_id || '', providerStatus, submissionId: claim.submissionId });
    await scheduleRefundRetry(orderId, refundId);
  }
  return await getOptional(COLLECTIONS.refunds, refundId);
}

async function beginNotification(notification) {
  const id = notificationRecordId(notification.id);
  return db.runTransaction(async (transaction) => {
    const existing = await getOptional(COLLECTIONS.notifications, id, transaction);
    if (existing && existing.status === 'DONE') return { id, duplicate: true };
    const now = Date.now();
    if (existing && existing.status === 'PROCESSING' && Number(existing.leaseUntil || 0) > now) return { id, duplicate: true, inFlight: true };
    const claimToken = crypto.randomBytes(16).toString('hex');
    await transaction.collection(COLLECTIONS.notifications).doc(id).set({ data: { ...(existing || {}), _id: id, id, providerEventId: notification.id, eventType: notification.event_type, status: 'PROCESSING', claimToken, leaseUntil: now + 2 * 60 * 1000, attemptCount: Number(existing && existing.attemptCount || 0) + 1, createdAt: existing && existing.createdAt || now, updatedAt: now } });
    return { id, claimToken, duplicate: false };
  });
}

async function finishNotification(id, claimToken, status, result = {}, error = null) {
  return db.runTransaction(async (transaction) => {
    const record = await getOptional(COLLECTIONS.notifications, id, transaction);
    if (!record || record.status === 'DONE' || record.status !== 'PROCESSING' || record.claimToken !== claimToken) return false;
    await transaction.collection(COLLECTIONS.notifications).doc(id).set({ data: { ...record, status, result, lastError: error ? String(error.code || error.message || error) : '', leaseUntil: 0, updatedAt: Date.now() } });
    return true;
  });
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
  const timestampSeconds = Number(timestamp);
  const maxSkewSeconds = Math.max(60, Number(process.env.WX_NOTIFY_MAX_SKEW_SECONDS || 300));
  assert(Number.isFinite(timestampSeconds) && Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) <= maxSkewSeconds, 'PAYMENT_NOTIFY_EXPIRED', '支付回调时间戳已过期', 401);
  assert(wechat.verifyNotifySignature({ timestamp, nonce, signature, serialNo, body }), 'PAYMENT_NOTIFY_SIGNATURE_INVALID', '支付回调验签失败', 401);
  let notification;
  try { notification = JSON.parse(body); } catch (error) { throw new AppError('PAYMENT_NOTIFY_INVALID', '支付回调 JSON 无法解析'); }
  assert(notification && notification.id && notification.event_type && notification.resource, 'PAYMENT_NOTIFY_INVALID', '支付回调缺少事件标识或资源');
  const claim = await beginNotification(notification);
  if (claim.inFlight) throw new AppError('PAYMENT_NOTIFY_IN_FLIGHT', '同一支付通知仍在处理中，请稍后重试', 503);
  if (claim.duplicate) return { ok: true, duplicate: true };
  try {
    const resource = wechat.decryptNotification(notification.resource);
    const payConfig = wechat.config();
    if (resource.appid) assert(resource.appid === payConfig.appid, 'PAYMENT_APPID_MISMATCH', '支付回调 AppID 校验失败');
    if (resource.mchid) assert(resource.mchid === payConfig.mchid, 'PAYMENT_MCHID_MISMATCH', '支付回调商户号校验失败');
    let result;
    if (['REFUND.SUCCESS', 'REFUND.ABNORMAL', 'REFUND.CLOSED'].includes(notification.event_type)) {
      assert(resource.out_refund_no && resource.out_trade_no, 'REFUND_NOTIFY_INVALID', '退款回调缺少退款单号或原支付单号');
      const refunds = await db.collection(COLLECTIONS.refunds).where({ refundNo: resource.out_refund_no }).limit(1).get();
      const refund = refunds.data && refunds.data[0];
      assert(refund, 'REFUND_NOT_FOUND', '退款回调对应记录不存在', 404);
      const payment = await getOptional(COLLECTIONS.payments, `pay_${refund.orderId}`);
      assert(payment && payment.merchantOrderNo === resource.out_trade_no, 'REFUND_ORDER_MISMATCH', '退款回调原支付单号校验失败');
      assert(Number(resource.amount && resource.amount.refund) === Number(refund.amountFen), 'REFUND_AMOUNT_MISMATCH', '退款金额校验失败');
      assert(Number(resource.amount && resource.amount.total) === Number(payment.amountFen), 'REFUND_TOTAL_MISMATCH', '退款原订单金额校验失败');
      if (resource.amount && resource.amount.currency) assert(resource.amount.currency === 'CNY', 'REFUND_CURRENCY_MISMATCH', '退款币种校验失败');
      const marked = notification.event_type === 'REFUND.SUCCESS'
        ? await markRefundSuccess(refund.id || refund._id, { refundId: resource.refund_id, successAt: parseProviderTime(resource.success_time) })
        : await markRefundAbnormal(refund.id || refund._id, { status: notification.event_type.endsWith('CLOSED') ? 'CLOSED' : 'ABNORMAL', refundId: resource.refund_id, providerStatus: notification.event_type, message: resource.refund_remark || resource.reason || '' });
      result = { ok: true, refundId: refund.id || refund._id, duplicate: marked.duplicate };
    } else {
      assert(notification.event_type === 'TRANSACTION.SUCCESS', 'PAYMENT_NOTIFY_UNSUPPORTED', '暂不处理该支付通知事件');
      assert(resource.out_trade_no, 'PAYMENT_NOTIFY_INVALID', '支付回调缺少商户订单号');
      const payments = await db.collection(COLLECTIONS.payments).where({ merchantOrderNo: resource.out_trade_no }).limit(1).get();
      const payment = payments.data && payments.data[0];
      assert(payment, 'PAYMENT_NOT_FOUND', '支付回调对应订单不存在', 404);
      const marked = await markPaymentSuccess(payment.orderId, { amountFen: resource.amount && resource.amount.total, currency: resource.amount && resource.amount.currency, payerOpenid: resource.payer && resource.payer.openid, transactionId: resource.transaction_id, paidAt: parseProviderTime(resource.success_time) });
      result = { ok: true, orderId: payment.orderId, duplicate: marked.duplicate, refundQueued: marked.shouldRefund };
    }
    await finishNotification(claim.id, claim.claimToken, 'DONE', result);
    return result;
  } catch (error) {
    await finishNotification(claim.id, claim.claimToken, 'FAILED', {}, `${error.code || 'ERROR'}: ${error.message || error}\n${error.stack || ''}`);
    throw error;
  }
}

module.exports = { preparePayment, queryPayment, requestRefund, handleNotify, scheduleRefundRetry, reconcilePaymentBeforeCancellation };
