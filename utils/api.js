const cloudConfig = require('../cloud-config');
const mock = require('./mock-data');

const responseCache = new Map();
const pendingRequests = new Map();
const legacyActions = new Set();
const CACHE_TTL = {
  getHome: 45 * 1000,
  listServices: 45 * 1000,
  listServiceStyles: 45 * 1000,
  getBookingContext: 30 * 1000,
  getService: 60 * 1000,
  getWork: 60 * 1000,
  listTechnicians: 60 * 1000,
  getSettings: 60 * 1000,
  getProfile: 15 * 1000,
  listOrders: 10 * 1000,
  getOrder: 10 * 1000,
  listPoints: 30 * 1000,
  staffListOrders: 5 * 1000
};

function getAppSafe() {
  try {
    return getApp();
  } catch (error) {
    return { globalData: {} };
  }
}

function markDemo() {
  const app = getAppSafe();
  app.globalData.isDemo = true;
}

async function call(action, payload = {}, fallback) {
  const canCallCloud = cloudConfig.env && wx.cloud && typeof wx.cloud.callFunction === 'function';
  if (!canCallCloud) {
    markDemo();
    return typeof fallback === 'function' ? fallback() : fallback;
  }

  try {
    const response = await wx.cloud.callFunction({
      name: 'api',
      data: { action, payload }
    });
    const result = response && response.result;
    if (!result || result.ok === false) {
      const error = new Error(result && result.error ? result.error.message : '服务暂不可用');
      error.code = result && result.error ? result.error.code : 'API_ERROR';
      error.isBusinessError = !!(result && result.ok === false);
      throw error;
    }
    getAppSafe().globalData.isDemo = false;
    return result.data;
  } catch (error) {
    if (error && error.isBusinessError) throw error;
    console.warn(`CloudBase api/${action} 调用失败`, {code:error.code || error.errCode});
    throw error;
  }
}

function cacheKey(action, payload) {
  return `${action}:${JSON.stringify(payload || {})}`;
}

function cachedCall(action, payload, fallback) {
  const key = cacheKey(action, payload);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);

  const pending = pendingRequests.get(key);
  if (pending) return pending;

  const request = call(action, payload, fallback).then((value) => {
    responseCache.set(key, {
      value,
      expiresAt: Date.now() + (CACHE_TTL[action] || 30 * 1000)
    });
    if (responseCache.size > 80) {
      const now = Date.now();
      for (const [cacheKeyValue, entry] of responseCache) {
        if (entry.expiresAt <= now || responseCache.size > 60) responseCache.delete(cacheKeyValue);
        if (responseCache.size <= 60) break;
      }
    }
    pendingRequests.delete(key);
    return value;
  }, (error) => {
    pendingRequests.delete(key);
    throw error;
  });
  pendingRequests.set(key, request);
  return request;
}

function clearCache(action = '') {
  if (!action) {
    responseCache.clear();
    return;
  }
  const prefix = `${action}:`;
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
}

function getHome() {
  return cachedCall('getHome', {}, () => ({
    store: mock.settings,
    banners: [],
    categories: mock.categories,
    services: mock.services.slice(0, 3),
    works: mock.works.filter(item => item.featured === true),
    technicians: mock.technicians
  }));
}

function listServices(categoryId = '') {
  return cachedCall('listServices', { categoryId }, () => ({
    categories: mock.categories,
    services: (categoryId ? mock.services.filter((item) => item.categoryId === categoryId) : mock.services).map((item) => ({
      ...item,
      styleCount: mock.works.filter((work) => work.serviceId === item.id && work.published !== false).length
    })),
    works: categoryId ? mock.works.filter((item) => item.categoryId === categoryId) : mock.works
  }));
}

function listLegacyServiceStyles(serviceId) {
  return listServices().then((result) => {
    const service = (result.services || []).find((item) => item.id === serviceId);
    return {
      service: service || null,
      works: (result.works || []).filter((item) => item.serviceId === serviceId && item.published !== false)
    };
  });
}

