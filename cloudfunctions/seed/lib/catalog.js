const { COLLECTIONS } = require('./constants');
const { db, getOptional, find } = require('./db');
const { assert } = require('./errors');
const { bookingCounts, byPopularity } = require('./analytics');

function publicCategory(item) {
  return {
    id: item.id || item._id,
    name: item.name,
    coverUrl: item.coverUrl || '',
    subtitle: item.subtitle || '',
    icon: item.icon || '✦',
    color: item.color || '#f7d9d3',
    serviceCount: Number(item.serviceCount || 0),
    styleCount: Number(item.styleCount || 0),
    sort: item.sort || 0
  };
}

function publicService(item) {
  return {
    id: item.id || item._id,
    categoryId: item.categoryId,
    categoryName: item.categoryName || '',
    name: item.name,
    description: item.description || '',
    priceFen: Number(item.priceFen || 0),
    durationMinutes: Number(item.durationMinutes || 0),
    bufferMinutes: Number(item.bufferMinutes || 0),
    coverUrl: item.coverUrl || '',
    tags: item.tags || [],
    styleCount: Number(item.styleCount || 0),
    version: item.version || 1
  };
}

function publicWork(item) {
  return {
    id: item.id || item._id,
    categoryId: item.categoryId,
    categoryName: item.categoryName || '',
    title: item.title || '',
    description: item.description || '',
    imageUrl: item.imageUrl || '',
    serviceId: item.serviceId || '',
    serviceName: item.serviceName || '',
    durationMinutes: Number(item.durationMinutes || 0),
    technicianId: item.technicianId || '',
    featured: item.featured === true,
    bookingCount: Number(item.bookingCount || 0)
  };
}

function publicTechnician(item) {
  return {
    id: item.id || item._id,
    name: item.name,
    title: item.title || '',
    bio: item.bio || '',
    skills: item.skills || [],
    avatarUrl: item.avatarUrl || '',
    sort: Number(item.sort || 0),
    enabled: item.enabled !== false
  };
}

async function listCategories() {
  const records = await find(COLLECTIONS.categories, { enabled: true }, { orderBy: { field: 'sort', direction: 'asc' } });
  return records.map(publicCategory);
}

async function listServices(categoryId = '') {
  const where = categoryId ? { enabled: true, categoryId } : { enabled: true };
  const [records, categories, styles] = await Promise.all([
    find(COLLECTIONS.services, where, { orderBy: { field: 'sort', direction: 'asc' } }),
    listCategories(),
    find(COLLECTIONS.works, {}, { limit: 2000 })
  ]);
  const styleCounts = styles.reduce((result, item) => {
    const serviceId = item.serviceId || '';
    if (item.published !== false && serviceId) result[serviceId] = (result[serviceId] || 0) + 1;
    return result;
  }, {});
  return records
    .filter(item => categories.some(c => c.id === item.categoryId))
    .map(item => {
      const category = categories.find(c => c.id === item.categoryId);
      return { ...publicService(item), styleCount: styleCounts[item.id || item._id] || 0, categoryName: category.name };
    });
}

async function listWorks(categoryId = '') {
  const records = await find(COLLECTIONS.works, {}, { orderBy: { field: 'sort', direction: 'asc' } });
  const [services, counts] = await Promise.all([listServices(categoryId), bookingCounts()]);
  return records.filter(item => item.published !== false && services.some(s => s.id === item.serviceId)).map(item => {
    const service = services.find(s => s.id === item.serviceId);
    return {
      ...publicWork(item),
      bookingCount: counts[item.id || item._id] || 0,
      categoryId: service.categoryId,
      categoryName: service.categoryName,
      serviceName: service.name,
      durationMinutes: service.durationMinutes
    };
  }).sort(byPopularity);
}

async function listTechnicians(serviceId = '') {
  const records = await find(COLLECTIONS.technicians, { enabled: true }, { orderBy: { field: 'sort', direction: 'asc' } });
  if (serviceId) return records.filter((item) => (item.skills || []).includes(serviceId)).map(publicTechnician);
  return records.map(publicTechnician);
}

async function getService(serviceId) {
  assert(serviceId, 'INVALID_SERVICE', '缺少项目 ID');
  const record = await getOptional(COLLECTIONS.services, serviceId);
  assert(record && record.enabled !== false, 'SERVICE_NOT_FOUND', '项目不存在或已下架', 404);
  const category = await getOptional(COLLECTIONS.categories, record.categoryId);
  assert(category && category.enabled !== false, 'SERVICE_NOT_FOUND', '所属大类已停用', 404);
  const styles = await find(COLLECTIONS.works, { serviceId: record.id || record._id }, { limit: 2000 });
  return { ...publicService(record), styleCount: styles.filter(item => item.published !== false).length, categoryName: category.name };
}

async function getWork(workId) {
  assert(workId, 'INVALID_WORK', '缺少作品 ID');
  const record = await getOptional(COLLECTIONS.works, workId);
  assert(record && record.published !== false, 'WORK_NOT_FOUND', '作品不存在或已下架', 404);
  const service = await getService(record.serviceId);
  return {
    ...publicWork(record),
    bookingCount: (await bookingCounts())[record.id || record._id] || 0,
    categoryId: service.categoryId,
    categoryName: service.categoryName,
    serviceName: service.name,
    durationMinutes: service.durationMinutes
  };
}

async function getHome(settings) {
  const [categories, services, works, technicians] = await Promise.all([
    listCategories(), listServices(), listWorks(), listTechnicians()
  ]);
  const categorySummaries = categories.map((category) => {
    const categoryServices = services.filter((service) => service.categoryId === category.id);
    return {
      ...category,
      serviceCount: categoryServices.length,
      styleCount: categoryServices.reduce((count, service) => count + service.styleCount, 0)
    };
  });
  return {
    store: settings.store,
    banners: settings.home?.banners || [],
    categories: categorySummaries,
    services: services.slice(0, 6),
    works: works.filter(item => item.featured).sort(byPopularity),
    technicians: technicians.slice(0, 8)
  };
}

module.exports = { publicCategory, publicService, publicWork, publicTechnician, listCategories, listServices, listWorks, listTechnicians, getService, getWork, getHome };
