const { COLLECTIONS, DEFAULT_SETTINGS, ORDER_STATUS, ACTIVE_ORDER_STATUSES, REFUND_STATUS } = require('./constants');
const { db, find, getContext, getOptional } = require('./db');
const { AppError, assert } = require('./errors');
const { requireRole } = require('./auth');
const { getCurrentSettings, mergeSettings, publicSettings } = require('./settings');
const { publicService, publicWork, publicTechnician, listServices, listWorks } = require('./catalog');
const { publicOrder, beginAdminRefund } = require('./booking');
const { requestRefund } = require('./payment-service');
const wechat = require('./wechat-pay');
const { dateToTimestamp, formatParts, toDateString, weekday } = require('./time');
const { integer } = require('./money');

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function timeMinutes(value) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function normalizeDate(value) {
  const date = String(value || toDateString());
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), 'INVALID_DATE', '日期格式不正确');
  assert(toDateString(dateToTimestamp(date)) === date, 'INVALID_DATE', '日期不存在');
  return date;
}

function normalizeBreaks(breaks, shiftStart, shiftEnd, shiftIndex) {
  assert(breaks === undefined || Array.isArray(breaks), 'INVALID_SCHEDULE', `第 ${shiftIndex + 1} 个班次的休息时间格式不正确`);
  const result = (breaks || []).map((item, index) => {
    assert(item && TIME_PATTERN.test(String(item.start || '')) && TIME_PATTERN.test(String(item.end || '')), 'INVALID_SCHEDULE', `第 ${shiftIndex + 1} 个班次的第 ${index + 1} 个休息时间不正确`);
    const start = String(item.start);
    const end = String(item.end);
    assert(timeMinutes(start) < timeMinutes(end), 'INVALID_SCHEDULE', '休息时间的开始时间必须早于结束时间');
    assert(timeMinutes(start) >= shiftStart && timeMinutes(end) <= shiftEnd, 'INVALID_SCHEDULE', '休息时间必须位于班次范围内');
    return { start, end };
  }).sort((left, right) => timeMinutes(left.start) - timeMinutes(right.start));
  for (let index = 1; index < result.length; index += 1) {
    assert(timeMinutes(result[index - 1].end) <= timeMinutes(result[index].start), 'INVALID_SCHEDULE', '休息时间不能相互重叠');
  }
  return result;
}

function normalizeShifts(shifts) {
  assert(Array.isArray(shifts), 'INVALID_SCHEDULE', '班次格式不正确');
  assert(shifts.length <= 8, 'INVALID_SCHEDULE', '一天最多设置 8 个班次');
  const result = shifts.map((item, index) => {
    assert(item && TIME_PATTERN.test(String(item.start || '')) && TIME_PATTERN.test(String(item.end || '')), 'INVALID_SCHEDULE', `第 ${index + 1} 个班次时间不正确`);
    const start = String(item.start);
    const end = String(item.end);
    const startMinutes = timeMinutes(start);
    const endMinutes = timeMinutes(end);
    assert(startMinutes < endMinutes, 'INVALID_SCHEDULE', '班次的开始时间必须早于结束时间');
    return { start, end, breaks: normalizeBreaks(item.breaks, startMinutes, endMinutes, index) };
  }).sort((left, right) => timeMinutes(left.start) - timeMinutes(right.start));
  for (let index = 1; index < result.length; index += 1) {
    assert(timeMinutes(result[index - 1].end) <= timeMinutes(result[index].start), 'INVALID_SCHEDULE', '班次不能相互重叠');
  }
  return result;
}

function normalizeWeekly(weekly) {
  assert(Array.isArray(weekly) && weekly.length === 7, 'INVALID_SCHEDULE', '每周模板必须包含周一至周日 7 天');
  const seen = new Set();
  const result = weekly.map((item) => {
    const day = Number(item && item.weekday);
    assert(Number.isInteger(day) && day >= 1 && day <= 7 && !seen.has(day), 'INVALID_SCHEDULE', '每周模板的星期设置不正确');
    seen.add(day);
    return { weekday: day, enabled: item.enabled !== false, shifts: normalizeShifts(item.shifts || []) };
  }).sort((left, right) => left.weekday - right.weekday);
  return result;
}

