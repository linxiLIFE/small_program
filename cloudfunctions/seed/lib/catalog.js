const { COLLECTIONS } = require('./constants');
const { db, getOptional, find, findAll } = require('./db');
const { assert } = require('./errors');
const { bookingCounts, byPopularity } = require('./analytics');
const loadAll = findAll || find;

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
    coverUrl: item.coverUrl || '',
    tags: item.tags || [],
    styleCount: Number(item.styleCount || 0),
    version: item.version || 1
  };
}

function publicWork(item, { includeBookingCount = true } = {}) {
  const work = {
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
    featuredSort: Number(item.featuredSort || 0)
  };
  if (includeBookingCount) work.bookingCount = Number(item.bookingCount || 0);
  return work;
}

function publicTechnician(item) {
  return {
    id: item.id || item._id,
    name: item.name,
    title: item.title || '',
    bio: item.bio || '',
    categoryIds: Array.isArray(item.categoryIds) ? item.categoryIds : [],
    // 保留旧字段只用于兼容历史数据；新的管理界面只读写 categoryIds。
    skills: item.skills || [],
    avatarUrl: item.avatarUrl || '',
    sort: Number(item.sort || 0),
    enabled: item.enabled !== false
  };
}

async function listCategories() {
  const records = await find(COLLECTIONS.categories, { enabled: true }, { orderBy: { field: 'sort', direction: 'asc' } });
  return records.filter(item => !item.archived).map(publicCategory);
}

function countStyles(styles) {
  return styles.reduce((result, item) => {
    const serviceId = item.serviceId || '';
    if (!item.archived && item.published !== false && serviceId) result[serviceId] = (result[serviceId] || 0) + 1;
    return result;
  }, {});
}

async function loadCatalog(categoryId = '') {
  const where = categoryId ? { enabled: true, categoryId } : { enabled: true };
  const [serviceRecords, categoryRecords, styles] = await Promise.all([
    find(COLLECTIONS.services, where, { orderBy: { field: 'sort', direction: 'asc' } }),
    find(COLLECTIONS.categories, { enabled: true }, { orderBy: { field: 'sort', direction: 'asc' } }),
    loadAll(COLLECTIONS.works, {}, { orderBy: { field: 'sort', direction: 'asc' } })
  ]);
  const categories = categoryRecords.filter(item => !item.archived).map(publicCategory);
  const categoryById = new Map(categories.map((item) => [item.id, item]));
  const styleCounts = countStyles(styles);
  const services = serviceRecords
    .filter((item) => !item.archived && categoryById.has(item.categoryId))
    .map((item) => {
      const category = categoryById.get(item.categoryId);
      return { ...publicService(item), styleCount: styleCounts[item.id || item._id] || 0, categoryName: category.name };
    });
  return { categories, services, styles };
}

async function listServiceCatalog(categoryId = '') {
  const { categories, services } = await loadCatalog(categoryId);
  return { categories, services };
}

async function listServices(categoryId = '') {
  const { services } = await loadCatalog(categoryId);
  return services;
}

function decorateWorks(records, services, counts = {}, { includeBookingCount = true, sortByPopularity = true } = {}) {
  const serviceById = new Map(services.map((item) => [item.id, item]));
  const works = records
    .filter((item) => !item.archived && item.published !== false && serviceById.has(item.serviceId))
    .map((item) => {
      const service = serviceById.get(item.serviceId);
      return {
        ...publicWork(item, { includeBookingCount }),
        ...(includeBookingCount ? { bookingCount: counts[item.id || item._id] || 0 } : {}),
        categoryId: service.categoryId,
        categoryName: service.categoryName,
        serviceName: service.name,
        durationMinutes: service.durationMinutes
      };
    });
  return sortByPopularity ? works.sort(byPopularity) : works;
}

async function listWorks(categoryId = '') {
  const [{ services, styles }, counts] = await Promise.all([loadCatalog(categoryId), bookingCounts()]);
  return decorateWorks(styles, services, counts);
}

async function listTechnicians(serviceId = '') {
  const records = (await find(COLLECTIONS.technicians, { enabled: true }, { orderBy: { field: 'sort', direction: 'asc' } })).filter(item => !item.archived);
  if (serviceId) {
    const service = await getOptional(COLLECTIONS.services, serviceId);
    const categoryId = service && service.categoryId;
    return records.filter((item) => {
      const categoryIds = Array.isArray(item.categoryIds) ? item.categoryIds : [];
      if (categoryId && categoryIds.length) return categoryIds.includes(categoryId);
      return !categoryIds.length && (item.skills || []).includes(serviceId);
    }).map(publicTechnician);
  }
  return records.map(publicTechnician);
}

async function getService(serviceId) {
  assert(serviceId, 'INVALID_SERVICE', '缺少项目 ID');
  const record = await getOptional(COLLECTIONS.services, serviceId);
  assert(record && !record.archived && record.enabled !== false, 'SERVICE_NOT_FOUND', '项目不存在或已下架', 404);
  const [category, styles] = await Promise.all([
    getOptional(COLLECTIONS.categories, record.categoryId),
    loadAll(COLLECTIONS.works, { serviceId: record.id || record._id }, { orderBy: { field: 'sort', direction: 'asc' } })
  ]);
  assert(category && !category.archived && category.enabled !== false, 'SERVICE_NOT_FOUND', '所属大类已停用', 404);
  return { ...publicService(record), styleCount: styles.filter(item => !item.archived && item.published !== false).length, categoryName: category.name };
}

async function listServiceStyles(serviceId) {
  assert(serviceId, 'INVALID_SERVICE', '缺少项目 ID');
  const record = await getOptional(COLLECTIONS.services, serviceId);
  assert(record && !record.archived && record.enabled !== false, 'SERVICE_NOT_FOUND', '项目不存在或已下架', 404);
  const serviceKey = record.id || record._id;
  const [category, styles] = await Promise.all([
    getOptional(COLLECTIONS.categories, record.categoryId),
    loadAll(COLLECTIONS.works, { serviceId: serviceKey }, { orderBy: { field: 'sort', direction: 'asc' } })
  ]);
  assert(category && !category.archived && category.enabled !== false, 'SERVICE_NOT_FOUND', '所属大类已停用', 404);
  const service = { ...publicService(record), styleCount: styles.filter(item => !item.archived && item.published !== false).length, categoryName: category.name };
  return { service, works: decorateWorks(styles, [service], {}, { includeBookingCount: false, sortByPopularity: false }) };
}

async function getWork(workId) {
  assert(workId, 'INVALID_WORK', '缺少作品 ID');
  const record = await getOptional(COLLECTIONS.works, workId);
  assert(record && !record.archived && record.published !== false, 'WORK_NOT_FOUND', '作品不存在或已下架', 404);
  const service = await getService(record.serviceId);
  return {
    ...publicWork(record),
    categoryId: service.categoryId,
    categoryName: service.categoryName,
    serviceName: service.name,
    durationMinutes: service.durationMinutes
  };
}

async function getHome(settings) {
  const [{ categories, services, styles }, counts] = await Promise.all([loadCatalog(), bookingCounts()]);
  const works = decorateWorks(styles, services, counts);
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
    works: works.filter(item => item.featured).sort((left, right) => Number(left.featuredSort || 0) - Number(right.featuredSort || 0) || byPopularity(left, right))
  };
}

module.exports = { publicCategory, publicService, publicWork, publicTechnician, listCategories, listServiceCatalog, listServices, listServiceStyles, listWorks, listTechnicians, getService, getWork, getHome };
