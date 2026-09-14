const crypto = require('crypto');
const { COLLECTIONS } = require('./constants');
const { db, getContext, getOptional } = require('./db');
const { AppError } = require('./errors');

const LIMITS = Object.freeze({
  getAvailableSlots: { max: 60, windowMs: 60 * 1000 },
  createQuote: { max: 30, windowMs: 60 * 1000 },
  queryPayment: { max: 30, windowMs: 60 * 1000 },
  preparePayment: { max: 10, windowMs: 60 * 1000 },
  bindPhone: { max: 5, windowMs: 10 * 60 * 1000 },
  bindInviteCode: { max: 10, windowMs: 10 * 60 * 1000 },
  redeemCheckInCode: { max: 30, windowMs: 60 * 1000 }
});

async function enforceActionRateLimit(action) {
  const rule = LIMITS[action];
  if (!rule) return;
  const context = getContext();
  const identity = String(context.openid || context.uid || '').trim();
  if (!identity) return;
  const now = Date.now();
  const bucket = Math.floor(now / rule.windowMs);
  const digest = crypto.createHash('sha256').update(`${identity}:${action}:${bucket}`).digest('hex').slice(0, 48);
  const id = `rate_${digest}`;
  await db.runTransaction(async (transaction) => {
    const existing = await getOptional(COLLECTIONS.rateLimits, id, transaction);
    const count = Number(existing && existing.count || 0);
    if (count >= rule.max) throw new AppError('RATE_LIMITED', '操作太频繁，请稍后再试', 429);
    await transaction.collection(COLLECTIONS.rateLimits).doc(id).set({ data: { ...(existing || {}), _id: id, id, action, bucket, count: count + 1, expiresAt: (bucket + 2) * rule.windowMs, createdAt: existing && existing.createdAt || now, updatedAt: now } });
  });
}

module.exports = { LIMITS, enforceActionRateLimit };
