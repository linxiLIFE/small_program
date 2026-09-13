const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const fs = require('fs');
const path = require('path');
const sharedRoot = fs.existsSync(path.join(__dirname, 'lib')) ? './lib' : '../api/lib';
const { db, getOptional } = require(`${sharedRoot}/db`);
const { COLLECTIONS, PAYMENT_STATUS, REFUND_STATUS, ORDER_STATUS } = require(`${sharedRoot}/constants`);
const { markPaymentSuccess, markPaymentClosed, markNoShow } = require(`${sharedRoot}/booking`);
const { requestRefund, scheduleRefundRetry, reconcilePaymentBeforeCancellation } = require(`${sharedRoot}/payment-service`);
const wechat = require(`${sharedRoot}/wechat-pay`);
const { addMinutes } = require(`${sharedRoot}/time`);

async function claimJob(job) {
  const now = Date.now();
  const leaseUntil = addMinutes(now, 2);
  const jobId = job._id || job.id;
  const condition = job.status === 'RUNNING'
    ? { _id: jobId, status: 'RUNNING', leaseUntil: db.command.lte(now) }
    : { _id: jobId, status: 'PENDING', nextRunAt: db.command.lte(now) };
  const result = await db.collection(COLLECTIONS.jobs).where(condition).update({ data: { status: 'RUNNING', leaseUntil, updatedAt: now } });
  return result && result.stats && result.stats.updated === 1;
}

async function finishJob(job, status = 'DONE', errorMessage = '') {
  const nextRetry = Number(job.retryCount || 0) + 1;
  const failed = status === 'FAILED';
  const nextRunAt = addMinutes(Date.now(), Math.min(60, 2 ** Math.min(nextRetry, 5)));
  await db.collection(COLLECTIONS.jobs).doc(job._id || job.id).update({ data: { status: failed && nextRetry < 8 ? 'PENDING' : status, retryCount: nextRetry, lastError: errorMessage, nextRunAt, leaseUntil: 0, updatedAt: Date.now() } });
}

async function processPaymentExpire(job) {
  const order = await getOptional(COLLECTIONS.orders, job.businessId);
  if (!order || order.status !== ORDER_STATUS.PENDING_PAYMENT) return;
  const payment = await getOptional(COLLECTIONS.payments, `pay_${order.id}`);
  if (!payment || payment.status === PAYMENT_STATUS.SUCCESS) return;
  if (!wechat.isConfigured()) {
    if (payment.status === PAYMENT_STATUS.NOT_STARTED) {
      await markPaymentClosed(order.id);
      return;
    }
    throw new Error('微信支付尚未配置，暂不关闭已创建预支付单');
  }
  let provider;
  try {
    provider = await wechat.queryOrder(payment.merchantOrderNo);
  } catch (error) {
    if (error.code === 'PAYMENT_PROVIDER_ERROR' && error.details && error.details.providerCode === 'ORDER_NOT_EXIST') {
      await markPaymentClosed(order.id, 'ORDER_NOT_EXIST');
      return;
    }
    throw error;
  }
  if (provider.trade_state === 'SUCCESS') {
    await markPaymentSuccess(order.id, { amountFen: provider.amount && provider.amount.total, currency: provider.amount && provider.amount.currency, payerOpenid: provider.payer && provider.payer.openid, transactionId: provider.transaction_id, paidAt: provider.success_time ? Date.parse(provider.success_time) : Date.now() });
    return;
  }
  if (provider.trade_state === 'NOTPAY' || provider.trade_state === 'CLOSED' || provider.trade_state === 'REVOKED') {
    if (provider.trade_state === 'NOTPAY') await wechat.closeOrder(payment.merchantOrderNo);
    await markPaymentClosed(order.id, provider.trade_state === 'NOTPAY' ? 'NOTPAY_CLOSED' : provider.trade_state);
    return;
  }
  throw new Error(`支付状态待确认: ${provider.trade_state || 'UNKNOWN'}`);
}

async function processNoShow(job) {
  await markNoShow(job.businessId);
}

async function processPaymentReconcile(job) {
  const order = await getOptional(COLLECTIONS.orders, job.businessId);
  const payment = await getOptional(COLLECTIONS.payments, `pay_${job.businessId}`);
  if (!order || !payment || [PAYMENT_STATUS.SUCCESS, PAYMENT_STATUS.CLOSED].includes(payment.status)) return;
  const result = await reconcilePaymentBeforeCancellation(order, payment);
  if (result && [PAYMENT_STATUS.CLOSE_PENDING, PAYMENT_STATUS.UNKNOWN, PAYMENT_STATUS.PREPAY_SUBMITTING].includes(result.status)) return { deferred: true };
}

