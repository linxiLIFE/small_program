const { cloud, db, getOptional } = require('./db');
const { COLLECTIONS } = require('./constants');
const { getCurrentSettings } = require('./settings');
const { formatParts } = require('./time');

const EVENT_NAMES = Object.freeze(['appointmentSuccess', 'arrivalReminder', 'checkInSuccess', 'noShowRefund']);

function clipped(value, max = 20) {
  return String(value || '').trim().slice(0, max) || '—';
}

function timeText(timestamp) {
  const parts = formatParts(timestamp);
  return `${parts.month}月${parts.day}日 ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function moneyText(fen) {
  return `${(Math.max(0, Number(fen || 0)) / 100).toFixed(2)}元`;
}

function templateData(eventName, template, order, settings) {
  const common = {
    service: clipped(order.workSnapshot && order.workSnapshot.title || order.serviceSnapshot && order.serviceSnapshot.name, 20),
    time: clipped(timeText(eventName === 'checkInSuccess' ? Date.now() : order.startAt), 20),
    technician: clipped(order.technicianSnapshot && order.technicianSnapshot.name, 20),
    address: clipped(settings.store && settings.store.address, 20)
  };
  if (eventName === 'appointmentSuccess' || eventName === 'checkInSuccess') {
    return {
      [template.serviceKey]: { value: common.service },
      [template.timeKey]: { value: common.time },
      [template.technicianKey]: { value: common.technician }
    };
  }
  if (eventName === 'arrivalReminder') {
    return {
      [template.serviceKey]: { value: common.service },
      [template.timeKey]: { value: common.time },
      [template.addressKey]: { value: common.address }
    };
  }
  return {
    [template.serviceKey]: { value: common.service },
    [template.amountKey]: { value: moneyText(order.refundAmountFen || 0) },
    [template.statusKey]: { value: clipped(order.noShowNoRefund ? '未到店，不予退款' : '未到店，退款已处理', 5) }
  };
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
      subscriptions[templateId] = { status: String(status), acceptedAt: status === 'accept' ? now : Number(subscriptions[templateId] && subscriptions[templateId].acceptedAt || 0), updatedAt: now };
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
  const user = await getOptional(COLLECTIONS.users, order.userId);
  const subscription = user && user.subscriptions && user.subscriptions[template.templateId];
  if (!subscription || subscription.status !== 'accept' || Number(subscription.usedAt || 0) > Number(subscription.acceptedAt || 0)) return { sent: false, reason: 'NOT_SUBSCRIBED' };
  const recordId = `submsg_${eventName}_${order.id}`;
  const existing = await getOptional(COLLECTIONS.notifications, recordId);
  if (existing && existing.status === 'DONE') return { sent: true, duplicate: true };
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: order.userId,
      templateId: template.templateId,
      page: `${template.page || 'pages/order-detail/index'}?orderId=${encodeURIComponent(order.id)}`,
      data: templateData(eventName, template, order, settings),
      miniprogramState: process.env.WX_MINIPROGRAM_STATE || 'formal',
      lang: 'zh_CN'
    });
    const now = Date.now();
    await db.runTransaction(async (transaction) => {
      const latestUser = await getOptional(COLLECTIONS.users, order.userId, transaction);
      const subscriptions = { ...(latestUser.subscriptions || {}) };
      subscriptions[template.templateId] = { ...(subscriptions[template.templateId] || {}), usedAt: now, updatedAt: now };
      await transaction.collection(COLLECTIONS.users).doc(order.userId).set({ data: { ...latestUser, subscriptions, updatedAt: now } });
      await transaction.collection(COLLECTIONS.notifications).doc(recordId).set({ data: { _id: recordId, id: recordId, channel: 'SUBSCRIBE_MESSAGE', eventName, orderId: order.id, status: 'DONE', templateId: template.templateId, createdAt: existing && existing.createdAt || now, updatedAt: now } });
    });
    return { sent: true };
  } catch (error) {
    const now = Date.now();
    await db.collection(COLLECTIONS.notifications).doc(recordId).set({ data: { ...(existing || {}), _id: recordId, id: recordId, channel: 'SUBSCRIBE_MESSAGE', eventName, orderId: order.id, status: 'FAILED', templateId: template.templateId, lastError: String(error.errCode || error.code || error.message || 'SEND_FAILED'), createdAt: existing && existing.createdAt || now, updatedAt: now } });
    console.error('订阅消息发送失败', { eventName, orderId: order.id, code: error.errCode || error.code || '' });
    return { sent: false, reason: 'SEND_FAILED' };
  }
}

module.exports = { EVENT_NAMES, saveSubscriptionPreferences, notifyOrderEvent, templateData };
