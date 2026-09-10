const crypto = require('crypto');
const { COLLECTIONS, ORDER_STATUS, ACTIVE_ORDER_STATUSES, PAYMENT_STATUS, REFUND_STATUS } = require('./constants');
const { db, cloud, getOptional, find } = require('./db');
const { AppError, assert } = require('./errors');
const { requireOpenId, ensureUser, getUser, requireRole, safeUser } = require('./auth');
const { getCurrentSettings, publicSettings } = require('./settings');
const { getService, listServices, listWorks, listCategories, listTechnicians, getWork } = require('./catalog');
const { dateToTimestamp, weekday, minutesOfDay, addMinutes, isWithinDateWindow, assertValidStart, overlaps, toDateString, formatParts } = require('./time');
const { calculatePointsDiscount, earnPoints, rebalancePoints, awardPoints } = require('./money');
const { encryptPhone, maskPhone } = require('./contact-crypto');

function idempotencyId(openid, key) {
  return `idem_${crypto.createHash('sha256').update(`${openid}:${key}`).digest('hex').slice(0, 48)}`;
}

function orderId() {
  return `ord_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function merchantOrderNo(id) {
  return `SG${Date.now().toString(36).toUpperCase()}${id.slice(-8).toUpperCase()}`.slice(0, 32);
}

function quoteSecret() {
  return process.env.QUOTE_SIGNING_SECRET || 'development-only-quote-secret';
}

function createQuoteId(claims) {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', quoteSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readQuoteId(value) {
  const parts = String(value || '').split('.');
  assert(parts.length === 2, 'QUOTE_INVALID', '报价已失效，请重新获取');
  const expected = crypto.createHmac('sha256', quoteSecret()).update(parts[0]).digest('base64url');
  assert(parts[1].length === expected.length && crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected)), 'QUOTE_INVALID', '报价校验失败，请重新获取');
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (error) { throw new AppError('QUOTE_INVALID', '报价内容无法读取'); }
  assert(Number(claims.expiresAt) > Date.now(), 'QUOTE_EXPIRED', '报价已过期，请重新获取');
  return claims;
}

function dayId(technicianId, date) {
  return `${technicianId}_${date}`;
}

function displayTime(timestamp) {
  const parts = formatParts(timestamp);
  return `${parts.month}月${parts.day}日 ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function normalizeBreaks(breaks) {
  return Array.isArray(breaks) ? breaks.filter((item) => item && /^\d{2}:\d{2}$/.test(item.start) && /^\d{2}:\d{2}$/.test(item.end)) : [];
}

function normalizeShifts(shifts) {
  return Array.isArray(shifts) ? shifts.filter((item) => item && /^\d{2}:\d{2}$/.test(item.start) && /^\d{2}:\d{2}$/.test(item.end)).map((item) => ({ ...item, breaks: normalizeBreaks(item.breaks) })) : [];
}

async function getDayPlan(technicianId, date, settings, reader = db) {
  const override = await getOptional(COLLECTIONS.technicianDays, dayId(technicianId, date), reader);
  if (override) {
    return {
      ...override,
      technicianId,
      date,
      weekday: override.weekday || weekday(date),
      leave: !!override.leave,
      shifts: normalizeShifts(override.shifts),
      occupancies: Array.isArray(override.occupancies) ? override.occupancies : []
    };
  }
  const weekly = (settings.schedule.weekly || []).find((item) => Number(item.weekday) === weekday(date));
  return {
    _id: dayId(technicianId, date), technicianId, date, weekday: weekday(date),
    leave: !weekly || weekly.enabled === false,
    shifts: normalizeShifts(weekly && weekly.shifts),
    occupancies: [], version: 1
  };
}

async function getTechnician(technicianId) {
  const records = await find(COLLECTIONS.technicians, { enabled: true }, { limit: 200 });
  const technician = records.find((item) => (item.id || item._id) === technicianId);
  assert(technician, 'TECHNICIAN_NOT_FOUND', '技师不存在或已停用', 404);
  return { ...technician, id: technician.id || technician._id, skills: technician.skills || [] };
}

async function getPointsAccount(openid, reader = db) {
  const account = await getOptional(COLLECTIONS.pointsAccounts, openid, reader);
  return account || { _id: openid, userId: openid, available: 0, frozen: 0, debt: 0, version: 1, updatedAt: Date.now() };
}

function isBreak(startMinutes, endMinutes, breaks) {
  return breaks.some((item) => {
    const breakStart = Number(item.start.slice(0, 2)) * 60 + Number(item.start.slice(3));
    const breakEnd = Number(item.end.slice(0, 2)) * 60 + Number(item.end.slice(3));
    return overlaps(startMinutes, endMinutes, breakStart, breakEnd);
  });
}

function occupancyIsActive(item) {
  return !item.status || ACTIVE_ORDER_STATUSES.includes(item.status);
}

function getSlotFromPlan(plan, startAt, service, settings) {
  const endAt = addMinutes(startAt, Number(service.durationMinutes) + Number(service.bufferMinutes || 0));
  const startMinutes = minutesOfDay(startAt);
  const endMinutes = startMinutes + Number(service.durationMinutes) + Number(service.bufferMinutes || 0);
  const insideShift = plan.shifts.some((shift) => {
    const shiftStart = Number(shift.start.slice(0, 2)) * 60 + Number(shift.start.slice(3));
    const shiftEnd = Number(shift.end.slice(0, 2)) * 60 + Number(shift.end.slice(3));
    return startMinutes >= shiftStart && endMinutes <= shiftEnd && !isBreak(startMinutes, endMinutes, shift.breaks || []);
  });
  assert(!plan.leave && insideShift, 'SLOT_UNAVAILABLE', '该时段不在营业或排班范围内');
  const conflict = (plan.occupancies || []).find((item) => occupancyIsActive(item) && overlaps(startAt, endAt, item.startAt, item.endAt));
  assert(!conflict, 'SLOT_TAKEN', '该时段刚刚被其他顾客预约了');
  return { startAt, endAt, durationMinutes: Number(service.durationMinutes), bufferMinutes: Number(service.bufferMinutes || 0), stepMinutes: settings.booking.slotStepMinutes };
}

async function validateBookingSlot({ serviceId, technicianId, date, startAt, now = Date.now(), reader = db }) {
  const settings = await getCurrentSettings();
  const service = await getService(serviceId);
  const technician = await getTechnician(technicianId);
  assert(technician.skills.includes(service.id), 'SKILL_MISMATCH', '该技师暂不提供此项目');
  assertValidStart(date, Number(startAt), settings.booking.minAdvanceMinutes, settings.booking.openDays, now);
  const step = Number(settings.booking.slotStepMinutes || 15);
  const dateStart = dateToTimestamp(date);
  assert((Number(startAt) - dateStart) % (step * 60 * 1000) === 0, 'INVALID_SLOT', '预约时段必须按 15 分钟步长选择');
  const plan = await getDayPlan(technicianId, date, settings, reader);
  const slot = getSlotFromPlan(plan, Number(startAt), service, settings);
  return { settings, service, technician, plan, slot };
}

async function getAvailableSlots(payload) {
  const settings = await getCurrentSettings();
  const service = await getService(payload.serviceId);
  const technician = await getTechnician(payload.technicianId);
  assert(technician.skills.includes(service.id), 'SKILL_MISMATCH', '该技师暂不提供此项目');
  if (!isWithinDateWindow(payload.date, settings.booking.openDays, 0)) return { date: payload.date, slots: [] };
  const plan = await getDayPlan(payload.technicianId, payload.date, settings);
  const slots = [];
  const now = Date.now();
  const step = Number(settings.booking.slotStepMinutes || 15);
  for (const shift of plan.shifts) {
    const shiftStartMinutes = Number(shift.start.slice(0, 2)) * 60 + Number(shift.start.slice(3));
    const shiftEndMinutes = Number(shift.end.slice(0, 2)) * 60 + Number(shift.end.slice(3));
    for (let minute = shiftStartMinutes; minute < shiftEndMinutes; minute += step) {
      const hour = Math.floor(minute / 60);
      const rest = minute % 60;
      const startAt = dateToTimestamp(payload.date, `${String(hour).padStart(2, '0')}:${String(rest).padStart(2, '0')}`);
      const endAt = addMinutes(startAt, Number(service.durationMinutes) + Number(service.bufferMinutes || 0));
      const validByWindow = startAt >= addMinutes(now, settings.booking.minAdvanceMinutes);
      const validByShift = endAt <= dateToTimestamp(payload.date, shift.end);
      const validByBreak = !isBreak(minute, minute + Number(service.durationMinutes) + Number(service.bufferMinutes || 0), shift.breaks || []);
      const conflict = (plan.occupancies || []).some((item) => occupancyIsActive(item) && overlaps(startAt, endAt, item.startAt, item.endAt));
      if (validByWindow && validByShift && validByBreak && !conflict && !plan.leave) {
        slots.push({ id: `${payload.date}-${hour}-${rest}`, label: `${String(hour).padStart(2, '0')}:${String(rest).padStart(2, '0')}`, startAt, endAt, available: true });
      }
    }
  }
  return { date: payload.date, serviceId: service.id, technicianId: technician.id, slots };
}

async function createQuote(payload) {
  const validation = await validateBookingSlot(payload);
  const openid = requireOpenId().openid;
  const account = await getPointsAccount(openid);
  const rule = {
    unit: validation.settings.points.unit,
    discountFen: validation.settings.points.discountFen,
    maxPercent: validation.settings.points.maxPercent
  };
  const price = calculatePointsDiscount({ totalFen: validation.service.priceFen, availablePoints: account.available, requestedPoints: Number(payload.pointsToUse || 0), rule });
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const quoteId = createQuoteId({ serviceId: validation.service.id, technicianId: validation.technician.id, date: payload.date, startAt: Number(payload.startAt), pointsToUse: price.pointsToUse, totalFen: price.totalFen, discountFen: price.discountFen, paidFen: price.paidFen, settingsVersion: validation.settings.version, expiresAt });
  return {
    quoteId,
    expiresAt,
    serviceId: validation.service.id,
    technicianId: validation.technician.id,
    date: payload.date,
    startAt: Number(payload.startAt),
    settingsVersion: validation.settings.version,
    totalFen: price.totalFen,
    discountFen: price.discountFen,
    paidFen: price.paidFen,
    pointsToUse: price.pointsToUse,
    pointRule: rule,
    serverCalculated: true
  };
}

function publicOrder(order) {
  if (!order) return null;
  return {
    id: order.id || order._id,
    status: order.status,
    statusLabel: ({ PENDING_PAYMENT: '待付款', RESERVED: '待到店', ARRIVED: '已到店', IN_SERVICE: '服务中', COMPLETED: '已完成', CANCELLED: '已取消', CANCELLED_BY_USER: '已取消', CANCELLED_NO_SHOW: '未到店已取消' })[order.status] || '处理中',
    work: order.workSnapshot || null,
    serviceName: order.serviceSnapshot && order.serviceSnapshot.name,
    categoryName: order.serviceSnapshot && order.serviceSnapshot.categoryName,
    technicianName: order.technicianSnapshot && order.technicianSnapshot.name,
    technicianId: order.technicianId,
    customerName: order.customerSnapshot && order.customerSnapshot.nickname,
    phoneMasked: order.customerSnapshot && order.customerSnapshot.phoneMasked,
    date: order.date,
    startAt: order.startAt,
    endAt: order.endAt,
    startAtLabel: displayTime(order.startAt),
    durationMinutes: order.serviceSnapshot && order.serviceSnapshot.durationMinutes,
    totalFen: order.totalFen,
    discountFen: order.discountFen,
    paidFen: order.paidFen,
    pointsUsed: order.pointsUsed || 0,
    pointsEarned: order.pointsEarned || 0,
    refundStatus: order.refundStatus || '',
    refundId: order.refundId || '',
    createdAt: order.createdAt,
    paidAt: order.paidAt || 0,
    completedAt: order.completedAt || 0,
    paymentStatus: order.paymentStatus || PAYMENT_STATUS.NOT_STARTED,
    deadline: order.paymentDeadline || 0
  };
}

async function getOwnedOrder(orderIdValue, openid, reader = db) {
  const order = await getOptional(COLLECTIONS.orders, orderIdValue, reader);
  assert(order, 'ORDER_NOT_FOUND', '订单不存在', 404);
  assert(order.userId === openid, 'FORBIDDEN', '无权查看该订单', 403);
  return order;
}

async function updateDayOccupancy(reader, order, nextStatus) {
  const id = dayId(order.technicianId, order.date);
  const day = await getOptional(COLLECTIONS.technicianDays, id, reader);
  if (!day) return;
  const occupancies = (day.occupancies || []).map((item) => item.orderId === (order.id || order._id) ? { ...item, status: nextStatus } : item);
  await reader.collection(COLLECTIONS.technicianDays).doc(id).set({ data: { ...day, occupancies, version: Number(day.version || 0) + 1, updatedAt: Date.now() } });
}

async function addLedger(reader, id, data) {
  const existing = await getOptional(COLLECTIONS.pointsLedger, id, reader);
  if (existing) return false;
  await reader.collection(COLLECTIONS.pointsLedger).doc(id).set({ data: { _id: id, ...data, createdAt: Date.now() } });
  return true;
}

async function createOrder(payload) {
  const context = requireOpenId();
  const user = await ensureUser(context.openid, context);
  assert(user.phoneCipher, 'PHONE_REQUIRED', '预约前请先授权并绑定手机号');
  const validation = await validateBookingSlot(payload);
  const work = payload.workId ? await require('./catalog').getWork(payload.workId) : null;
  assert(!work || work.serviceId === validation.service.id, 'WORK_SERVICE_MISMATCH', '款式与项目不匹配');
  const account = await getPointsAccount(context.openid);
  const rule = { unit: validation.settings.points.unit, discountFen: validation.settings.points.discountFen, maxPercent: validation.settings.points.maxPercent };
  const price = calculatePointsDiscount({ totalFen: validation.service.priceFen, availablePoints: account.available, requestedPoints: Number(payload.pointsToUse || 0), rule });
  const claims = readQuoteId(payload.quoteId);
  assert(claims.serviceId === validation.service.id && claims.technicianId === validation.technician.id && claims.date === payload.date && Number(claims.startAt) === Number(payload.startAt), 'QUOTE_MISMATCH', '预约信息发生变化，请重新报价');
  assert(Number(claims.pointsToUse) === price.pointsToUse && Number(claims.paidFen) === price.paidFen, 'QUOTE_CHANGED', '价格或积分规则发生变化，请重新报价');
  const now = Date.now();
  const holdMinutes = Number(validation.settings.booking.unpaidHoldMinutes || 5);
  const deadline = addMinutes(now, holdMinutes);
  const key = String(payload.idempotencyKey || '').trim();
  assert(key && key.length <= 100, 'INVALID_IDEMPOTENCY_KEY', '缺少有效的幂等键');
  const idem = idempotencyId(context.openid, key);
  const id = orderId();
  const merchantNo = merchantOrderNo(id);
  const paymentId = `pay_${id}`;
  const status = price.paidFen > 0 ? ORDER_STATUS.PENDING_PAYMENT : ORDER_STATUS.RESERVED;
  const order = {
    _id: id, id, userId: context.openid, appid: context.appid,
    customerSnapshot: { nickname: user.nickname || '拾光顾客', phoneMasked: user.phoneMasked || '' },
    technicianId: validation.technician.id,
    technicianSnapshot: { id: validation.technician.id, name: validation.technician.name, title: validation.technician.title || '' },
    serviceId: validation.service.id,
    workSnapshot: work ? { id: work.id, title: work.title, imageUrl: work.imageUrl } : null,
    serviceSnapshot: { id: validation.service.id, name: validation.service.name, categoryId: validation.service.categoryId, categoryName: validation.service.categoryName, priceFen: validation.service.priceFen, durationMinutes: validation.service.durationMinutes, bufferMinutes: validation.service.bufferMinutes },
    date: payload.date, startAt: validation.slot.startAt, endAt: validation.slot.endAt,
    totalFen: price.totalFen, discountFen: price.discountFen, paidFen: price.paidFen,
    pointsUsed: price.pointsToUse, pointsFrozen: price.pointsToUse, pointsEarned: 0,
    pointRuleSnapshot: { ...validation.settings.points }, bookingRuleSnapshot: { ...validation.settings.booking }, settingsVersion: validation.settings.version,
    status, paymentStatus: price.paidFen > 0 ? PAYMENT_STATUS.NOT_STARTED : PAYMENT_STATUS.SUCCESS,
    paymentDeadline: price.paidFen > 0 ? deadline : 0, refundStatus: REFUND_STATUS.NOT_REQUIRED,
    createdAt: now, updatedAt: now
  };

  const result = await db.runTransaction(async (transaction) => {
    const existingIdem = await getOptional(COLLECTIONS.idempotency, idem, transaction);
    if (existingIdem && existingIdem.orderId) return { orderId: existingIdem.orderId, replay: true };
    const day = await getDayPlan(validation.technician.id, payload.date, validation.settings, transaction);
    assert(!day.leave, 'SLOT_UNAVAILABLE', '该日期技师休息');
    const conflict = (day.occupancies || []).find((item) => occupancyIsActive(item) && overlaps(order.startAt, order.endAt, item.startAt, item.endAt));
    assert(!conflict, 'SLOT_TAKEN', '该时段刚刚被其他顾客预约了');
    const activeUnpaid = await find(COLLECTIONS.orders, { userId: context.openid, status: ORDER_STATUS.PENDING_PAYMENT }, { limit: 1 }, transaction);
    assert(!activeUnpaid.length, 'UNPAID_ORDER_EXISTS', '你已有待付款订单，请先处理后再预约');
    const currentAccount = await getPointsAccount(context.openid, transaction);
    assert(Number(currentAccount.available || 0) >= price.pointsToUse, 'POINTS_NOT_ENOUGH', '积分余额刚刚发生变化，请重新报价');
    const occupancy = { orderId: id, startAt: order.startAt, endAt: order.endAt, status, createdAt: now };
    const nextDay = { ...day, _id: day._id || dayId(validation.technician.id, payload.date), occupancies: [...(day.occupancies || []), occupancy], version: Number(day.version || 0) + 1, updatedAt: now };
    await transaction.collection(COLLECTIONS.technicianDays).doc(nextDay._id).set({ data: nextDay });
    await transaction.collection(COLLECTIONS.orders).doc(id).set({ data: order });
    const payment = { _id: paymentId, id: paymentId, orderId: id, merchantOrderNo: merchantNo, appid: context.appid, mchid: '', amountFen: price.paidFen, status: order.paymentStatus, createdAt: now, updatedAt: now };
    await transaction.collection(COLLECTIONS.payments).doc(paymentId).set({ data: payment });
    if (price.pointsToUse > 0) {
      await transaction.collection(COLLECTIONS.pointsAccounts).doc(context.openid).set({ data: { ...currentAccount, available: Number(currentAccount.available || 0) - price.pointsToUse, frozen: Number(currentAccount.frozen || 0) + price.pointsToUse, version: Number(currentAccount.version || 0) + 1, updatedAt: now } });
      await addLedger(transaction, `freeze_${id}`, { userId: context.openid, orderId: id, type: 'FREEZE', amount: 0, balanceAfter: Number(currentAccount.available || 0) - price.pointsToUse, description: '预约下单冻结积分' });
    }
    await transaction.collection(COLLECTIONS.idempotency).doc(idem).set({ data: { _id: idem, userId: context.openid, key, orderId: id, createdAt: now, expiresAt: addMinutes(now, 24 * 60) } });
    if (price.paidFen > 0) {
      const jobId = `job_payment_expire_${id}`;
      await transaction.collection(COLLECTIONS.jobs).doc(jobId).set({ data: { _id: jobId, type: 'PAYMENT_EXPIRE', businessId: id, status: 'PENDING', nextRunAt: deadline, retryCount: 0, createdAt: now, updatedAt: now } });
    }
    if (status === ORDER_STATUS.RESERVED) {
      const noShowJobId = `job_no_show_${id}`;
      const noShowAt = addMinutes(order.startAt, Number(order.bookingRuleSnapshot.noShowGraceMinutes || 30));
      await transaction.collection(COLLECTIONS.jobs).doc(noShowJobId).set({ data: { _id: noShowJobId, id: noShowJobId, type: 'NO_SHOW', businessId: id, status: 'PENDING', nextRunAt: noShowAt, retryCount: 0, createdAt: now, updatedAt: now } });
    }
    return { orderId: id, replay: false };
  });
  const storedOrder = await getOptional(COLLECTIONS.orders, result.orderId);
  return { order: publicOrder(storedOrder), paymentRequired: storedOrder.paymentStatus !== PAYMENT_STATUS.SUCCESS, holdUntil: storedOrder.paymentDeadline || 0, replay: !!result.replay };
}

async function listOrders(status = '') {
  const { openid } = requireOpenId();
  const where = status ? { userId: openid, status } : { userId: openid };
  const orders = await find(COLLECTIONS.orders, where, { orderBy: { field: 'createdAt', direction: 'desc' }, limit: 50 });
  return { orders: orders.map(publicOrder) };
}

async function getOrder(orderIdValue) {
  const { openid } = requireOpenId();
  return publicOrder(await getOwnedOrder(orderIdValue, openid));
}

async function bindPhone(payload) {
  const context = requireOpenId();
  assert(payload && payload.code, 'PHONE_CODE_REQUIRED', '缺少手机号授权凭证');
  let phone;
  try {
    const result = await cloud.openapi.phonenumber.getPhoneNumber({ code: payload.code });
    phone = result && result.phone_info && result.phone_info.phoneNumber;
  } catch (error) {
    console.error('微信手机号换取失败', error);
    throw new AppError('PHONE_EXCHANGE_FAILED', '手机号授权暂时失败，请稍后重试');
  }
  assert(phone, 'PHONE_EXCHANGE_FAILED', '没有从微信获取到手机号');
  const cipher = encryptPhone(phone);
  const masked = maskPhone(phone);
  const user = await ensureUser(context.openid, context);
  const updated = { ...user, phoneCipher: cipher, phoneMasked: masked, updatedAt: Date.now() };
  await db.collection(COLLECTIONS.users).doc(context.openid).set({ data: updated });
  return safeUser(updated, await getPointsAccount(context.openid));
}

async function getProfile() {
  const context = requireOpenId();
  const user = await ensureUser(context.openid, context);
  const staff = await requireStaffIfAny(context.openid);
  const points = await getPointsAccount(context.openid);
  const technician = staff && staff.role === 'TECHNICIAN' ? await getOptional(COLLECTIONS.technicians, staff.technicianId) : null;
  const activeStaff = staff && (staff.role !== 'TECHNICIAN' || technician && technician.enabled !== false);
  return safeUser({ ...user, role: activeStaff ? staff.role : 'CUSTOMER' }, points);
}

async function requireStaffIfAny(openid) {
  const records = await find(COLLECTIONS.staff, { openid, active: true }, { limit: 1 });
  return records[0] || null;
}

async function listPoints() {
  const { openid } = requireOpenId();
  const account = await getPointsAccount(openid);
  const ledger = await find(COLLECTIONS.pointsLedger, { userId: openid }, { orderBy: { field: 'createdAt', direction: 'desc' }, limit: 100 });
  return { account: { available: Number(account.available || 0), frozen: Number(account.frozen || 0), debt: Number(account.debt || 0) }, ledger: ledger.map((item) => ({ id: item.id || item._id, type: item.type, amount: item.amount, description: item.description || '', createdAt: item.createdAt })) };
}

async function cancelOrder(orderIdValue) {
  const { openid } = requireOpenId();
  const result = await db.runTransaction(async (transaction) => {
    const order = await getOwnedOrder(orderIdValue, openid, transaction);
    assert([ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.RESERVED].includes(order.status), 'ORDER_NOT_CANCELLABLE', '当前订单状态不支持取消');
    const payment = await getOptional(COLLECTIONS.payments, `pay_${order.id}`, transaction);
    const paymentStatus = payment ? payment.status : PAYMENT_STATUS.NOT_STARTED;
    assert(paymentStatus !== PAYMENT_STATUS.UNKNOWN, 'PAYMENT_CHECK_REQUIRED', '支付结果待确认，请先查询支付状态');
    const paid = paymentStatus === PAYMENT_STATUS.SUCCESS;
    const nextStatus = order.status === ORDER_STATUS.PENDING_PAYMENT ? ORDER_STATUS.CANCELLED_BY_USER : ORDER_STATUS.CANCELLED_BY_USER;
    const nextOrder = { ...order, status: nextStatus, refundStatus: paid ? REFUND_STATUS.PROCESSING : REFUND_STATUS.NOT_REQUIRED, cancelledAt: Date.now(), updatedAt: Date.now() };
    if (Number(order.pointsFrozen || 0) > 0) {
      const account = await getPointsAccount(openid, transaction);
      const frozen = Math.max(0, Number(account.frozen || 0) - Number(order.pointsFrozen));
      const available = Number(account.available || 0) + Number(order.pointsFrozen);
      await transaction.collection(COLLECTIONS.pointsAccounts).doc(openid).set({ data: { ...account, available, frozen, version: Number(account.version || 0) + 1, updatedAt: Date.now() } });
      await addLedger(transaction, `unfreeze_${order.id}`, { userId: openid, orderId: order.id, type: 'UNFREEZE', amount: Number(order.pointsFrozen), balanceAfter: available, description: '取消未支付订单，解冻积分' });
      nextOrder.pointsFrozen = 0;
    }
    if (paid) {
      const refundId = `rf_${order.id}`;
      const refund = { _id: refundId, id: refundId, orderId: order.id, userId: openid, refundNo: refundId, amountFen: order.paidFen, status: REFUND_STATUS.PROCESSING, reason: '用户取消预约', retryCount: 0, createdAt: Date.now(), updatedAt: Date.now() };
      await transaction.collection(COLLECTIONS.refunds).doc(refundId).set({ data: refund });
      nextOrder.refundId = refundId;
    }
    await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: nextOrder });
    await updateDayOccupancy(transaction, order, nextStatus);
    return { order: { ...nextOrder }, paid };
  });
  if (result.paid) {
    try {
      const { requestRefund } = require('./payment-service');
      await requestRefund(orderIdValue, '用户取消预约');
    } catch (error) {
      console.error('取消订单后的退款提交失败，将由补偿任务重试', { orderId: orderIdValue, code: error.code || '', message: error.message });
      const retryId = `job_refund_retry_${orderIdValue}`;
      await db.collection(COLLECTIONS.jobs).doc(retryId).set({ data: { _id: retryId, id: retryId, type: 'REFUND_RETRY', businessId: `rf_${orderIdValue}`, status: 'PENDING', nextRunAt: addMinutes(Date.now(), 2), retryCount: 0, createdAt: Date.now(), updatedAt: Date.now() } });
    }
  }
  return { order: publicOrder(await getOptional(COLLECTIONS.orders, orderIdValue)), refundRequested: result.paid };
}