function weeklyPlan(settings, date) {
  const entry = (settings.schedule && Array.isArray(settings.schedule.weekly) ? settings.schedule.weekly : []).find((item) => Number(item.weekday) === weekday(date));
  return { leave: !entry || entry.enabled === false, shifts: normalizeShifts(entry && entry.shifts || []) };
}

function activeOccupancy(item) {
  return item && (!item.status || ACTIVE_ORDER_STATUSES.includes(item.status));
}

function minutesOfTimestamp(timestamp) {
  const parts = formatParts(timestamp);
  return parts.hour * 60 + parts.minute;
}

function overlapsMinutes(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function planCoversInterval(plan, startAt, endAt) {
  if (plan.leave) return false;
  const startMinutes = minutesOfTimestamp(startAt);
  const endMinutes = minutesOfTimestamp(endAt);
  return plan.shifts.some((shift) => {
    const shiftStart = timeMinutes(shift.start);
    const shiftEnd = timeMinutes(shift.end);
    if (startMinutes < shiftStart || endMinutes > shiftEnd) return false;
    return !(shift.breaks || []).some((item) => overlapsMinutes(startMinutes, endMinutes, timeMinutes(item.start), timeMinutes(item.end)));
  });
}

function publicIntervals(occupancies, orders = []) {
  const seen = new Set();
  return [...(occupancies || []), ...orders].filter(activeOccupancy).map((item) => ({
    startAt: Number(item.startAt || 0),
    endAt: Number(item.endAt || 0),
    status: item.status || 'RESERVED'
  })).filter((item) => {
    const key = `${item.startAt}:${item.endAt}`;
    if (!item.startAt || !item.endAt || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.startAt - right.startAt);
}

function publicDayPlan(record, source, orders = []) {
  const intervals = publicIntervals(record.occupancies, orders);
  return {
    id: record.id || record._id,
    technicianId: record.technicianId,
    date: record.date,
    weekday: Number(record.weekday || weekday(record.date)),
    leave: !!record.leave,
    shifts: normalizeShifts(record.shifts || []),
    source,
    version: Number(record.version || 1),
    occupancyCount: intervals.length,
    occupiedIntervals: intervals
  };
}

async function audit(account, action, objectType, objectId, summary, reason, reader = db) {
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await reader.collection(COLLECTIONS.auditLogs).doc(id).set({ data: { _id: id, id, operatorId: account.uid || account.openid || account.id || '', operatorRole: account.role, action, objectType, objectId, summary, reason: reason || '', requestId: '', createdAt: Date.now() } });
}

async function summary(payload = {}) {
  await requireRole(['OWNER', 'STAFF']);
  const days = Number(payload.days || 30);
  assert([7,30,90].includes(days), 'INVALID_RANGE', '请选择 7、30 或 90 天');
  const [orders,refunds] = await Promise.all([find(COLLECTIONS.orders,{}),find(COLLECTIONS.refunds,{})]);
  return require('./analytics').analyze(orders,refunds,days);
}

async function bootstrapStatus() {
  const context = getContext();
  assert(context.uid || context.openid, 'UNAUTHENTICATED', '请先登录管理账号', 401);
  const accounts = await find(COLLECTIONS.staff, { active: true }, { limit: 1 });
  return { available: accounts.length === 0 };
}

async function bootstrapOwner() {
  const context = getContext();
  assert(context.uid || context.openid, 'UNAUTHENTICATED', '请先登录管理账号', 401);
  const account = await db.runTransaction(async (transaction) => {
    const existing = await find(COLLECTIONS.staff, { active: true }, { limit: 1 }, transaction);
    assert(!existing.length, 'BOOTSTRAP_ALREADY_COMPLETE', '首个店主账号已经配置完成', 409);
    const now = Date.now();
    const record = { _id: 'staff_owner', id: 'staff_owner', uid: context.uid || '', openid: context.openid || '', role: 'OWNER', active: true, name: '店主', createdAt: now, updatedAt: now };
    await transaction.collection(COLLECTIONS.staff).doc(record.id).set({ data: record });
    return record;
  });
  return { id: account.id, role: account.role };
}

async function listOrdersForAdmin(payload = {}) {
  const { account } = await requireRole(['OWNER', 'STAFF']);
  const where = { ...(payload.status ? { status: payload.status } : {}), ...(payload.date ? { date: payload.date } : {}) };
  const orders = await find(COLLECTIONS.orders, where, { orderBy: { field: 'createdAt', direction: 'desc' }, limit: Math.min(Number(payload.limit || 100), 200) });
  return { orders: orders.map(publicOrder), canRefund: account.role === 'OWNER' };
}

async function listAllTechnicians() {
  const [records, services] = await Promise.all([
    find(COLLECTIONS.technicians, {}, { orderBy: { field: 'sort', direction: 'asc' }, limit: 200 }),
    find(COLLECTIONS.services, {}, { limit: 2000 })
  ]);
  const serviceCategoryById = new Map(services.map((service) => [service.id || service._id, service.categoryId]));
  return records.filter(item => !item.archived).map((item) => {
    const categoryIds = Array.isArray(item.categoryIds) && item.categoryIds.length
      ? item.categoryIds
      : [...new Set((item.skills || []).map((skill) => serviceCategoryById.get(skill)).filter(Boolean))];
    return { ...publicTechnician(item), categoryIds, enabled: item.enabled !== false, sort: Number(item.sort || 0) };
  });
}

async function getAdminDayPlan(technicianId, date, settings, reader = db) {
  const id = `${technicianId}_${date}`;
  const override = await getOptional(COLLECTIONS.technicianDays, id, reader);
  if (override) return { record: { ...override, id, technicianId, date, weekday: Number(override.weekday || weekday(date)), leave: !!override.leave, shifts: normalizeShifts(override.shifts || []), occupancies: Array.isArray(override.occupancies) ? override.occupancies : [] }, source: 'override' };
  const fallback = weeklyPlan(settings, date);
  return { record: { id, technicianId, date, weekday: weekday(date), leave: fallback.leave, shifts: fallback.shifts, occupancies: [], version: 1 }, source: 'weekly' };
}

async function schedule(payload = {}) {
  await requireRole(['OWNER', 'STAFF']);
  const settings = await getCurrentSettings();
  const date = normalizeDate(payload.date);
  const technicians = await listAllTechnicians();
  const plans = await Promise.all(technicians.map(async (technician) => {
    const { record, source } = await getAdminDayPlan(technician.id, date, settings);
    const orders = await find(COLLECTIONS.orders, { technicianId: technician.id, date }, { limit: 200 });
    return { ...technician, plan: publicDayPlan(record, source, orders) };
  }));
  return { date, weekly: normalizeWeekly(settings.schedule && settings.schedule.weekly || DEFAULT_SETTINGS.schedule.weekly), technicians: plans };
}

async function assertNoScheduleConflict(transaction, technicianId, date, plan, existing) {
  const activeOrders = (await find(COLLECTIONS.orders, { technicianId, date }, { limit: 200 }, transaction)).filter(activeOccupancy);
  const intervals = publicIntervals(existing && existing.occupancies, activeOrders);
  const conflict = intervals.find((item) => !planCoversInterval(plan, item.startAt, item.endAt));
  assert(!conflict, 'SCHEDULE_CONFLICT', '新的排班会覆盖已有预约，请先处理受影响的订单', 409, { occupancyCount: intervals.length });
}

async function saveScheduleDay(payload = {}) {
  const { account } = await requireRole(['OWNER', 'TECHNICIAN']);
  if (account.role === 'TECHNICIAN') assert(payload.technicianId === account.technicianId, 'FORBIDDEN', '只能修改自己的排班', 403);
  assert(payload && payload.technicianId, 'INVALID_SCHEDULE', '缺少技师 ID');
  const technicianId = String(payload.technicianId);
  const technician = await getOptional(COLLECTIONS.technicians, technicianId);
  assert(technician, 'TECHNICIAN_NOT_FOUND', '技师不存在', 404);
  const date = normalizeDate(payload.date);
  if (account.role === 'TECHNICIAN') assert(date >= toDateString(), 'INVALID_DATE', '不能修改过去的排班');
  const leave = payload.leave === true;
  const shifts = normalizeShifts(payload.shifts || []);
  assert(leave || shifts.length > 0, 'INVALID_SCHEDULE', '工作日至少需要一个班次，休息日请勾选休息');
  const expectedVersion = payload.version === undefined || payload.version === null || payload.version === '' ? null : Number(payload.version);
  assert(expectedVersion === null || Number.isInteger(expectedVersion), 'INVALID_SCHEDULE', '排班版本号不正确');
  const id = `${technicianId}_${date}`;
  let saved;
  await db.runTransaction(async (transaction) => {
    const existing = await getOptional(COLLECTIONS.technicianDays, id, transaction);
    const currentVersion = existing ? Number(existing.version || 1) : 1;
    if (expectedVersion !== null) assert(expectedVersion === currentVersion, 'SCHEDULE_VERSION_CONFLICT', '排班已经被其他管理员更新，请刷新后重试', 409);
    const plan = { leave, shifts };
    await assertNoScheduleConflict(transaction, technicianId, date, plan, existing);
    const now = Date.now();
    saved = { ...(existing || {}), _id: id, id, technicianId, date, weekday: weekday(date), leave, shifts, occupancies: Array.isArray(existing && existing.occupancies) ? existing.occupancies : [], version: existing ? currentVersion + 1 : 1, source: 'ADMIN_OVERRIDE', createdAt: existing && existing.createdAt || now, updatedAt: now };
    await transaction.collection(COLLECTIONS.technicianDays).doc(id).set({ data: saved });
  });
  await audit({ ...account, openid: account.openid }, 'SAVE_SCHEDULE_DAY', 'technician_days', id, { date, technicianId, leave, shiftCount: shifts.length, version: saved.version }, payload.reason);
  return publicDayPlan(saved, 'override');
}

async function assertWeeklyScheduleDoesNotBreakOrders(transaction, weekly) {
  const [orders, dayRows] = await Promise.all([
    find(COLLECTIONS.orders, {}, { limit: 2000 }, transaction),
    find(COLLECTIONS.technicianDays, {}, { limit: 2000 }, transaction)
  ]);
  const overrides = new Map(dayRows.map((item) => [`${item.technicianId}_${item.date}`, item]));
  for (const order of orders.filter(activeOccupancy)) {
    if (overrides.has(`${order.technicianId}_${order.date}`)) continue;
    const entry = weekly.find((item) => item.weekday === weekday(order.date));
    const plan = { leave: !entry || entry.enabled === false, shifts: entry ? entry.shifts : [] };
    if (!planCoversInterval(plan, order.startAt, order.endAt)) {
      throw new AppError('SCHEDULE_CONFLICT', '新的每周模板会覆盖已有预约，请先处理受影响的订单', 409, { technicianId: order.technicianId, date: order.date });
    }
  }
}

async function saveWeeklySchedule(payload = {}) {
  const { account } = await requireRole(['OWNER']);
  const weekly = normalizeWeekly(payload.weekly);
  return db.runTransaction(async (transaction) => {
    const versions=await find(COLLECTIONS.settings,{published:true},{orderBy:{field:'version',direction:'desc'},limit:1},transaction);
    const previous=mergeSettings(DEFAULT_SETTINGS,versions[0]);
    const version=Number(previous.version||0)+1;const now=Date.now();
    const record={...mergeSettings(previous,{schedule:{weekly}}),_id:`v${version}`,id:`v${version}`,version,published:true,createdAt:now,createdBy:account.uid||account.openid};
    await assertWeeklyScheduleDoesNotBreakOrders(transaction,weekly);
    await transaction.collection(COLLECTIONS.settings).doc(record.id).set({data:record});
    await transaction.collection(COLLECTIONS.scheduleTemplates).doc(record.id).set({data:{id:record.id,weekly,version,published:true,createdAt:now,createdBy:record.createdBy}});
    await audit(account,'PUBLISH_SCHEDULE_TEMPLATE','schedule_templates',record.id,{previousVersion:previous.version,version},payload.reason,transaction);
    return {version,weekly};
  });
}

async function saveSettings(payload = {}) {
  const { account } = await requireRole(['OWNER']);
  const record = await db.runTransaction(async transaction => {
    const versions = await find(COLLECTIONS.settings, {published:true}, {orderBy:{field:'version',direction:'desc'},limit:1}, transaction);
    const previous = mergeSettings(DEFAULT_SETTINGS,versions[0]);
    assert(!payload.version || Number(payload.version)===Number(previous.version), 'SETTINGS_CONFLICT', '设置已更新，请刷新页面后重新保存',409);
    const allowed = {};
    for(const key of ['store','home','booking','points'])if(payload[key]!==undefined)allowed[key]=payload[key];
    const next = require('./settings-validation').validateSettings(mergeSettings(previous,allowed));
    const version=Number(previous.version)+1;
    const data={...next,_id:`v${version}`,id:`v${version}`,version,published:true,createdAt:Date.now(),createdBy:account.uid||account.openid};
    await transaction.collection(COLLECTIONS.settings).doc(data.id).set({data});
    await audit(account,'PUBLISH_SETTINGS','settings_versions',data.id,{version:data.version},payload.reason,transaction);
    return data;
  });
  return publicSettings(record);
}

async function getPaymentConfigStatus() {
  await requireRole(['OWNER']);
  const missing = wechat.getConfigIssues();
  return { configured: missing.length === 0, missing, callbackCertificateConfigured: wechat.hasNotificationVerifier(), note: '仅返回配置状态，不返回任何密钥或证书内容。' };
}

async function refundOrder(payload) {
  const { account } = await requireRole(['OWNER']);
  assert(payload && payload.orderId, 'INVALID_REFUND', '缺少订单 ID');
  const reason = payload.reason || '管理员发起退款';
  const prepared = await beginAdminRefund(payload.orderId, reason);
  const result = prepared.refundRequired
    ? await requestRefund(payload.orderId, reason, { allowClosedRetry: true, manualRetry: true })
    : { id: prepared.order.refundId || '', status: prepared.order.refundStatus };
  await audit({ ...account, openid: account.openid }, 'REQUEST_REFUND', 'orders', payload.orderId, { refundId: result.id || result._id, status: result.status }, payload.reason);
  return result;
}

async function personalScheduleData(technicianId, payload = {}) {
  const technician = await getOptional(COLLECTIONS.technicians, technicianId);
  assert(technician, 'TECHNICIAN_NOT_FOUND', '技师账号已停用');
  const settings = await getCurrentSettings();
  const date = normalizeDate(payload.date);
  const first = toDateString();
  const days = await Promise.all(Array.from({length:14}, async (_, index) => {
    const day = toDateString(dateToTimestamp(first) + index * 86400000);
    const { record, source } = await getAdminDayPlan(technicianId, day, settings);
    const orders = await find(COLLECTIONS.orders, { technicianId: technicianId, date: day }, {limit:200});
    return publicDayPlan(record, source, orders);
  }));
  const {record, source} = await getAdminDayPlan(technicianId, date, settings);
  const orders = await find(COLLECTIONS.orders, { technicianId: technicianId, date }, {limit:200});
  const services = await find(COLLECTIONS.services, {}, { limit: 2000 });
  const categoryIds = Array.isArray(technician.categoryIds) && technician.categoryIds.length
    ? technician.categoryIds
    : [...new Set((technician.skills || []).map((skill) => services.find((service) => (service.id || service._id) === skill)?.categoryId).filter(Boolean))];
  return { technician: { ...publicTechnician(technician), categoryIds }, days, plan: publicDayPlan(record,source,orders), orders: orders.filter(activeOccupancy).map(publicOrder) };
}

async function mySchedule(payload = {}) {
  const {account}=await requireRole(['TECHNICIAN']);
  return personalScheduleData(account.technicianId,payload);
}
async function previewTechnicianSchedule(payload = {}) {
  await requireRole(['OWNER']);
  return personalScheduleData(payload.technicianId,payload);
}

const { saveService, saveWork, listCatalog } = require('./catalog-admin');
module.exports = { previewTechnicianSchedule, mySchedule, normalizeShifts, planCoversInterval, summary, bootstrapStatus, bootstrapOwner, listOrdersForAdmin, schedule, saveScheduleDay, saveWeeklySchedule, saveService, saveWork, saveSettings, getPaymentConfigStatus, refundOrder, listCatalog };