async function processRefund(job) {
  const refund = await getOptional(COLLECTIONS.refunds, job.businessId);
  if (!refund || refund.status === REFUND_STATUS.SUCCESS) return;
  const result = await requestRefund(refund.orderId, refund.reason || '预约退款');
  if (result && [REFUND_STATUS.PENDING_CONFIG, REFUND_STATUS.PROCESSING].includes(result.status)) return { deferred: true };
}

async function deferJob(job) {
  const jobId = job._id || job.id;
  await db.collection(COLLECTIONS.jobs).doc(jobId).update({ data: { status: 'PENDING', nextRunAt: addMinutes(Date.now(), 30), leaseUntil: 0, updatedAt: Date.now() } });
}

async function repairReconciliationJobs(now) {
  let repaired = 0;
  const payments = await db.collection(COLLECTIONS.payments).where({ status: db.command.in([
    PAYMENT_STATUS.NOT_STARTED,
    PAYMENT_STATUS.PREPAY_SUBMITTING,
    PAYMENT_STATUS.PREPAY_CREATED,
    PAYMENT_STATUS.UNKNOWN,
    PAYMENT_STATUS.CLOSE_PENDING
  ]) }).limit(100).get();
  for (const payment of payments.data || []) {
    const order = await getOptional(COLLECTIONS.orders, payment.orderId);
    if (!order || (order.status === ORDER_STATUS.PENDING_PAYMENT && Number(order.paymentDeadline || 0) > now && payment.status !== PAYMENT_STATUS.CLOSE_PENDING)) continue;
    const needsCancellationReconcile = payment.status === PAYMENT_STATUS.CLOSE_PENDING || order.status !== ORDER_STATUS.PENDING_PAYMENT;
    const jobId = needsCancellationReconcile ? `job_payment_reconcile_${order.id}` : `job_payment_expire_${order.id}`;
    const existing = await getOptional(COLLECTIONS.jobs, jobId);
    if (existing && ['PENDING', 'RUNNING'].includes(existing.status)) continue;
    await db.collection(COLLECTIONS.jobs).doc(jobId).set({ data: { ...(existing || {}), _id: jobId, id: jobId, type: needsCancellationReconcile ? 'PAYMENT_RECONCILE' : 'PAYMENT_EXPIRE', businessId: order.id, status: 'PENDING', nextRunAt: now, retryCount: 0, leaseUntil: 0, createdAt: existing && existing.createdAt || now, updatedAt: now } });
    repaired += 1;
  }
  const refunds = await db.collection(COLLECTIONS.refunds).where({ status: db.command.in([
    REFUND_STATUS.INIT,
    REFUND_STATUS.PENDING_CONFIG,
    REFUND_STATUS.SUBMITTING,
    REFUND_STATUS.PROCESSING
  ]) }).limit(100).get();
  for (const refund of refunds.data || []) {
    if (await scheduleRefundRetry(refund.orderId, refund.id || refund._id)) repaired += 1;
  }
  return repaired;
}

exports.main = async () => {
  const now = Date.now();
  const repaired = await repairReconciliationJobs(now);
  const [pendingJobs, expiredJobs] = await Promise.all([
    db.collection(COLLECTIONS.jobs).where({ status: 'PENDING', nextRunAt: db.command.lte(now) }).limit(50).get(),
    db.collection(COLLECTIONS.jobs).where({ status: 'RUNNING', leaseUntil: db.command.lte(now) }).limit(50).get()
  ]);
  const jobs = [...(pendingJobs.data || []), ...(expiredJobs.data || [])].slice(0, 50);
  const result = { processed: 0, failed: 0, repaired };
  for (const job of jobs) {
    if (!(await claimJob(job))) continue;
    try {
      if (job.type === 'PAYMENT_EXPIRE') await processPaymentExpire(job);
      else if (job.type === 'PAYMENT_RECONCILE') {
        const paymentResult = await processPaymentReconcile(job);
        if (paymentResult && paymentResult.deferred) {
          await deferJob(job);
          result.processed += 1;
          continue;
        }
      }
      else if (job.type === 'NO_SHOW') await processNoShow(job);
      else if (job.type === 'REFUND_RETRY') {
        const refundResult = await processRefund(job);
        if (refundResult && refundResult.deferred) {
          await deferJob(job);
          result.processed += 1;
          continue;
        }
      }
      await finishJob(job, 'DONE');
      result.processed += 1;
    } catch (error) {
      console.error('后台任务失败', { jobId: job._id || job.id, type: job.type, message: error.message });
      await finishJob(job, 'FAILED', error.message || 'unknown error');
      result.failed += 1;
    }
  }
  return result;
};
