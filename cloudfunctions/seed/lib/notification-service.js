const { cloud, db, getOptional } = require('./db');
const { COLLECTIONS } = require('./constants');
const { getCurrentSettings } = require('./settings');
const { formatParts } = require('./time');

const EVENT_NAMES = Object.freeze(['appointmentSuccess', 'arrivalReminder', 'checkInSuccess', 'noShowRefund']);
const ACCEPTED_SUBSCRIPTION_STATUSES = new Set(['accept', 'acceptWithAudio']);

function subscriptionAccepted(status) {
  return ACCEPTED_SUBSCRIPTION_STATUSES.has(String(status || ''));
}

function subscriptionQuota(subscription = {}) {
  const hasCounters = Number.isSafeInteger(subscription.acceptedCount) && Number.isSafeInteger(subscription.usedCount);
  if (hasCounters) {
    const acceptedCount = Math.max(0, Number(subscription.acceptedCount));
    const usedCount = Math.max(0, Math.min(acceptedCount, Number(subscription.usedCount)));
    return { acceptedCount, usedCount, availableCount: Math.max(0, acceptedCount - usedCount) };
  }
  const acceptedAt = Number(subscription.acceptedAt || 0);
  const usedAt = Number(subscription.usedAt || 0);
  const acceptedCount = subscriptionAccepted(subscription.status) && acceptedAt > 0 ? 1 : 0;
  const usedCount = acceptedCount && usedAt >= acceptedAt ? 1 : 0;
  return { acceptedCount, usedCount, availableCount: Math.max(0, acceptedCount - usedCount) };
}

function clipped(value, max = 20) {
  return String(value || '').trim().slice(0, max) || '—';
}