async function markPaymentSuccess(orderIdValue, paymentPayload = {}) {
  const result = await db.runTransaction(async (transaction) => {
    const order = await getOptional(COLLECTIONS.orders, orderIdValue, transaction);
    assert(order, 'ORDER_NOT_FOUND', '订单不存在', 404);
    const payment = await getOptional(COLLECTIONS.payments, `pay_${orderIdValue}`, transaction);
    assert(payment, 'PAYMENT_NOT_FOUND', '支付记录不存在', 404);
    assert(paymentPayload.amountFen !== undefined || paymentPayload.amount !== undefined, 'PAYMENT_AMOUNT_MISSING', '支付回调缺少金额');
    const receivedFen = Number(paymentPayload.amountFen !== undefined ? paymentPayload.amountFen : paymentPayload.amount);
    assert(receivedFen === Number(order.paidFen), 'PAYMENT_AMOUNT_MISMATCH', '支付金额校验失败');
    if (payment.status === PAYMENT_STATUS.SUCCESS && order.paymentStatus === PAYMENT_STATUS.SUCCESS) return { order, duplicate: true, shouldRefund: false };
    const now = Date.now();
    const successPayment = { ...payment, status: PAYMENT_STATUS.SUCCESS, transactionId: paymentPayload.transactionId || paymentPayload.transaction_id || payment.transactionId || '', paidAt: paymentPayload.paidAt || now, updatedAt: now };
    await transaction.collection(COLLECTIONS.payments).doc(payment._id || payment.id).set({ data: successPayment });
    if ([ORDER_STATUS.PENDING_PAYMENT].includes(order.status)) {
      const nextOrder = { ...order, status: ORDER_STATUS.RESERVED, paymentStatus: PAYMENT_STATUS.SUCCESS, paidAt: successPayment.paidAt, pointsFrozen: 0, pointsConsumed: Number(order.pointsUsed || 0), updatedAt: now };
      await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: nextOrder });
      await updateDayOccupancy(transaction, order, ORDER_STATUS.RESERVED);
      if (Number(order.pointsFrozen || 0) > 0) {
        const account = await getPointsAccount(order.userId, transaction);
        const frozen = Math.max(0, Number(account.frozen || 0) - Number(order.pointsFrozen));
        await transaction.collection(COLLECTIONS.pointsAccounts).doc(order.userId).set({ data: { ...account, frozen, version: Number(account.version || 0) + 1, updatedAt: now } });
        await addLedger(transaction, `consume_${order.id}`, { userId: order.userId, orderId: order.id, type: 'CONSUME', amount: -Number(order.pointsFrozen), balanceAfter: Number(account.available || 0), description: '预约支付确认，消耗积分' });
      }
      const noShowJobId = `job_no_show_${order.id}`;
      const noShowAt = addMinutes(order.startAt, Number(order.bookingRuleSnapshot && order.bookingRuleSnapshot.noShowGraceMinutes || 30));
      await transaction.collection(COLLECTIONS.jobs).doc(noShowJobId).set({ data: { _id: noShowJobId, id: noShowJobId, type: 'NO_SHOW', businessId: order.id, status: 'PENDING', nextRunAt: noShowAt, retryCount: 0, createdAt: now, updatedAt: now } });
      return { order: nextOrder, duplicate: false, shouldRefund: false };
    }
    const shouldRefund = [ORDER_STATUS.CANCELLED, ORDER_STATUS.CANCELLED_BY_USER, ORDER_STATUS.CANCELLED_NO_SHOW].includes(order.status);
    const nextOrder = shouldRefund
      ? { ...order, paymentStatus: PAYMENT_STATUS.SUCCESS, paidAt: order.paidAt || paymentPayload.paidAt || Date.now(), updatedAt: now }
      : order;
    if (shouldRefund) await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: nextOrder });
    return { order: nextOrder, duplicate: false, shouldRefund };
  });
  return { order: publicOrder(result.order), duplicate: result.duplicate, shouldRefund: result.shouldRefund };
}

