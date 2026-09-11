const crypto = require('crypto');
const { bookingCounts, byPopularity } = require('./analytics');
const { COLLECTIONS } = require('./constants');
const { db, find, getOptional } = require('./db');
const { requireRole } = require('./auth');
const { assert } = require('./errors');
const { integer } = require('./money');
const { publicCategory, publicService, publicWork, publicTechnician } = require('./catalog');
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
  const record = await persist(COLLECTIONS.categories, idOf(payload, 'cat'), { name: nameOf(payload.name, '分类名称'), icon: ['✦','⌁','◌','♡','✿','◇'].includes(payload.icon) ? payload.icon : '✦', color: /^#[0-9a-f]{6}$/i.test(payload.color || '') ? payload.color : '#f1ded8', coverUrl: imageOf(payload, 'coverUrl', true), enabled: payload.enabled !== false, sort: 0 }, account);
  return { ...publicCategory(record), enabled: record.enabled, coverUrl: record.coverUrl };
}
async function saveService(payload = {}) {
  const { account } = await requireRole(['OWNER']);
  const category = await getOptional(COLLECTIONS.categories, payload.categoryId);
  assert(category && category.enabled !== false, 'INVALID_CATEGORY', '请选择已启用的大类');
  const priceFen = integer(payload.priceFen, '价格'); const durationMinutes = integer(payload.durationMinutes, '时长');
  assert(priceFen > 0 && durationMinutes > 0 && durationMinutes <= 720, 'INVALID_SERVICE', '价格必须大于零，时长须在 1 到 720 分钟之间');
  const record = await persist(COLLECTIONS.services, idOf(payload, 'svc'), { name: nameOf(payload.name, '项目名称'), categoryId: category.id || category._id, categoryName: category.name, coverUrl: imageOf(payload, 'coverUrl', true), description: String(payload.description || '').slice(0, 1000), tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 12) : [], priceFen, durationMinutes, bufferMinutes: integer(payload.bufferMinutes || 0, '缓冲时长'), sort: 0, enabled: payload.enabled !== false }, account);
  return { ...publicService(record), enabled: record.enabled, sort: record.sort };
}
async function saveWork(payload = {}) {
  const { account } = await requireRole(['OWNER']);
  const service = await getOptional(COLLECTIONS.services, payload.serviceId);
  assert(service && (payload.published === false || service.enabled !== false), 'INVALID_SERVICE', '请选择已上架的小项目');
  const category = await getOptional(COLLECTIONS.categories, service.categoryId);
  assert(category && (payload.published === false || category.enabled !== false), 'INVALID_CATEGORY', '所属大类已停用');
  const record = await persist(COLLECTIONS.works, idOf(payload, 'work'), { title: nameOf(payload.title, '款式名称'), imageUrl: imageOf(payload, 'imageUrl'), serviceId: service.id || service._id, categoryId: category.id || category._id, categoryName: category.name, published: payload.published !== false, featured: payload.featured === true, sort: 0 }, account);
  return { ...publicWork(record), published: record.published, sort: record.sort };
}
async function saveTechnician(payload = {}) {
  const { account } = await requireRole(['OWNER']);
  const skills = [...new Set(Array.isArray(payload.skills) ? payload.skills : [])];
  assert(skills.length || payload.enabled === false, 'INVALID_SKILLS', '请至少选择一个可接待项目');
  for (const id of skills) assert(await getOptional(COLLECTIONS.services, id), 'INVALID_SKILLS', '所选项目不存在');
  const record = await persist(COLLECTIONS.technicians, idOf(payload, 'tech'), { name: nameOf(payload.name, '技师姓名'), title: String(payload.title || '').slice(0,80), bio: String(payload.bio || '').slice(0,500), avatarUrl: imageOf(payload,'avatarUrl',true), skills, sort: 0, enabled: payload.enabled !== false }, account);
  return publicTechnician(record);
}
async function listCatalog() {
  await requireRole(['OWNER','STAFF']);
  const options = { orderBy: { field: 'sort', direction: 'asc' }, limit: 1000 };
  const [categories, services, works, technicians, staff] = await Promise.all([find(COLLECTIONS.categories,{},options),find(COLLECTIONS.services,{},options),find(COLLECTIONS.works,{},options),find(COLLECTIONS.technicians,{},options),find(COLLECTIONS.staff,{ active:true },{limit:1000})]);
  const counts = await bookingCounts();
  return {
    categories: categories.filter(item => !item.archived).map(item => ({ ...publicCategory(item), coverUrl: item.coverUrl || '', enabled: item.enabled !== false })),
    services: services.filter(item => !item.archived).map(item => ({ ...publicService(item), categoryName: categories.find(c => (c.id || c._id) === item.categoryId)?.name || item.categoryName, enabled: item.enabled !== false, sort: item.sort || 0 })),
    works: works.filter(item => !item.archived).map(item => ({ ...publicWork(item), bookingCount: counts[item.id || item._id] || 0, published: item.published !== false, sort: item.sort || 0 })).sort(byPopularity),
    technicians: technicians.filter(item => !item.archived).map(item => ({ ...publicTechnician(item), bound: staff.some(s => s.role === 'TECHNICIAN' && s.technicianId === (item.id || item._id)), loginName: staff.find(s => s.role === 'TECHNICIAN' && s.technicianId === (item.id || item._id))?.name || '' }))
  };
}
module.exports = { saveCategory, saveService, saveWork, saveTechnician, listCatalog };