function listServiceStyles(serviceId) {
  if (legacyActions.has('listServiceStyles')) return listLegacyServiceStyles(serviceId);
  return cachedCall('listServiceStyles', { serviceId }, () => {
    const service = mock.services.find((item) => item.id === serviceId);
    return {
      service: service ? {
        ...service,
        styleCount: mock.works.filter((work) => work.serviceId === service.id && work.published !== false).length
      } : null,
      works: service ? mock.works.filter((work) => work.serviceId === service.id && work.published !== false) : []
    };
  }).catch((error) => {
    if (error && error.code === 'UNKNOWN_ACTION') {
      legacyActions.add('listServiceStyles');
      return listLegacyServiceStyles(serviceId);
    }
    throw error;
  });
}

function getLegacyBookingContext(serviceId, workId) {
  return Promise.all([
    getSettings(),
    getService(serviceId),
    listTechnicians(serviceId),
    getProfile(),
    getWork(workId)
  ]).then(([settings, service, technicianResult, profile, work]) => ({
    settings,
    service,
    technicians: technicianResult.technicians || [],
    profile,
    work
  }));
}

function getBookingContext(serviceId, workId) {
  const payload = { serviceId, workId };
  if (legacyActions.has('getBookingContext')) return getLegacyBookingContext(serviceId, workId);
  return cachedCall('getBookingContext', payload, () => {
    const service = mock.services.find((item) => item.id === serviceId) || null;
    const work = mock.works.find((item) => item.id === workId) || null;
    return {
      settings: { booking: { openDays: 14 }, points: { maxPercent: mock.settings.pointMaxPercent } },
      service,
      technicians: service ? mock.technicians.filter((item) => (item.categoryIds || []).includes(service.categoryId)) : [],
      profile: mock.profile,
      work
    };
  }).catch((error) => {
    if (error && error.code === 'UNKNOWN_ACTION') {
      legacyActions.add('getBookingContext');
      return getLegacyBookingContext(serviceId, workId);
    }
    throw error;
  });
}

function getService(serviceId) {
  return cachedCall('getService', { serviceId }, () => mock.services.find((item) => item.id === serviceId) || mock.services[0]);
}

function getWork(workId) {
  return cachedCall('getWork', { workId }, () => mock.works.find((item) => item.id === workId) || mock.works[0]);
}

function listTechnicians(serviceId = '') {
  return cachedCall('listTechnicians', { serviceId }, () => ({
    technicians: serviceId
      ? mock.technicians.filter((item) => {
        const service = mock.services.find((candidate) => candidate.id === serviceId);
        return service && (item.categoryIds || []).includes(service.categoryId);
      })
      : mock.technicians
  }));
}

function getAvailableSlots(payload) {
  return call('getAvailableSlots', payload, () => ({
    date: payload.date,
    stepMinutes: 15,
    slots: mock.getSlots(payload.date)
  }));
}

function getProfile() {
  return cachedCall('getProfile', {}, () => mock.profile);
}

async function updateProfile(nickname) {
  const value = String(nickname || '').trim();
  if (!value || value.length > 20) throw Object.assign(new Error('用户名需填写 1 到 20 个字符'), { code: 'INVALID_NICKNAME' });
  const result = await call('updateProfile', { nickname: value }, () => ({ ...mock.profile, nickname: value, demo: true }));
  Object.assign(mock.profile, result);
  clearCache('getProfile');
  clearCache('getBookingContext');
  return result;
}

async function bindPhone(code) {
  const result = await call('bindPhone', { code }, () => ({ ...mock.profile, phoneMasked: mock.profile.phoneMasked, demo: true }));
  clearCache('getProfile');
  clearCache('getBookingContext');
  return result;
}

function createQuote(payload) {
  return call('createQuote', payload, () => {
    const work = mock.works.find((item) => item.id === payload.workId && item.published !== false);
    if (!work) throw Object.assign(new Error('请选择款式后再预约'), { code: 'STYLE_REQUIRED' });
    const service = mock.services.find((item) => item.id === work.serviceId && item.id === payload.serviceId) || mock.services.find((item) => item.id === work.serviceId);
    if (!service) throw Object.assign(new Error('款式所属小项目已下架'), { code: 'WORK_SERVICE_MISMATCH' });
    const pointsToUse = Math.max(0, Number(payload.pointsToUse || 0));
    const maxDiscountFen = Math.floor(service.priceFen * mock.settings.pointMaxPercent / 100);
    const discountFen = Math.min(maxDiscountFen, Math.floor(pointsToUse / mock.settings.pointUnit) * mock.settings.pointDiscountFen);
    return {
      quoteId: `demo-quote-${Date.now()}`,
      expiresAt: Date.now() + 10 * 60 * 1000,
      serviceId: service.id,
      totalFen: service.priceFen,
      discountFen,
      paidFen: service.priceFen - discountFen,
      pointsToUse: discountFen / mock.settings.pointDiscountFen * mock.settings.pointUnit,
      pointRule: { unit: mock.settings.pointUnit, discountFen: mock.settings.pointDiscountFen, maxPercent: mock.settings.pointMaxPercent },
      demo: true
    };
  });
}