async function markPaymentClosed(orderIdValue) {
  const result = await db.runTransaction(async (transaction) => {
    const order = await getOptional(COLLECTIONS.orders, orderIdValue, transaction);
    if (!order || order.status !== ORDER_STATUS.PENDING_PAYMENT) return order;
    const payment = await getOptional(COLLECTIONS.payments, `pay_${orderIdValue}`, transaction);
    if (payment) await transaction.collection(COLLECTIONS.payments).doc(payment._id || payment.id).set({ data: { ...payment, status: PAYMENT_STATUS.CLOSED, updatedAt: Date.now() } });
    const next = { ...order, status: ORDER_STATUS.CANCELLED, paymentStatus: PAYMENT_STATUS.CLOSED, pointsFrozen: 0, updatedAt: Date.now() };
    await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: next });
    await updateDayOccupancy(transaction, order, next.status);
    if (Number(order.pointsFrozen || 0) > 0) {
      const account = await getPointsAccount(order.userId, transaction);
      const available = Number(account.available || 0) + Number(order.pointsFrozen);
      await transaction.collection(COLLECTIONS.pointsAccounts).doc(order.userId).set({ data: { ...account, available, frozen: Math.max(0, Number(account.frozen || 0) - Number(order.pointsFrozen)), version: Number(account.version || 0) + 1, updatedAt: Date.now() } });
      await addLedger(transaction, `unfreeze_${order.id}`, { userId: order.userId, orderId: order.id, type: 'UNFREEZE', amount: Number(order.pointsFrozen), balanceAfter: available, description: '支付超时，解冻积分' });
    }
    return next;
  });
  return publicOrder(result);
}