function timeText(timestamp) {
  const parts = formatParts(timestamp);
  return `${parts.month}月${parts.day}日 ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function templateTimeText(timestamp, key) {
  const parts = formatParts(timestamp);
  if (/^date\d+$/.test(String(key || ''))) {
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  }
  if (/^time\d+$/.test(String(key || ''))) {
    return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  }
  return timeText(timestamp);
}

function moneyText(fen) {
  return `${(Math.max(0, Number(fen || 0)) / 100).toFixed(2)}元`;
}

function putTemplateValue(data, key, value) {
  if (key) data[key] = { value };
}

function templateData(eventName, template, order, settings) {
  const common = {
    service: clipped(order.workSnapshot && order.workSnapshot.title || order.serviceSnapshot && order.serviceSnapshot.name, 20),
    time: clipped(templateTimeText(eventName === 'checkInSuccess' ? Date.now() : order.startAt, template.timeKey), 20),
    technician: clipped(order.technicianSnapshot && order.technicianSnapshot.name, 20),
    address: clipped(settings.store && settings.store.address, 20)
  };
  if (eventName === 'appointmentSuccess' || eventName === 'checkInSuccess') {
    const data = {};
    putTemplateValue(data, template.serviceKey, common.service);
    putTemplateValue(data, template.timeKey, common.time);
    putTemplateValue(data, template.technicianKey, common.technician);
    return data;
  }
  if (eventName === 'arrivalReminder') {
    const data = {};
    putTemplateValue(data, template.serviceKey, common.service);
    putTemplateValue(data, template.timeKey, common.time);
    putTemplateValue(data, template.addressKey, common.address);
    return data;
  }
  const data = {};
  putTemplateValue(data, template.serviceKey, common.service);
  putTemplateValue(data, template.amountKey, moneyText(order.refundAmountFen || 0));
  putTemplateValue(data, template.storeKey || template.addressKey, common.address);
  // 兼容旧的带状态字段配置；当前退款模板使用“门店”字段，不再发送多余字段。
  if (!template.storeKey && !template.addressKey) {
    putTemplateValue(data, template.statusKey, clipped(order.noShowNoRefund ? '未到店，不予退款' : '未到店，退款已处理', 5));
  }
  return data;
}

async function saveSubscriptionPreferences(statuses = {}) {
  const { requireOpenId, ensureUser, safeUser } = require('./auth');
  const context = requireOpenId();
  await ensureUser(context.openid, context);
  const settings = await getCurrentSettings();
  const allowed = new Set(EVENT_NAMES.map((event) => settings.notifications.templates[event].templateId).filter(Boolean));
  const now = Date.now();
  const updated = await db.runTransaction(async (transaction) => {
    const user = await getOptional(COLLECTIONS.users, context.openid, transaction);
    const subscriptions = { ...(user.subscriptions || {}) };
    for (const [templateId, status] of Object.entries(statuses || {})) {
      if (!allowed.has(templateId)) continue;
      const previous = subscriptions[templateId] || {};
      const quota = subscriptionQuota(previous);
      const accepted = subscriptionAccepted(status);
      const acceptedCount = quota.acceptedCount + (accepted ? 1 : 0);
      subscriptions[templateId] = {
        ...previous,
        status: String(status),
        acceptedAt: accepted ? now : Number(previous.acceptedAt || 0),
        acceptedCount,
        usedCount: quota.usedCount,
        availableCount: Math.max(0, acceptedCount - quota.usedCount),
        updatedAt: now
      };
    }
    const next = { ...user, subscriptions, updatedAt: now };
    await transaction.collection(COLLECTIONS.users).doc(context.openid).set({ data: next });
    return next;
  });
  return safeUser(updated, await getOptional(COLLECTIONS.pointsAccounts, context.openid));
}

async function notifyOrderEvent(eventName, order) {
  if (!EVENT_NAMES.includes(eventName) || !order || !order.userId) return { sent: false, reason: 'INVALID_EVENT' };
  const settings = await getCurrentSettings();
  if (!settings.notifications || settings.notifications.enabled === false) return { sent: false, reason: 'DISABLED' };
  const template = settings.notifications.templates && settings.notifications.templates[eventName];
  if (!template || !template.templateId) return { sent: false, reason: 'NOT_CONFIGURED' };
  const recordId = `submsg_${eventName}_${order.id}`;
  const now = Date.now();
  const claimToken = `${now}_${Math.random().toString(36).slice(2, 12)}`;
  const claim = await db.runTransaction(async (transaction) => {
    const existing = await getOptional(COLLECTIONS.notifications, recordId, transaction);
    if (existing && existing.status === 'DONE') return { duplicate: true };
    if (existing && existing.status === 'PROCESSING' && Number(existing.leaseUntil || 0) > now) return { inFlight: true };
    const user = await getOptional(COLLECTIONS.users, order.userId, transaction);
    const subscriptions = { ...((user && user.subscriptions) || {}) };
    const subscription = subscriptions[template.templateId] || {};
    const quota = subscriptionQuota(subscription);
    if (!quota.availableCount) return { unavailable: true };
    const usedCount = quota.usedCount + 1;
    subscriptions[template.templateId] = {
      ...subscription,
      acceptedCount: quota.acceptedCount,
      usedCount,
      availableCount: Math.max(0, quota.acceptedCount - usedCount),
      usedAt: now,
      updatedAt: now
    };
    await transaction.collection(COLLECTIONS.users).doc(order.userId).set({ data: { ...user, subscriptions, updatedAt: now } });
    await transaction.collection(COLLECTIONS.notifications).doc(recordId).set({ data: { ...(existing || {}), _id: recordId, id: recordId, channel: 'SUBSCRIBE_MESSAGE', eventName, orderId: order.id, status: 'PROCESSING', templateId: template.templateId, claimToken, leaseUntil: now + 2 * 60 * 1000, createdAt: existing && existing.createdAt || now, updatedAt: now } });
    return { claimed: true };
  });
  if (claim.duplicate) return { sent: true, duplicate: true };
  if (claim.inFlight) return { sent: false, reason: 'IN_FLIGHT' };
  if (!claim.claimed) return { sent: false, reason: 'NOT_SUBSCRIBED' };
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: order.userId,
      templateId: template.templateId,
      page: `${template.page || 'pages/order-detail/index'}?orderId=${encodeURIComponent(order.id)}`,
      data: templateData(eventName, template, order, settings),
      miniprogramState: process.env.WX_MINIPROGRAM_STATE || 'formal',
      lang: 'zh_CN'
    });
    await db.runTransaction(async (transaction) => {
      const record = await getOptional(COLLECTIONS.notifications, recordId, transaction);
      if (!record || record.claimToken !== claimToken) return;
      const completedAt = Date.now();
      await transaction.collection(COLLECTIONS.notifications).doc(recordId).set({ data: { ...record, status: 'DONE', claimToken: '', leaseUntil: 0, updatedAt: completedAt } });
    });
    return { sent: true };
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const record = await getOptional(COLLECTIONS.notifications, recordId, transaction);
      if (!record || record.claimToken !== claimToken) return;
      const failedAt = Date.now();
      const user = await getOptional(COLLECTIONS.users, order.userId, transaction);
      const subscriptions = { ...((user && user.subscriptions) || {}) };
      const subscription = subscriptions[template.templateId] || {};
      const quota = subscriptionQuota(subscription);
      const usedCount = Math.max(0, quota.usedCount - 1);
      subscriptions[template.templateId] = { ...subscription, acceptedCount: quota.acceptedCount, usedCount, availableCount: Math.max(0, quota.acceptedCount - usedCount), updatedAt: failedAt };
      await transaction.collection(COLLECTIONS.users).doc(order.userId).set({ data: { ...user, subscriptions, updatedAt: failedAt } });
      await transaction.collection(COLLECTIONS.notifications).doc(recordId).set({ data: { ...record, status: 'FAILED', claimToken: '', leaseUntil: 0, lastError: String(error.errCode || error.code || error.message || 'SEND_FAILED'), updatedAt: failedAt } });
    });
    console.error('订阅消息发送失败', { eventName, orderId: order.id, code: error.errCode || error.code || '' });
    return { sent: false, reason: 'SEND_FAILED' };
  }
}

module.exports = { EVENT_NAMES, saveSubscriptionPreferences, notifyOrderEvent, templateData, subscriptionQuota };
