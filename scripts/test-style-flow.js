const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const mock = require('../utils/mock-data');
function page(file, api, state = {}) {
  let definition; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    Page: value => { definition = value; },
    require: name => name.endsWith('/api') ? api : require(path.resolve(path.dirname(path.join(__dirname, '..', file)), name)),
    getApp: () => ({ globalData: state }),
    wx: { switchTab: value => calls.push(value), navigateTo: value => calls.push(value) }, console
  });
  const instance = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value); } };
  return { instance, calls };
}
(async () => {
  const state = { pendingServiceCategoryId: 'nail' };
  const { instance: list } = page('pages/services/index.js', { listServices: async () => mock }, state);
  list.onShow(); await list.loadServices();
  assert.equal(list.data.visibleWorks.length, 2);
  list.handleProjectTap({ currentTarget: { dataset: { id: 'svc-nail-french' } } });
  assert.equal(list.data.visibleWorks.length, 1);
  list.handleCategoryTap({ currentTarget: { dataset: { id: 'brow' } } });
  assert.equal(list.data.visibleWorks.length, 1);
  list.data.works.push({ id: 'orphan', serviceId: 'removed-service' }); list.filterWorks();
  assert.equal(list.data.visibleWorks.length, 1);
  const selected = {};
  const { instance: detail, calls } = page('pages/work-detail/index.js', {}, selected);
  detail.data = { service: { id: 'svc-nail-french' }, work: { id: 'work-001' }, technician: { id: 'tech-lin' } };
  detail.startBooking();
  assert.equal(calls[0].url, '/pages/booking/index'); assert.equal(selected.pendingBooking.workId, 'work-001');
  const { instance: booking } = page('pages/booking/index.js', {}, selected);
  let loaded = false; booking.loadBooking = () => { loaded = true; }; booking.onShow();
  assert(loaded); assert.equal(booking.workId, 'work-001'); assert.equal(booking.serviceId, 'svc-nail-french'); assert(!selected.pendingBooking);
  const { instance: empty } = page('pages/booking/index.js', {}); empty.onShow(); assert.equal(empty.data.loading, false); assert(!empty.data.service.id);
  const app = require('../app.json');
  app.tabBar.list.forEach(tab => ['iconPath', 'selectedIconPath'].forEach(key => assert(fs.existsSync(path.join(__dirname, '..', tab[key])))));
  console.log('style flow passed: categories, project filter, orphan exclusion, tab handoff, booking empty state, icons');
})().catch(error => { console.error(error); process.exitCode = 1; });