async function markNoShow(orderIdValue) {
  const result = await db.runTransaction(async (transaction) => {
    const order = await getOptional(COLLECTIONS.orders, orderIdValue, transaction);
    if (!order || order.status !== ORDER_STATUS.RESERVED) return { order, changed: false };
    const grace = Number(order.bookingRuleSnapshot && order.bookingRuleSnapshot.noShowGraceMinutes || 30);
    assert(Date.now() >= addMinutes(order.startAt, grace), 'NO_SHOW_TOO_EARLY', '尚未达到未到店处理时间');
    const now = Date.now();
    const refundId = `rf_${order.id}`;
    const next = { ...order, status: ORDER_STATUS.CANCELLED_NO_SHOW, refundId, refundStatus: REFUND_STATUS.PROCESSING, updatedAt: now };
    await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: next });
    await updateDayOccupancy(transaction, order, next.status);
    const existing = await getOptional(COLLECTIONS.refunds, refundId, transaction);
    if (!existing) await transaction.collection(COLLECTIONS.refunds).doc(refundId).set({ data: { _id: refundId, id: refundId, orderId: order.id, userId: order.userId, refundNo: refundId, amountFen: order.paidFen, status: REFUND_STATUS.PROCESSING, reason: '预约开始后未核销', retryCount: 0, createdAt: now, updatedAt: now } });
    return { order: next, changed: true };
  });
  if (result.changed) {
    try {
      const { requestRefund } = require('./payment-service');
      await requestRefund(orderIdValue, '预约开始后未核销');
    } catch (error) {
      console.error('未到店退款提交失败，等待退款补偿', { orderId: orderIdValue, message: error.message });
    }
  }
  return result.order ? publicOrder(await getOptional(COLLECTIONS.orders, orderIdValue)) : null;
}