async function createOrder(payload) {
  const result = await call('createOrder', payload, () => {
    const work = mock.works.find((item) => item.id === payload.workId && item.published !== false);
    if (!work) throw Object.assign(new Error('请选择款式后再预约'), { code: 'STYLE_REQUIRED' });
    const service = mock.services.find((item) => item.id === work.serviceId && item.id === payload.serviceId) || mock.services.find((item) => item.id === work.serviceId);
    if (!service) throw Object.assign(new Error('款式所属小项目已下架'), { code: 'WORK_SERVICE_MISMATCH' });
    const tech = mock.technicians.find((item) => item.id === payload.technicianId) || mock.technicians[0];
    const quote = payload.quote || {};
    const createdAt = Date.now();
    const order = {
      id: `demo-order-${Date.now()}`, status: quote.paidFen > 0 ? 'PENDING_PAYMENT' : 'RESERVED', statusLabel: quote.paidFen > 0 ? '待付款' : '待到店',
      work,
      serviceName: service.name, technicianName: tech.name, date: payload.date, startAt: payload.startAt,
      durationMinutes: service.durationMinutes, totalFen: service.priceFen, pointsUsed: quote.pointsToUse || 0,
      discountFen: quote.discountFen || 0, paidFen: quote.paidFen || service.priceFen, refundStatus: '',
      createdAt, deadline: quote.paidFen > 0 ? createdAt + 5 * 60 * 1000 : 0, demo: true
    };
    mock.orders.unshift(order);
    return { order, paymentRequired: order.paidFen > 0, demo: true };
  });
  clearCache('getProfile');
  clearCache('getBookingContext');
  clearCache('listOrders');
  clearCache('getOrder');
  clearCache('listPoints');
  return result;
}

function listOrders(status = '', cursor = 0, limit = 20) {
  const payload = Array.isArray(status) ? { statuses: status, cursor, limit } : { status, cursor, limit };
  return cachedCall('listOrders', payload, () => {
    const orders = mock.orders.filter((item) => !item.deletedAt).map(expireDemoPayment);
    const filtered = Array.isArray(status) ? orders.filter((item) => status.includes(item.status)) : status ? orders.filter((item) => item.status === status) : orders;
    return { orders: filtered.slice(cursor,cursor+limit), nextCursor: cursor+limit<filtered.length?cursor+limit:null };
  });
}

function getOrder(orderId) {
  return cachedCall('getOrder', { orderId }, () => {
    const order = mock.orders.find((item) => item.id === orderId);
    return order && !order.deletedAt ? expireDemoPayment(order) : null;
  });
}

async function cancelOrder(orderId) {
  const result = await call('cancelOrder', { orderId }, () => {
    const order = mock.orders.find((item) => item.id === orderId);
    if (order) {
      order.status = 'CANCELLED_BY_USER';
      order.statusLabel = '已取消';
      order.refundStatus = order.paidFen ? 'PROCESSING' : '';
    }
    return order;
  });
  clearCache('listOrders');
  clearCache('getOrder');
  clearCache('listPoints');
  return result;
}

async function deleteOrder(orderId) {
  const result = await call('deleteOrder', { orderId }, () => {
    const order = mock.orders.find((item) => item.id === orderId);
    if (!order || !['CANCELLED', 'CANCELLED_BY_USER', 'CANCELLED_NO_SHOW', 'REFUNDED'].includes(order.status)) {
      throw Object.assign(new Error('只有已取消或已退款订单可以删除'), { code: 'ORDER_NOT_DELETABLE' });
    }
    order.deletedAt = Date.now();
    return { deleted: true, orderId };
  });
  clearCache('listOrders');
  clearCache('getOrder');
  return result;
}

