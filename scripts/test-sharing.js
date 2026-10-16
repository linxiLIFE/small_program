const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const app = require('../app.json');
const cover = '/assets/share-cover.png';

function page(route, api = {}, state = {}) {
  const file = path.join(root, route + '.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; },
    require: name => name.endsWith('/api') ? { getProfile: async () => ({}), ...api } : require(path.resolve(path.dirname(file), name)),
    getApp: () => ({ globalData: state }), wx: {}, console
  });
  return { ...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } };
}
function destination(card) {
  const url = new URL(card.path, 'https://miniprogram.local');
  const route = url.pathname.slice(1);
  assert(app.pages.includes(route), `Unregistered share destination: ${route}`);
  assert(card.title && card.imageUrl, 'Share card needs a title and explicit image');
  return { route, options: Object.fromEntries(url.searchParams) };
}

(async () => {
  const sharedPages = ['pages/index/index', 'pages/services/index', 'pages/style-select/index',
    'pages/service-detail/index', 'pages/work-detail/index', 'pages/points/index'];
  for (const route of app.pages) {
    const instance = page(route);
    assert.equal(typeof instance.onShareAppMessage === 'function', sharedPages.includes(route), route);
    if (sharedPages.includes(route)) destination(instance.onShareAppMessage());
  }
  assert(fs.existsSync(path.join(root, cover)), 'Packaged share cover must exist');
  const project = require('../project.config.json');
  for (const item of project.packOptions.ignore) {
    const asset = cover.slice(1);
    assert(!(item.type === 'file' && item.value === asset)
      && !(item.type === 'folder' && asset.startsWith(item.value.replace(/\/$/, '') + '/')),
    'Share cover must not be excluded from the Mini Program package');
  }
  const home = page('pages/index/index');
  home.data.store = { storeName: '门店名称' };
  assert.equal(home.onShareAppMessage().title, '门店名称');
  assert.equal(home.onShareAppMessage().path, '/pages/index/index');

  const categoryId = 'category & one', serviceId = 'service / one', workId = 'work ? one';
  const service = { id: serviceId, name: '法式美甲', categoryId, coverUrl: 'https://example.com/service.jpg', priceFen: 3000, durationMinutes: 60 };
  const work = { id: workId, title: '奶油法式', serviceId, imageUrl: 'wxfile://cached-style.jpg' };
  const catalog = { categories: [{ id: categoryId, name: '美甲' }], services: [service], works: [work] };
  const services = page('pages/services/index');
  services.data.categories = catalog.categories; services.data.activeCategoryId = categoryId;
  const categoryShare = destination(services.onShareAppMessage());
  const state = { pendingServiceId: 'stale', catalogSelection: { categoryId: 'another', serviceId: 'another' } };
  const receivedServices = page(categoryShare.route, { listServices: async () => catalog }, state);
  receivedServices.onLoad(categoryShare.options);
  assert(!state.pendingServiceId);
  await receivedServices.onShow(); await receivedServices.loadServices();
  assert.equal(receivedServices.data.activeCategoryId, categoryId);
  assert.equal(receivedServices.data.filteredServices[0].id, serviceId);

  const styles = page('pages/style-select/index');
  styles.data.service = service;
  const styleShare = destination(styles.onShareAppMessage());
  const receivedStyles = page(styleShare.route, { listServiceStyles: async id => {
    assert.equal(id, serviceId); return { service, works: [work] };
  } });
  await receivedStyles.onLoad(styleShare.options);
  assert.equal(receivedStyles.data.works[0].id, workId);

  const serviceDetail = page('pages/service-detail/index');
  serviceDetail.data.service = service;
  const serviceShare = destination(serviceDetail.onShareAppMessage());
  assert.equal(serviceShare.options.serviceId, serviceId);
  let requestedServiceId;
  const receivedService = page(serviceShare.route, { getService: async id => { requestedServiceId = id; return service; } });
  receivedService.onLoad(serviceShare.options);
  assert.equal(requestedServiceId, serviceId);
  serviceDetail.data.coverImageError = true;
  assert.equal(serviceDetail.onShareAppMessage().imageUrl, cover);

  const detail = page('pages/work-detail/index');
  detail.data.work = work; detail.data.selectedTechnicianId = 'personal-choice';
  detail.data.service = service;
  const workCard = detail.onShareAppMessage();
  assert.equal(workCard.imageUrl, work.imageUrl);
  const workShare = destination(workCard);
  assert.equal(workShare.options.workId, workId);
  assert.equal(Object.keys(workShare.options).length, 1);
  const receivedWork = page(workShare.route, { getWorkDetail: async id => {
    assert.equal(id, workId); return { work, service, technicians: [] };
  } });
  await receivedWork.onLoad(workShare.options);
  assert.equal(receivedWork.data.work.id, workId);
  detail.data.imageError = true;
  assert.equal(detail.onShareAppMessage().imageUrl, cover);

  const points = page('pages/points/index');
  points.data.profile = { inviteCode: 'MYCODE88', id: 'private-id', points: 999 };
  points.data.inviteDraft = 'FRIEND88';
  points.data.inviteRecords = [{ nickname: 'private-name' }];
  const inviteCard = points.onShareAppMessage();
  assert.equal(inviteCard.path, '/pages/points/index?invite=MYCODE88');
  assert.equal(inviteCard.imageUrl, cover, 'Invite share must use public branding instead of a points-page screenshot');
  assert(!JSON.stringify(inviteCard).match(/private-id|private-name|FRIEND88|999/));
  const inviteShare = destination(inviteCard);
  const receivedPoints = page(inviteShare.route, { bindInviteCode: () => { throw new Error('Must not bind automatically'); } });
  receivedPoints.onLoad(inviteShare.options);
  assert.equal(receivedPoints.data.inviteDraft, 'MYCODE88');
  assert.equal(receivedPoints.data.bindingInvite, false);
  const immediateShare = page('pages/points/index', { getProfile: async () => ({ inviteCode: 'EARLY888' }) });
  immediateShare.data.inviteDraft = 'FRIEND88';
  assert.equal((await immediateShare.onShareAppMessage().promise).path, '/pages/points/index?invite=EARLY888');
  const unavailable = page('pages/points/index', { getProfile: async () => { throw new Error('offline'); } });
  assert.equal((await unavailable.onShareAppMessage().promise).path, '/pages/points/index');
  console.log('sharing passed: scoped menus, cold-entry routes, category/project/style restoration, image fallback, own invite code, async profile, prefill and public cover');
})().catch(error => { console.error(error); process.exitCode = 1; });