async function markRefundSuccess(refundId, payload = {}) {
  const result = await db.runTransaction(async (transaction) => {
    const refund = await getOptional(COLLECTIONS.refunds, refundId, transaction);
    assert(refund, 'REFUND_NOT_FOUND', '退款记录不存在', 404);
    const order = await getOptional(COLLECTIONS.orders, refund.orderId, transaction);
    assert(order, 'ORDER_NOT_FOUND', '退款对应订单不存在', 404);
    if (refund.status === REFUND_STATUS.SUCCESS && order.refundStatus === REFUND_STATUS.SUCCESS) return { order, duplicate: true };
    const now = Date.now();
    const nextRefund = { ...refund, status: REFUND_STATUS.SUCCESS, providerRefundId: payload.refundId || refund.providerRefundId || '', successAt: payload.successAt || now, updatedAt: now };
    const nextOrder = { ...order, refundStatus: REFUND_STATUS.SUCCESS, updatedAt: now };
    await transaction.collection(COLLECTIONS.refunds).doc(refund._id || refund.id).set({ data: nextRefund });
    const pointsConsumed = Number(order.pointsConsumed || 0);
    const pointsEarned = Number(order.pointsEarned || 0);
    const shouldReturnPoints = pointsConsumed > 0 && !order.pointsReturnedAt;
    const shouldReverseEarned = pointsEarned > 0 && !order.pointsReversedAt;
    if (shouldReturnPoints || shouldReverseEarned) {
      const account = await getPointsAccount(order.userId, transaction);
      const returnedBalance = rebalancePoints({ availablePoints: account.available || 0, debtPoints: account.debt || 0, returnedPoints: shouldReturnPoints ? pointsConsumed : 0 });
      const finalBalance = rebalancePoints({ availablePoints: returnedBalance.available, debtPoints: returnedBalance.debt, earnedPoints: shouldReverseEarned ? pointsEarned : 0 });
      await transaction.collection(COLLECTIONS.pointsAccounts).doc(order.userId).set({ data: { ...account, available: finalBalance.available, debt: finalBalance.debt, version: Number(account.version || 0) + 1, updatedAt: now } });
      if (shouldReturnPoints) {
        await addLedger(transaction, `refund_points_${order.id}`, { userId: order.userId, orderId: order.id, type: 'REFUND', amount: pointsConsumed, balanceAfter: returnedBalance.available, debtAfter: returnedBalance.debt, description: '整单退款成功，退还抵扣积分' });
        nextOrder.pointsReturnedAt = now;
      }
      if (shouldReverseEarned) {
        await addLedger(transaction, `reverse_earned_${order.id}`, { userId: order.userId, orderId: order.id, type: 'REVERSE_EARN', amount: -pointsEarned, balanceAfter: finalBalance.available, debtAfter: finalBalance.debt, description: '整单退款成功，冲回完成奖励积分' });
        nextOrder.pointsReversedAt = now;
      }
    }
    await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: nextOrder });
    return { order: nextOrder, duplicate: false };
  });
  return { order: publicOrder(result.order), duplicate: result.duplicate };
}

