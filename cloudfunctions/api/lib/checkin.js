const crypto = require('crypto');
const { COLLECTIONS, ORDER_STATUS } = require('./constants');
const { db, getOptional } = require('./db');
const { requireOpenId, requireRole } = require('./auth');
const { AppError, assert } = require('./errors');

function signingSecret() {
  const secret = String(process.env.CHECKIN_SIGNING_SECRET || process.env.QUOTE_SIGNING_SECRET || '').trim();
  assert(secret.length >= 32, 'CHECKIN_SECRET_NOT_CONFIGURED', '核销签名密钥未配置或长度不足', 503);
  return secret;
}

function signature(body) {
  return crypto.createHmac('sha256', signingSecret()).update(`checkin:${body}`).digest('base64url');
}

function encodeToken(claims) {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `shiguang://checkin/${body}.${signature(body)}`;
}

function decodeToken(value) {
  const token = String(value || '').trim().replace(/^shiguang:\/\/checkin\//, '');
  const [body, provided, ...extra] = token.split('.');
  assert(body && provided && !extra.length, 'CHECKIN_CODE_INVALID', '核销码无法识别', 400);
  const expected = signature(body);
  assert(provided.length === expected.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected)), 'CHECKIN_CODE_INVALID', '核销码校验失败', 400);
  let claims;
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (error) { throw new AppError('CHECKIN_CODE_INVALID', '核销码内容损坏', 400); }
  assert(claims && claims.orderId && claims.nonce && Number(claims.expiresAt) >= Date.now(), 'CHECKIN_CODE_EXPIRED', '核销码已过期', 409);
  return claims;
}

async function ensureNonce(orderId, userId) {
  return db.runTransaction(async (transaction) => {
    const order = await getOptional(COLLECTIONS.orders, orderId, transaction);
    assert(order && order.userId === userId && !order.deletedAt, 'ORDER_NOT_FOUND', '订单不存在', 404);
    assert([ORDER_STATUS.RESERVED, ORDER_STATUS.NO_SHOW_REVIEW, ORDER_STATUS.ARRIVED].includes(order.status), 'CHECKIN_CODE_UNAVAILABLE', '当前订单不能生成核销码', 409);
    if (order.checkInNonce) return order;
    const next = { ...order, checkInNonce: crypto.randomBytes(18).toString('base64url'), updatedAt: Date.now() };
    await transaction.collection(COLLECTIONS.orders).doc(orderId).set({ data: next });
    return next;
  });
}

async function getCheckInCode(orderId) {
  const { openid } = requireOpenId();
  const order = await ensureNonce(String(orderId || ''), openid);
  const token = encodeToken({ v: 1, orderId: order.id, nonce: order.checkInNonce, expiresAt: Number(order.endAt || order.startAt) + 24 * 60 * 60 * 1000 });
  const dataUrl = await require('qrcode').toDataURL(token, { errorCorrectionLevel: 'M', margin: 2, width: 560, color: { dark: '#5f4548', light: '#fffaf5' } });
  return { orderId: order.id, token, dataUrl, status: order.status };
}

async function redeemCheckInCode(value) {
  const { account } = await requireRole(['OWNER', 'STAFF', 'TECHNICIAN']);
  const claims = decodeToken(value);
  const order = await getOptional(COLLECTIONS.orders, claims.orderId);
  assert(order && order.checkInNonce === claims.nonce, 'CHECKIN_CODE_INVALID', '核销码与订单不匹配', 409);
  if (account.role === 'TECHNICIAN') assert(order.technicianId === account.technicianId, 'FORBIDDEN', '技师只能核销分配给自己的预约', 403);
  return require('./booking').transitionStaff(order.id, 'checkIn');
}

module.exports = { getCheckInCode, redeemCheckInCode, encodeToken, decodeToken };