async function queryPayment(orderId) {
  const result = await call('queryPayment', { orderId }, () => expireDemoPayment(mock.orders.find((item) => item.id === orderId) || mock.orders[0]));
  clearCache('getOrder');
  clearCache('listOrders');
  return result;
}

function expireDemoPayment(order) {
  if (!order || order.status !== 'PENDING_PAYMENT') return order;
  const deadline = Number(order.deadline || order.paymentDeadline || (Number(order.createdAt || 0) + 5 * 60 * 1000));
  if (!deadline || Date.now() < deadline) return order;
  order.status = 'CANCELLED';
  order.statusLabel = '已取消';
  order.paymentStatus = 'CLOSED';
  return order;
}

function preparePayment(orderId) {
  return call('preparePayment', { orderId }, () => ({
    configured: false,
    message: '演示环境尚未配置微信支付资质，订单已保留，请在服务端补齐商户配置后再支付。'
  }));
}

function listPoints() {
  return cachedCall('listPoints', {}, () => ({
    account: { available: mock.profile.points, frozen: 0 },
    ledger: [
      { id: 'point-demo-1', type: 'EARN', amount: 680, description: '历史演示积分', createdAt: Date.now() - 86400000 * 3 },
      { id: 'point-demo-2', type: 'CONSUME', amount: -40, description: '预约抵扣', createdAt: Date.now() - 86400000 * 8 }
    ]
  }));
}

function staffListOrders(status = '', cursor = 0, limit = 20) {
  return cachedCall('staffListOrders', { status, cursor, limit }, () => listOrders(status,cursor,limit));
}

function getCheckInCode(orderId) {
  return call('getCheckInCode', { orderId });
}

async function redeemCheckInCode(code) {
  const result = await call('redeemCheckInCode', { code });
  clearCache('staffListOrders');
  clearCache('listOrders');
  clearCache('getOrder');
  return result;
}

async function bindInviteCode(inviteCode) {
  const result = await call('bindInviteCode', { inviteCode });
  clearCache('getProfile');
  clearCache('listPoints');
  return result;
}

function configuredTemplateIds(settings, events) {
  const templates = settings && settings.notifications && settings.notifications.templates || {};
  return (events || []).map((event) => templates[event] && templates[event].templateId).filter(Boolean).slice(0, 3);
}

async function requestSubscriptionEvents(settings, events) {
  const tmplIds = configuredTemplateIds(settings, events);
  if (!tmplIds.length || typeof wx.requestSubscribeMessage !== 'function') return { configured: tmplIds.length > 0, statuses: {} };
  const statuses = await new Promise((resolve, reject) => wx.requestSubscribeMessage({ tmplIds, success: resolve, fail: reject }));
  await call('saveSubscriptionPreferences', { statuses });
  clearCache('getProfile');
  return { configured: true, statuses };
}

async function staffTransition(orderId, action) {
  const result = await call('staffTransition', { orderId, action }, () => {
    const order = mock.orders.find((item) => item.id === orderId);
    const next = { checkIn: 'ARRIVED', start: 'IN_SERVICE', complete: 'COMPLETED' }[action];
    if (order && next) {
      order.status = next;
      order.statusLabel = { ARRIVED: '已到店', IN_SERVICE: '服务中', COMPLETED: '已完成' }[next];
    }
    return order;
  });
  clearCache('staffListOrders');
  clearCache('listOrders');
  clearCache('getOrder');
  return result;
}

module.exports = {
  call,
  clearCache,
  getHome,
  getSettings: () => cachedCall('getSettings', {}, () => ({ store: { ...mock.settings }, booking: { openDays: mock.settings.openDays, minAdvanceMinutes: mock.settings.minAdvanceMinutes }, points: { maxPercent: mock.settings.pointMaxPercent } })),
  listServices,
  listServiceStyles,
  getService,
  getWork,
  listTechnicians,
  getAvailableSlots,
  getProfile,
  updateProfile,
  bindPhone,
  createQuote,
  createOrder,
  listOrders,
  getOrder,
  cancelOrder,
  deleteOrder,
  queryPayment,
  preparePayment,
  listPoints,
  staffListOrders,
  staffTransition,
  getCheckInCode,
  redeemCheckInCode,
  bindInviteCode,
  requestSubscriptionEvents
};