async function transitionStaff(orderIdValue, action) {
  const { context, account } = await requireRole(['OWNER', 'STAFF', 'TECHNICIAN']);
  const allowed = { checkIn: [ORDER_STATUS.RESERVED, ORDER_STATUS.ARRIVED], start: [ORDER_STATUS.ARRIVED], complete: [ORDER_STATUS.IN_SERVICE] };
  assert(allowed[action], 'INVALID_TRANSITION', '不支持的工作台操作');
  const targetStatus = { checkIn: ORDER_STATUS.ARRIVED, start: ORDER_STATUS.IN_SERVICE, complete: ORDER_STATUS.COMPLETED }[action];
  const result = await db.runTransaction(async (transaction) => {
    const order = await getOptional(COLLECTIONS.orders, orderIdValue, transaction);
    assert(order, 'ORDER_NOT_FOUND', '订单不存在', 404);
    if (account.role === 'TECHNICIAN') assert(order.technicianId === account.technicianId, 'FORBIDDEN', '技师只能操作自己的预约', 403);
    assert(allowed[action].includes(order.status), 'INVALID_TRANSITION', '订单当前状态不允许此操作');
    const now = Date.now();
    const next = { ...order, status: targetStatus, updatedAt: now };
    if (targetStatus === ORDER_STATUS.ARRIVED) next.arrivedAt = now;
    if (targetStatus === ORDER_STATUS.IN_SERVICE) next.serviceStartedAt = now;
    if (targetStatus === ORDER_STATUS.COMPLETED) next.completedAt = now;
    await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: next });
    await updateDayOccupancy(transaction, order, targetStatus);
    if (targetStatus === ORDER_STATUS.COMPLETED && !order.pointsEarned) {
      const points = earnPoints(order.paidFen, order.pointRuleSnapshot && order.pointRuleSnapshot.pointRateFen || 100);
      const accountData = await getPointsAccount(order.userId, transaction);
      const balance = awardPoints({ availablePoints: accountData.available || 0, debtPoints: accountData.debt || 0, earnedPoints: points });
      await transaction.collection(COLLECTIONS.pointsAccounts).doc(order.userId).set({ data: { ...accountData, available: balance.available, debt: balance.debt, version: Number(accountData.version || 0) + 1, updatedAt: now } });
      await addLedger(transaction, `earn_${order.id}`, { userId: order.userId, orderId: order.id, type: 'EARN', amount: points, balanceAfter: balance.available, debtAfter: balance.debt, description: '服务完成奖励积分' });
      next.pointsEarned = points;
      await transaction.collection(COLLECTIONS.orders).doc(order.id).set({ data: next });
    }
    return next;
  });
  return publicOrder(result);
}

