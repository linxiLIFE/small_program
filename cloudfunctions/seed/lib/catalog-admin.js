const crypto = require('crypto');
const { bookingCounts, byPopularity } = require('./analytics');
const { COLLECTIONS } = require('./constants');
const { db, find, findAll, getOptional } = require('./db');
const { requireRole } = require('./auth');
const { assert } = require('./errors');
const { integer } = require('./money');
const { publicCategory, publicService, publicWork, publicTechnician } = require('./catalog');
const loadAll = findAll || find;
const MAX_SERVICE_PRICE_FEN = 10_000_000;
function sortable(payload) {
  if (payload.sort === undefined || payload.sort === null || payload.sort === '') return {};
  const sort = Number(payload.sort);
  assert(Number.isSafeInteger(sort) && sort >= -1000000 && sort <= 1000000, 'INVALID_SORT', '排序值不正确');
  return { sort };
}
const idOf = (payload, prefix) => {
  const id = payload.id || `${prefix}-${crypto.randomUUID()}`;
  assert(/^[a-zA-Z0-9_-]{1,100}$/.test(id), 'INVALID_ID', '记录编号不正确'); return id;
};
const nameOf = (name, label) => { const text = String(name || '').trim(); assert(text && text.length <= 80, 'INVALID_NAME', `请填写${label}，最多 80 字`); return text; };
function imageOf(payload, field, optional = false) {
  const value = String(payload[field.replace('Url','FileID')] || payload[field] || '');
  assert(optional && !value || /^https:\/\//.test(value) || /^cloud:\/\//.test(value), 'INVALID_IMAGE', '请先上传图片'); return value;
}
async function persist(table, id, data, account) {
  return db.runTransaction(async transaction => {
  const existing = await getOptional(table, id, transaction);
  const now = Date.now();
  const record = { ...(existing || {}), ...data, _id: id, id, createdAt: existing && existing.createdAt || now, updatedAt: now, version: Number(existing && existing.version || 0) + 1 };
  await transaction.collection(table).doc(id).set({ data: record });
  const auditId = `audit-${crypto.randomUUID()}`;
  await transaction.collection(COLLECTIONS.auditLogs).doc(auditId).set({ data: { id: auditId, operatorId: account.uid || account.openid, operatorRole: account.role, action: 'SAVE_CATALOG', objectType: table, objectId: id, createdAt: now } });
  return record;
  });
}
async function saveCategory(payload = {}) {
  const { account } = await requireRole(['OWNER']);
  const record = await persist(COLLECTIONS.categories, idOf(payload, 'cat'), { name: nameOf(payload.name, '分类名称'), icon: ['✦','⌁','◌','♡','✿','◇'].includes(payload.icon) ? payload.icon : '✦', color: /^#[0-9a-f]{6}$/i.test(payload.color || '') ? payload.color : '#f1ded8', coverUrl: imageOf(payload, 'coverUrl', true), enabled: payload.enabled !== false, ...sortable(payload) }, account);
  return { ...publicCategory(record), enabled: record.enabled, coverUrl: record.coverUrl };
}
async function saveService(payload = {}) {
  const { account } = await requireRole(['OWNER']);
  const category = await getOptional(COLLECTIONS.categories, payload.categoryId);
  assert(category && category.enabled !== false, 'INVALID_CATEGORY', '请选择已启用的大类');
  const priceFen = integer(payload.priceFen, '价格'); const durationMinutes = integer(payload.durationMinutes, '时长');
  assert(priceFen > 0 && priceFen <= MAX_SERVICE_PRICE_FEN && durationMinutes > 0 && durationMinutes <= 720, 'INVALID_SERVICE', '价格须在 0.01 元到 10 万元之间，时长须在 1 到 720 分钟之间');
  const record = await persist(COLLECTIONS.services, idOf(payload, 'svc'), { name: nameOf(payload.name, '项目名称'), categoryId: category.id || category._id, categoryName: category.name, coverUrl: imageOf(payload, 'coverUrl', true), description: String(payload.description || '').slice(0, 1000), tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 12) : [], priceFen, durationMinutes, enabled: payload.enabled !== false, ...sortable(payload) }, account);
  return { ...publicService(record), enabled: record.enabled, sort: record.sort };
}
async function saveWork(payload = {}) {
  const { account } = await requireRole(['OWNER']);
  const service = await getOptional(COLLECTIONS.services, payload.serviceId);
  assert(service && (payload.published === false || service.enabled !== false), 'INVALID_SERVICE', '请选择已上架的小项目');
  const category = await getOptional(COLLECTIONS.categories, service.categoryId);
  assert(category && (payload.published === false || category.enabled !== false), 'INVALID_CATEGORY', '所属大类已停用');
  const record = await persist(COLLECTIONS.works, idOf(payload, 'work'), { title: nameOf(payload.title, '款式名称'), imageUrl: imageOf(payload, 'imageUrl'), serviceId: service.id || service._id, categoryId: category.id || category._id, categoryName: category.name, published: payload.published !== false, featured: payload.featured === true, ...sortable(payload) }, account);
  return { ...publicWork(record), published: record.published, sort: record.sort };
}
async function saveTechnician(payload = {}) {
  const { account } = await requireRole(['OWNER']);
  const legacySkills = [...new Set(Array.isArray(payload.skills) ? payload.skills : [])];
  let categoryIds = [...new Set(Array.isArray(payload.categoryIds) ? payload.categoryIds : [])];
  if (!categoryIds.length && legacySkills.length) {
    const services = await find(COLLECTIONS.services, {}, { limit: 2000 });
    categoryIds = [...new Set(services.filter((service) => legacySkills.includes(service.id || service._id)).map((service) => service.categoryId).filter(Boolean))];
  }
  assert(categoryIds.length || payload.enabled === false, 'INVALID_SKILLS', '请至少选择一个可接待大项');
  for (const id of categoryIds) {
    const category = await getOptional(COLLECTIONS.categories, id);
    assert(category && category.enabled !== false, 'INVALID_SKILLS', '所选大项不存在或已停用');
  }
  const technicianId = idOf(payload, 'tech');
  const existing = await getOptional(COLLECTIONS.technicians, technicianId);
  if (existing && (payload.enabled === false || (existing.categoryIds || []).some((id) => !categoryIds.includes(id)))) {
    const future = await find(COLLECTIONS.orders, { technicianId, status: db.command.in(['RESERVED','ARRIVED','IN_SERVICE','NO_SHOW_REVIEW']), startAt: db.command.gte(Date.now()) }, { limit: 201 });
    const affected = payload.enabled === false ? future : future.filter((order) => !categoryIds.includes(order.serviceSnapshot && order.serviceSnapshot.categoryId));
    assert(!affected.length, 'TECHNICIAN_HAS_FUTURE_ORDERS', '该技师仍有受影响的未来预约，请先处理订单再停用或移除能力', 409);
  }
  const record = await persist(COLLECTIONS.technicians, technicianId, { name: nameOf(payload.name, '技师姓名'), title: String(payload.title || '').slice(0,80), bio: String(payload.bio || '').slice(0,500), avatarUrl: imageOf(payload,'avatarUrl',true), categoryIds, skills: [], enabled: payload.enabled !== false, ...sortable(payload) }, account);
  return publicTechnician(record);
}
async function listCatalog() {
  await requireRole(['OWNER','STAFF']);
  const options = { orderBy: { field: 'sort', direction: 'asc' } };
  const [categories, services, works, technicians, staff] = await Promise.all([loadAll(COLLECTIONS.categories,{},options),loadAll(COLLECTIONS.services,{},options),loadAll(COLLECTIONS.works,{},options),loadAll(COLLECTIONS.technicians,{},options),loadAll(COLLECTIONS.staff,{ active:true })]);
  const counts = await bookingCounts();
  const visibleServices = services.filter(item => !item.archived);
  const visibleWorks = works.filter(item => !item.archived);
  const styleCounts = visibleWorks.reduce((result, item) => {
    if (item.published !== false && item.serviceId) result[item.serviceId] = (result[item.serviceId] || 0) + 1;
    return result;
  }, {});
  const serviceCounts = visibleServices.reduce((result, item) => {
    if (item.categoryId) result[item.categoryId] = (result[item.categoryId] || 0) + 1;
    return result;
  }, {});
  const categoryStyleCounts = visibleServices.reduce((result, item) => {
    if (item.categoryId) result[item.categoryId] = (result[item.categoryId] || 0) + Number(styleCounts[item.id || item._id] || 0);
    return result;
  }, {});
  const serviceCategoryById = new Map(services.map((service) => [service.id || service._id, service.categoryId]));
  const categoryNameById = new Map(categories.map((category) => [category.id || category._id, category.name]));
  return {
    categories: categories.filter(item => !item.archived).map(item => ({
      ...publicCategory(item),
      serviceCount: serviceCounts[item.id || item._id] || 0,
      styleCount: categoryStyleCounts[item.id || item._id] || 0,
      coverUrl: item.coverUrl || '',
      enabled: item.enabled !== false
    })),
    services: visibleServices.map(item => ({
      ...publicService(item),
      styleCount: styleCounts[item.id || item._id] || 0,
      categoryName: categories.find(c => (c.id || c._id) === item.categoryId)?.name || item.categoryName,
      enabled: item.enabled !== false,
      sort: item.sort || 0
    })),
    works: visibleWorks.map(item => ({ ...publicWork(item), bookingCount: counts[item.id || item._id] || 0, published: item.published !== false, sort: item.sort || 0 })).sort(byPopularity),
    technicians: technicians.filter(item => !item.archived).map(item => {
      const categoryIds = Array.isArray(item.categoryIds) && item.categoryIds.length
        ? item.categoryIds
        : [...new Set((item.skills || []).map((skill) => serviceCategoryById.get(skill)).filter(Boolean))];
      return { ...publicTechnician(item), categoryIds, categoryNames: categoryIds.map((id) => categoryNameById.get(id)).filter(Boolean), bound: staff.some(s => s.role === 'TECHNICIAN' && s.technicianId === (item.id || item._id)), loginName: staff.find(s => s.role === 'TECHNICIAN' && s.technicianId === (item.id || item._id))?.name || '' };
    })
  };
}
module.exports = { saveCategory, saveService, saveWork, saveTechnician, listCatalog };
