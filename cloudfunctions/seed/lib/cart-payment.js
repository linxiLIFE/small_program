const crypto = require('crypto');
const { db, getOptional } = require('./db');
const { COLLECTIONS, ORDER_STATUS, PAYMENT_STATUS } = require('./constants');
const { assert, AppError } = require('./errors');
const { requireOpenId } = require('./auth');
const booking = require('./booking');
const wechat = require('./wechat-pay');

async function groupForOrder(orderId, reader = db) {
  const order = await getOptional(COLLECTIONS.orders, orderId, reader);
  if (!order || !order.paymentGroupId) return null;
  const group = await getOptional(COLLECTIONS.payments, order.paymentGroupId, reader);
  assert(group && group.orderIds.includes(orderId) && group.userId === order.userId, 'PAYMENT_NOT_FOUND', '合并支付记录不存在', 404);
  return group;
}
async function ownedGroup(id) {
  const group = await getOptional(COLLECTIONS.payments, id);
  assert(group && Array.isArray(group.orderIds), 'PAYMENT_NOT_FOUND', '合并支付记录不存在', 404);
  assert(group.userId === requireOpenId().openid, 'FORBIDDEN', '无权操作该支付单', 403);
  return group;
}
async function setGroupState(transaction, group, state, extra = {}) {
  const now = Date.now();
  const next = { ...group, ...extra, status: state, updatedAt: now };
  await transaction.collection(COLLECTIONS.payments).doc(group.id).set({ data: next });
  for (const id of group.orderIds) {
    const order = await getOptional(COLLECTIONS.orders, id, transaction);
    const payment = await getOptional(COLLECTIONS.payments, `pay_${id}`, transaction);
    if (!order || !payment || payment.status === PAYMENT_STATUS.SUCCESS) continue;
    await transaction.collection(COLLECTIONS.payments).doc(payment.id).set({ data: { ...payment, status: state, updatedAt: now } });
    await transaction.collection(COLLECTIONS.orders).doc(id).set({ data: { ...order, paymentStatus: state, updatedAt: now } });
  }
  return next;
}
async function pendingGroup(transaction, group) {
  assert(group.paymentDeadline > Date.now(), 'PAYMENT_DEADLINE_EXPIRED', '支付时间已结束', 409);
  assert(![PAYMENT_STATUS.SUCCESS, PAYMENT_STATUS.CLOSED, PAYMENT_STATUS.CLOSE_PENDING].includes(group.status), 'ORDER_NOT_PAYABLE', '当前合并订单不能继续支付', 409);
  for (const id of group.orderIds) {
    const order = await getOptional(COLLECTIONS.orders, id, transaction);
    assert(order && order.status === ORDER_STATUS.PENDING_PAYMENT, 'ORDER_NOT_PAYABLE', '预约状态发生变化，请查看订单', 409);
    // All bookings own a day occupancy; validate it still belongs to this order.
    const day = await getOptional(COLLECTIONS.technicianDays, booking.dayId(order.technicianId, order.date), transaction);
    assert(day && (day.occupancies || []).some(x => x.orderId === id && x.status === ORDER_STATUS.PENDING_PAYMENT && x.startAt === order.startAt && x.endAt === order.endAt), 'SLOT_TAKEN', '预约时段已发生变化，请重新预约', 409);
  }
}
async function prepareGroupPayment(id) {
  const group = await ownedGroup(id);
  if (!wechat.isConfigured()) return { configured: false, message: '微信支付尚未配置，合并订单已保留，请在订单中继续支付。' };
  const attemptId = crypto.randomBytes(16).toString('hex');
  const claim = await db.runTransaction(async transaction => {
    const latest = await getOptional(COLLECTIONS.payments, id, transaction);
    await pendingGroup(transaction, latest);
    if (latest.status === PAYMENT_STATUS.PREPAY_CREATED && latest.prepayId) return { reused: true, group: latest };
    assert(!(latest.status === PAYMENT_STATUS.PREPAY_SUBMITTING && latest.prepareLeaseUntil > Date.now()), 'PAYMENT_PREPARING', '支付参数正在生成，请稍后重试', 409);
    return { group: await setGroupState(transaction, latest, PAYMENT_STATUS.PREPAY_SUBMITTING, { paymentAttemptId: attemptId, prepareLeaseUntil: Date.now() + 120000 }) };
  });
  if (claim.reused) return { configured: true, ...wechat.buildJsapiPayParams(claim.group.prepayId), groupId: id, amountFen: group.amountFen, reused: true };
  let params;
  try {
    params = await wechat.createJsapiPrepay({ description: `四个小姐姐的店 ${group.orderIds.length} 项预约`, outTradeNo: group.merchantOrderNo, amountFen: group.amountFen, openid: group.userId, timeExpire: group.paymentDeadline });
  } catch (error) {
    await db.runTransaction(async transaction => {
      const latest = await getOptional(COLLECTIONS.payments, id, transaction);
      if (latest.status === PAYMENT_STATUS.PREPAY_SUBMITTING && latest.paymentAttemptId === attemptId) await setGroupState(transaction, latest, PAYMENT_STATUS.UNKNOWN, { prepareLeaseUntil: 0 });
    });
    throw error;
  }
  const accepted = await db.runTransaction(async transaction => {
    const latest = await getOptional(COLLECTIONS.payments, id, transaction);
    if (latest.status !== PAYMENT_STATUS.PREPAY_SUBMITTING || latest.paymentAttemptId !== attemptId) return false;
    try { await pendingGroup(transaction, latest); } catch (error) { return false; }
    await setGroupState(transaction, latest, PAYMENT_STATUS.PREPAY_CREATED, { prepayId: params.prepayId, prepareLeaseUntil: 0, mchid: wechat.config().mchid });
    return true;
  });
  if (!accepted) {
    await closeGroup(id);
    throw new AppError('ORDER_NOT_PAYABLE', '合并订单已关闭，请查看订单', 409);
  }
  const { prepayId, ...client } = params;
  return { configured: true, ...client, groupId: id, amountFen: group.amountFen };
}
async function markGroupSuccess(id, payload) {
  const results = await db.runTransaction(async transaction => {
    const group = await getOptional(COLLECTIONS.payments, id, transaction);
    assert(group && Array.isArray(group.orderIds), 'PAYMENT_NOT_FOUND', '合并支付记录不存在', 404);
    assert(Number(payload.amountFen) === group.amountFen, 'PAYMENT_AMOUNT_MISMATCH', '合并支付金额校验失败');
    if (payload.currency) assert(payload.currency === 'CNY', 'PAYMENT_CURRENCY_MISMATCH', '支付币种校验失败');
    if (payload.payerOpenid) assert(payload.payerOpenid === group.userId, 'PAYMENT_PAYER_MISMATCH', '支付用户校验失败');
    if (group.transactionId && payload.transactionId) assert(group.transactionId === payload.transactionId, 'PAYMENT_TRANSACTION_MISMATCH', '微信支付交易号不一致');
    const items = [];
    let sum = 0;
    for (const orderId of group.orderIds) {
      const order = await getOptional(COLLECTIONS.orders, orderId, transaction);
      assert(order && order.userId === group.userId && order.paymentGroupId === id, 'PAYMENT_ORDER_MISMATCH', '合并预约校验失败');
      sum += order.paidFen;
      items.push(await booking.markPaymentSuccess(orderId, { ...payload, amountFen: order.paidFen }, { transaction, group: true }));
    }
    assert(sum === group.amountFen, 'PAYMENT_AMOUNT_MISMATCH', '预约金额与合并支付金额不一致');
    await transaction.collection(COLLECTIONS.payments).doc(id).set({ data: { ...group, status: PAYMENT_STATUS.SUCCESS, transactionId: payload.transactionId || group.transactionId || '', paidAt: payload.paidAt || group.paidAt || Date.now(), updatedAt: Date.now() } });
    return items;
  });
  for (const result of results) {
    if (result.order.status === ORDER_STATUS.RESERVED && !result.duplicate) await require('./notification-service').notifyOrderEvent('appointmentSuccess', await getOptional(COLLECTIONS.orders, result.order.id));
  }
  return { status: PAYMENT_STATUS.SUCCESS, orders: results.map(x => x.order), duplicate: results.every(x => x.duplicate), shouldRefund: results.some(x => x.shouldRefund) };
}
async function markGroupClosed(id, providerState) {
  return db.runTransaction(async transaction => {
    const group = await getOptional(COLLECTIONS.payments, id, transaction);
    if (group.status === PAYMENT_STATUS.SUCCESS) return { status: group.status };
    for (const orderId of group.orderIds) await booking.markPaymentClosed(orderId, providerState, { transaction });
    // Cancelled children also need their CLOSE_PENDING payment resolved.
    await setGroupState(transaction, group, PAYMENT_STATUS.CLOSED, { providerState, prepareLeaseUntil: 0 });
    return { status: PAYMENT_STATUS.CLOSED };
  });
}
function missingProvider(error) { return error.code === 'PAYMENT_PROVIDER_ERROR' && ['ORDER_NOT_EXIST', 'RESOURCE_NOT_EXISTS'].includes(error.details && error.details.providerCode); }
async function queryGroup(group, close = false) {
  if (group.status === PAYMENT_STATUS.SUCCESS) return { status: group.status };
  if (group.status === PAYMENT_STATUS.CLOSED && !close) return { status: group.status };
  const expired = Date.now() >= group.paymentDeadline;
  if (close || expired) {
    group = await db.runTransaction(async transaction => {
      const latest = await getOptional(COLLECTIONS.payments, group.id, transaction);
      if ([PAYMENT_STATUS.SUCCESS, PAYMENT_STATUS.CLOSED].includes(latest.status)) return latest;
      const wasNotStarted = latest.status === PAYMENT_STATUS.NOT_STARTED;
      return { ...await setGroupState(transaction, latest, PAYMENT_STATUS.CLOSE_PENDING), wasNotStarted };
    });
    if (group.status === PAYMENT_STATUS.SUCCESS) return { status: group.status };
    if (group.status === PAYMENT_STATUS.CLOSED) return { status: group.status };
    if (group.wasNotStarted) return markGroupClosed(group.id, 'NOT_STARTED_CLOSED');
  }
  assert(wechat.isConfigured() || group.status === PAYMENT_STATUS.NOT_STARTED, 'PAYMENT_CHECK_REQUIRED', '支付配置不可用，合并订单将继续查单', 409);
  if (!wechat.isConfigured()) return { configured: false, status: group.status };
  let provider;
  try { provider = await wechat.queryOrder(group.merchantOrderNo); }
  catch (error) {
    if (!missingProvider(error)) throw error;
    if (group.status === PAYMENT_STATUS.CLOSE_PENDING && Date.now() < group.paymentDeadline + 120000) throw new AppError('PAYMENT_CLOSE_PENDING', '合并支付单正在关闭，请稍后查看', 409);
    if (close || expired) return markGroupClosed(group.id, 'ORDER_NOT_EXIST');
    return { status: group.status };
  }
  if (provider.trade_state === 'SUCCESS') return markGroupSuccess(group.id, { amountFen: provider.amount && provider.amount.total, currency: provider.amount && provider.amount.currency, payerOpenid: provider.payer && provider.payer.openid, transactionId: provider.transaction_id, paidAt: Date.parse(provider.success_time) || Date.now() });
  if (['CLOSED', 'REVOKED'].includes(provider.trade_state)) return markGroupClosed(group.id, provider.trade_state);
  if (provider.trade_state === 'NOTPAY' && (close || expired || group.status === PAYMENT_STATUS.CLOSE_PENDING)) {
    try { await wechat.closeOrder(group.merchantOrderNo); } catch (error) {
      // A provider payment may win the query/close race; retry query before cancelling.
      const latest = await wechat.queryOrder(group.merchantOrderNo);
      if (latest.trade_state === 'SUCCESS') return markGroupSuccess(group.id, { amountFen: latest.amount && latest.amount.total, currency: latest.amount && latest.amount.currency, payerOpenid: latest.payer && latest.payer.openid, transactionId: latest.transaction_id, paidAt: Date.parse(latest.success_time) || Date.now() });
      if (['CLOSED', 'REVOKED'].includes(latest.trade_state)) return markGroupClosed(group.id, latest.trade_state);
      throw error;
    }
    return markGroupClosed(group.id, 'CLOSED');
  }
  return { status: provider.trade_state === 'NOTPAY' ? PAYMENT_STATUS.PREPAY_CREATED : PAYMENT_STATUS.UNKNOWN };
}
async function queryGroupPayment(id) { return queryGroup(await ownedGroup(id)); }
async function closeGroup(id) { return queryGroup(await getOptional(COLLECTIONS.payments, id), true); }
module.exports = { groupForOrder, prepareGroupPayment, queryGroupPayment, markGroupSuccess, closeGroup, queryGroup };
