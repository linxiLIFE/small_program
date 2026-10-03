const crypto = require('crypto');
const { db, getOptional } = require('./db');
const { COLLECTIONS, PAYMENT_STATUS, ORDER_STATUS } = require('./constants');
const { assert } = require('./errors');
const { requireOpenId, ensureUser } = require('./auth');
const booking = require('./booking');
const { bookingRequestHash } = require('./finance-state');

const MAX_ITEMS = 10;
function cartItems(payload) {
  assert(Array.isArray(payload.items) && payload.items.length > 0 && payload.items.length <= MAX_ITEMS, 'INVALID_CART', `请选择 1-${MAX_ITEMS} 项预约`);
  return payload.items;
}
function cartHash(items) { return crypto.createHash('sha256').update(JSON.stringify(items.map(bookingRequestHash))).digest('hex'); }
function assertNoOverlap(items) {
  const sorted = [...items].sort((a, b) => a.startAt - b.startAt);
  const endByTechnician = new Map();
  for (const item of sorted) {
    const previousEnd = endByTechnician.get(item.technicianId);
    assert(previousEnd === undefined || Number(item.startAt) >= previousEnd, 'CART_SLOT_CONFLICT', '购物车内同一技师的预约时间重叠，请调整后再付款', 409);
    endByTechnician.set(item.technicianId, Number(item.startAt) + Number(item.durationMinutes) * 60000);
  }
}
async function createCartQuote(payload) {
  const items = cartItems(payload);
  const openid = requireOpenId().openid;
  const [settings, account] = await Promise.all([booking.getCurrentSettings(), booking.getPointsAccount(openid)]);
  const quotes = [];
  // Allocate the same points balance once across the cart, in display order.
  let remainingPoints = Math.max(0, Number(payload.pointsToUse || 0));
  for (let index = 0; index < items.length; index++) {
    try {
      const quote = await booking.createQuote({ ...items[index], pointsToUse: remainingPoints }, { settings, account });
      remainingPoints -= quote.pointsToUse;
      quotes.push(quote);
    } catch (error) { error.message = `第 ${index + 1} 项：${error.message}`; throw error; }
  }
  assertNoOverlap(quotes);
  return { quotes, totalFen: quotes.reduce((sum, q) => sum + q.totalFen, 0), discountFen: quotes.reduce((sum, q) => sum + q.discountFen, 0), paidFen: quotes.reduce((sum, q) => sum + q.paidFen, 0), pointsToUse: quotes.reduce((sum, q) => sum + q.pointsToUse, 0) };
}
async function createCartOrder(payload) {
  const items = cartItems(payload);
  const { openid, appid } = requireOpenId();
  const user = await ensureUser(openid, requireOpenId());
  assert(user.phoneCipher, 'PHONE_REQUIRED', '预约前请先授权并绑定手机号');
  const key = String(payload.idempotencyKey || '').trim();
  assert(key && key.length <= 80, 'INVALID_IDEMPOTENCY_KEY', '缺少有效的结算标识');
  const groupId = `cart_${crypto.createHash('sha256').update(`${openid}:${key}`).digest('hex').slice(0, 40)}`;
  const requestHash = cartHash(items);

  const result = await db.runTransaction(async transaction => {
    // User first, then group, then bookings: serialize concurrent single/cart checkout.
    await getOptional(COLLECTIONS.users, openid, transaction);
    const existing = await getOptional(COLLECTIONS.payments, groupId, transaction);
    if (existing) {
      assert(existing.userId === openid && existing.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT', '购物车内容已变化，请重新结算', 409);
      return { group: existing, replay: true };
    }
    const forcePending = items.some(item => booking.readQuoteId(item.quoteId).paidFen > 0);
    const orders = [];
    for (let index = 0; index < items.length; index++) {
      try {
        const result = await booking.createOrder({ ...items[index], idempotencyKey: `${key}:${index}` }, { transaction, groupId, user, forcePending });
        orders.push(result.order);
      } catch (error) { error.message = `第 ${index + 1} 项：${error.message}`; throw error; }
    }
    assertNoOverlap(orders);
    const amountFen = orders.reduce((sum, o) => sum + o.paidFen, 0);
    assert(Number.isSafeInteger(amountFen) && amountFen >= 0, 'INVALID_AMOUNT', '结算金额不正确');
    const now = Date.now();
    const group = { _id: groupId, id: groupId, userId: openid, appid, requestHash, orderIds: orders.map(o => o.id), amountFen, status: amountFen > 0 ? PAYMENT_STATUS.NOT_STARTED : PAYMENT_STATUS.SUCCESS, merchantOrderNo: `SC${crypto.randomBytes(14).toString('hex').toUpperCase()}`, paymentDeadline: amountFen > 0 ? Math.min(...orders.filter(o => o.paidFen > 0).map(o => o.deadline)) : 0, createdAt: now, updatedAt: now };
    for (const order of orders) {
      const stored = await getOptional(COLLECTIONS.orders, order.id, transaction);
      await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: { ...stored, paymentGroupPaidFen: amountFen, paymentGroupCount: orders.length, paymentDeadline: group.paymentDeadline } });
    }
    await transaction.collection(COLLECTIONS.payments).doc(groupId).set({ data: group });
    return { group, replay: false };
  });
  const orders = [];
  for (const id of result.group.orderIds) {
    const order = await getOptional(COLLECTIONS.orders, id);
    orders.push(booking.publicOrder(order));
    if (!result.replay && order.status === ORDER_STATUS.RESERVED) await require('./notification-service').notifyOrderEvent('appointmentSuccess', order);
  }
  return { groupId, orders, paymentRequired: result.group.amountFen > 0 && result.group.status !== PAYMENT_STATUS.SUCCESS, paidFen: result.group.amountFen, replay: result.replay };
}
module.exports = { createCartQuote, createCartOrder, assertNoOverlap, cartHash, MAX_ITEMS };
