const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const fs = require('fs');
const path = require('path');
const sharedRoot = fs.existsSync(path.join(__dirname, 'lib')) ? './lib' : '../api/lib';
const { db, getOptional } = require(`${sharedRoot}/db`);
const { COLLECTIONS, PAYMENT_STATUS, REFUND_STATUS, ORDER_STATUS } = require(`${sharedRoot}/constants`);
const { markPaymentSuccess, markPaymentClosed, markNoShow } = require(`${sharedRoot}/booking`);
const { requestRefund } = require(`${sharedRoot}/payment-service`);
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
  const provider = await wechat.queryOrder(payment.merchantOrderNo);
  if (provider.trade_state === 'SUCCESS') {
    await markPaymentSuccess(order.id, { amountFen: provider.amount && provider.amount.total, transactionId: provider.transaction_id, paidAt: provider.success_time ? Date.parse(provider.success_time) : Date.now() });
    return;
  }
  if (provider.trade_state === 'NOTPAY' || provider.trade_state === 'CLOSED' || provider.trade_state === 'REVOKED') {
    if (provider.trade_state === 'NOTPAY') await wechat.closeOrder(payment.merchantOrderNo);
    await markPaymentClosed(order.id);
    return;
  }
  throw new Error(`支付状态待确认: ${provider.trade_state || 'UNKNOWN'}`);
}

async function processNoShow(job) {
  await markNoShow(job.businessId);
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

exports.main = async () => {
  const now = Date.now();
  const [pendingJobs, expiredJobs] = await Promise.all([
    db.collection(COLLECTIONS.jobs).where({ status: 'PENDING', nextRunAt: db.command.lte(now) }).limit(50).get(),
    db.collection(COLLECTIONS.jobs).where({ status: 'RUNNING', leaseUntil: db.command.lte(now) }).limit(50).get()
  ]);
  const jobs = [...(pendingJobs.data || []), ...(expiredJobs.data || [])].slice(0, 50);
  const result = { processed: 0, failed: 0 };
  for (const job of jobs) {
    if (!(await claimJob(job))) continue;
    try {
      if (job.type === 'PAYMENT_EXPIRE') await processPaymentExpire(job);
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
