const cloudConfig = require('../cloud-config');
const mock = require('./mock-data');

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
    return result.data;
  } catch (error) {
    if (error && error.isBusinessError) throw error;
    console.warn(`CloudBase api/${action} 调用失败，将使用演示数据`, error);
    markDemo();
    if (typeof fallback === 'function') return fallback(error);
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

function getHome() {
  return call('getHome', {}, () => ({
    store: mock.settings,
    categories: mock.categories,
    services: mock.services.slice(0, 3),
    works: mock.works,
    technicians: mock.technicians
  }));
}

function listServices(categoryId = '') {
  return call('listServices', { categoryId }, () => ({
    categories: mock.categories,
    services: categoryId ? mock.services.filter((item) => item.categoryId === categoryId) : mock.services,
    works: categoryId ? mock.works.filter((item) => item.categoryId === categoryId) : mock.works
  }));
}

function getService(serviceId) {
  return call('getService', { serviceId }, () => mock.services.find((item) => item.id === serviceId) || mock.services[0]);
}

function getWork(workId) {
  return call('getWork', { workId }, () => mock.works.find((item) => item.id === workId) || mock.works[0]);
}

function listTechnicians(serviceId = '') {
  return call('listTechnicians', { serviceId }, () => ({
    technicians: serviceId ? mock.technicians.filter((item) => item.skills.includes(serviceId)) : mock.technicians
  }));
}

function getAvailableSlots(payload) {
  return call('getAvailableSlots', payload, () => ({
    date: payload.date,
    slots: mock.getSlots(payload.date)
  }));
}

function getProfile() {
  return call('getProfile', {}, () => mock.profile);
}

function bindPhone(code) {
  return call('bindPhone', { code }, () => ({ ...mock.profile, phoneMasked: mock.profile.phoneMasked, demo: true }));
}

function createQuote(payload) {
  return call('createQuote', payload, () => {
    const service = mock.services.find((item) => item.id === payload.serviceId) || mock.services[0];
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

function createOrder(payload) {
  return call('createOrder', payload, () => {
    const service = mock.services.find((item) => item.id === payload.serviceId) || mock.services[0];
    const tech = mock.technicians.find((item) => item.id === payload.technicianId) || mock.technicians[0];
    const quote = payload.quote || {};
    const order = {
      id: `demo-order-${Date.now()}`, status: quote.paidFen > 0 ? 'PENDING_PAYMENT' : 'RESERVED', statusLabel: quote.paidFen > 0 ? '待付款' : '待到店',
      serviceName: service.name, technicianName: tech.name, date: payload.date, startAt: payload.startAt,
      durationMinutes: service.durationMinutes, totalFen: service.priceFen, pointsUsed: quote.pointsToUse || 0,
      discountFen: quote.discountFen || 0, paidFen: quote.paidFen || service.priceFen, refundStatus: '', demo: true
    };
    mock.orders.unshift(order);
    return { order, paymentRequired: order.paidFen > 0, demo: true };
  });
}

function listOrders(status = '') {
  return call('listOrders', { status }, () => ({
    orders: status ? mock.orders.filter((item) => item.status === status) : mock.orders
  }));
}

function getOrder(orderId) {
  return call('getOrder', { orderId }, () => mock.orders.find((item) => item.id === orderId) || mock.orders[0]);
}

function cancelOrder(orderId) {
  return call('cancelOrder', { orderId }, () => {
    const order = mock.orders.find((item) => item.id === orderId);
    if (order) {
      order.status = 'CANCELLED_BY_USER';
      order.statusLabel = '已取消';
      order.refundStatus = order.paidFen ? 'PROCESSING' : '';
    }
    return order;
  });
}

function queryPayment(orderId) {
  return call('queryPayment', { orderId }, () => getOrder(orderId));
}

function preparePayment(orderId) {
  return call('preparePayment', { orderId }, () => ({
    configured: false,
    message: '演示环境尚未配置微信支付资质，订单已保留，请在服务端补齐商户配置后再支付。'
  }));
}

function listPoints() {
  return call('listPoints', {}, () => ({
    account: { available: mock.profile.points, frozen: 0 },
    ledger: [
      { id: 'point-demo-1', type: 'EARN', amount: 680, description: '历史演示积分', createdAt: Date.now() - 86400000 * 3 },
      { id: 'point-demo-2', type: 'CONSUME', amount: -40, description: '预约抵扣', createdAt: Date.now() - 86400000 * 8 }
    ]
  }));
}

function staffListOrders(status = '') {
  return call('staffListOrders', { status }, () => listOrders(status));
}

function staffTransition(orderId, action) {
  return call('staffTransition', { orderId, action }, () => {
    const order = mock.orders.find((item) => item.id === orderId);
    const next = { checkIn: 'ARRIVED', start: 'IN_SERVICE', complete: 'COMPLETED' }[action];
    if (order && next) {
      order.status = next;
      order.statusLabel = { ARRIVED: '已到店', IN_SERVICE: '服务中', COMPLETED: '已完成' }[next];
    }
    return order;
  });
}

module.exports = {
  call,
  getHome,
  listServices,
  getService,
  getWork,
  listTechnicians,
  getAvailableSlots,
  getProfile,
  bindPhone,
  createQuote,
  createOrder,
  listOrders,
  getOrder,
  cancelOrder,
  queryPayment,
  preparePayment,
  listPoints,
  staffListOrders,
  staffTransition
};