async function staffListOrders(status = '') {
  const { account } = await requireRole(['OWNER', 'STAFF', 'TECHNICIAN']);
  const where = status ? { status } : {};
  let orders = await find(COLLECTIONS.orders, where, { orderBy: { field: 'startAt', direction: 'asc' }, limit: 100 });
  if (account.role === 'TECHNICIAN') orders = orders.filter((item) => item.technicianId === account.technicianId);
  return { orders: orders.map(publicOrder) };
}

async function preparePaymentRecord(orderIdValue) {
  const { openid } = requireOpenId();
  const order = await getOwnedOrder(orderIdValue, openid);
  assert(order.status === ORDER_STATUS.PENDING_PAYMENT, 'ORDER_NOT_PAYABLE', '当前订单不需要支付');
  const payment = await getOptional(COLLECTIONS.payments, `pay_${order.id}`);
  assert(payment, 'PAYMENT_NOT_FOUND', '支付记录不存在', 404);
  return { order, payment };
}

module.exports = {
  getAvailableSlots,
  createQuote,
  createOrder,
  listOrders,
  getOrder,
  bindPhone,
  getProfile,
  listPoints,
  cancelOrder,
  markPaymentSuccess,
  markPaymentClosed,
  markNoShow,
  markRefundSuccess,
  transitionStaff,
  staffListOrders,
  preparePaymentRecord,
  publicOrder,
  getCurrentSettings,
  listServices,
  listWorks,
  listCategories,
  listTechnicians,
  getService,
  getWork,
  getDayPlan,
  getSlotFromPlan,
  dayId,
  COLLECTIONS,
  ORDER_STATUS,
  REFUND_STATUS,
  PAYMENT_STATUS
};
