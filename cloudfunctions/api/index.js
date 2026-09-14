const crypto = require('crypto');
const cloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { publicError, AppError } = require('./lib/errors');
const { withRequestContext } = require('./lib/db');
const { getCurrentSettings, publicSettings } = require('./lib/settings');
const catalog = require('./lib/catalog');
const booking = require('./lib/booking');
const payment = require('./lib/payment-service');
const admin = require('./lib/admin');

function requestId() {
  return `req_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

const serverApp = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
const serverAuth = serverApp.auth();

function getRequestContext() {
  try {
    const identity = serverAuth.getUserInfo() || {};
    return {
      openid: identity.openId || '',
      appid: identity.appId || '',
      uid: identity.uid || '',
      customUserId: identity.customUserId || ''
    };
  } catch (error) {
    console.warn('CloudBase auth context unavailable', { message: error.message });
    return {};
  }
}

async function getBookingContext(payload = {}) {
  const serviceId = payload.serviceId || '';
  const workId = payload.workId || '';
  const [settings, service, technicians, profile, work] = await Promise.all([
    getCurrentSettings(),
    catalog.getService(serviceId),
    catalog.listTechnicians(serviceId),
    booking.getProfile(),
    catalog.getWork(workId)
  ]);
  return { settings: publicSettings(settings), service, technicians, profile, work };
}

async function route(action, payload) {
  switch (action) {
    case 'getHome': return catalog.getHome(await getCurrentSettings());
    case 'listServices': return catalog.listServiceCatalog(payload && payload.categoryId);
    case 'listServiceStyles': return catalog.listServiceStyles(payload && payload.serviceId);
    case 'getBookingContext': return getBookingContext(payload || {});
    case 'getService': return catalog.getService(payload && payload.serviceId);
    case 'getWork': return catalog.getWork(payload && payload.workId);
    case 'listTechnicians': return { technicians: await catalog.listTechnicians(payload && payload.serviceId) };
    case 'getSettings': return publicSettings(await getCurrentSettings());
    case 'getAvailableSlots': return booking.getAvailableSlots(payload || {});
    case 'getProfile': return booking.getProfile();
    case 'updateProfile': return booking.updateProfile(payload || {});
    case 'bindPhone': return booking.bindPhone(payload || {});
    case 'createQuote': return booking.createQuote(payload || {});
    case 'createOrder': return booking.createOrder(payload || {});
    case 'listOrders': return booking.listOrders(payload && payload.status);
    case 'getOrder': return booking.getOrder(payload && payload.orderId);
    case 'cancelOrder': return booking.cancelOrder(payload && payload.orderId);
    case 'deleteOrder': return booking.deleteOrder(payload && payload.orderId);
    case 'preparePayment': return payment.preparePayment(payload && payload.orderId);
    case 'queryPayment': return payment.queryPayment(payload && payload.orderId);
    case 'listPoints': return booking.listPoints();
    case 'staffListOrders': return booking.staffListOrders(payload && payload.status);
    case 'staffTransition': return booking.transitionStaff(payload && payload.orderId, payload && payload.action);
    case 'adminUploadImage': return require('./lib/media').uploadImage(payload || {});
    case 'adminSaveCategory': return require('./lib/catalog-admin').saveCategory(payload || {});
    case 'adminSaveTechnician': return require('./lib/catalog-admin').saveTechnician(payload || {});
    case 'staffSession': return require('./lib/team').session();
    case 'adminCreateTechnicianLogin': return require('./lib/team').createTechnicianLogin(payload || {});
    case 'adminPreviewTechnicianSchedule': return admin.previewTechnicianSchedule(payload || {});
    case 'mySchedule': return admin.mySchedule(payload || {});
    case 'saveMySchedule': return admin.saveScheduleDay(payload || {});
    case 'adminSummary': return admin.summary(payload || {});
    case 'adminListOrders': return admin.listOrdersForAdmin(payload || {});
    case 'adminCatalog': return admin.listCatalog();
    case 'adminSchedule': return admin.schedule(payload || {});
    case 'adminSaveScheduleDay': return admin.saveScheduleDay(payload || {});
    case 'adminSaveWeeklySchedule': return admin.saveWeeklySchedule(payload || {});
    case 'adminSaveWork': return admin.saveWork(payload || {});
    case 'adminSaveService': return admin.saveService(payload || {});
    case 'adminSaveSettings': return admin.saveSettings(payload || {});
    case 'adminPaymentStatus': return admin.getPaymentConfigStatus();
    case 'adminRefund': return admin.refundOrder(payload || {});
    default: throw new AppError('UNKNOWN_ACTION', '不支持的业务操作');
  }
}

exports.main = async (event = {}) => {
  const id = requestId();
  try {
    const data = await withRequestContext(getRequestContext(), () => route(event.action, event.payload || {}));
    return { ok: true, requestId: id, data: await require('./lib/media').resolveImages(data) };
  } catch (error) {
    const safe = publicError(error);
    console.error('api request failed', { requestId: id, code: safe.code });
    return { ok: false, requestId: id, error: safe };
  }
};
