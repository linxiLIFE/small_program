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
  assert.equal(list.data.filteredServices.length, 2);
  const { instance: listWithNavigation } = page('pages/services/index.js', { listServices: async () => mock }, { pendingServiceCategoryId: 'nail' });
  listWithNavigation.onShow(); await listWithNavigation.loadServices();
  listWithNavigation.handleProjectTap({ currentTarget: { dataset: { id: 'svc-nail-french' } } });
  assert.equal(listWithNavigation.data.filteredServices.length, 2);
  assert.equal(listWithNavigation.data.activeServiceId, 'svc-nail-french');
  list.handleCategoryTap({ currentTarget: { dataset: { id: 'brow' } } });
  assert.equal(list.data.filteredServices.length, 1);
  const styleApi = { listServiceStyles: async (serviceId) => ({
    service: mock.services.find((item) => item.id === serviceId),
    works: mock.works.filter((item) => item.serviceId === serviceId && item.published !== false)
  }) };
  const styleState = { catalogSelection: { categoryId: 'nail', serviceId: 'svc-nail-french', workId: 'work-005' } };
  const { instance: styles, calls: styleCalls } = page('pages/style-select/index.js', styleApi, styleState);
  await styles.onLoad({ categoryId: 'nail', serviceId: 'svc-nail-french', workId: 'work-005' });
  assert.equal(styles.data.works.length, 3);
  assert.equal(styles.data.activeWorkId, 'work-005');
  styles.handleWorkTap({ detail: { work: { id: 'work-001' } } });
  assert.equal(styleCalls[0].url, '/pages/work-detail/index?workId=work-001');
  assert.equal(styleState.catalogSelection.workId, 'work-001');
  const selected = {};
  const { instance: detail, calls } = page('pages/work-detail/index.js', {}, selected);
  detail.data = { service: { id: 'svc-nail-french' }, work: { id: 'work-001' }, technician: { id: 'tech-lin' } };
  detail.startBooking();
  assert.equal(calls[0].url, '/pages/booking/index'); assert.equal(selected.pendingBooking.workId, 'work-001');
  const { instance: booking } = page('pages/booking/index.js', {}, selected);
  let loaded = false; booking.loadBooking = () => { loaded = true; }; booking.onShow();
  assert(loaded); assert.equal(booking.workId, 'work-001'); assert.equal(booking.serviceId, 'svc-nail-french'); assert(!selected.pendingBooking);
  let repeated = false; booking.loadBooking = () => { repeated = true; }; booking.hasLoaded = true; booking.onShow(); assert(!repeated);
  const bookingDate = mock.getDates()[1].value;
  const bookingApi = {
    getBookingContext: async () => ({
      settings: { booking: { openDays: 14, slotStepMinutes: 30 }, points: { maxPercent: 10 } },
      service: mock.services[0],
      technicians: [mock.technicians[0]],
      profile: mock.profile,
      work: mock.works[0]
    }),
    getAvailableSlots: async () => ({
      stepMinutes: 30,
      slots: [
        { id: 'booking-10', startAt: Date.parse(`${bookingDate}T10:00:00+08:00`), available: true },
        { id: 'booking-1030', startAt: Date.parse(`${bookingDate}T10:30:00+08:00`), available: true },
        { id: 'booking-12', startAt: Date.parse(`${bookingDate}T12:00:00+08:00`), available: true }
      ]
    }),
    createQuote: async () => ({ quoteId: 'quote-test', totalFen: 29900, discountFen: 0, paidFen: 29900, pointsToUse: 0 })
  };
  const { instance: groupedBooking } = page('pages/booking/index.js', bookingApi, {});
  groupedBooking.onLoad({ serviceId: mock.services[0].id, workId: mock.works[0].id });
  groupedBooking.data.selectedDate = bookingDate;
  await groupedBooking.loadBooking();
  assert.deepStrictEqual(groupedBooking.data.timePeriods.map((period) => period.label), ['上午', '下午']);
  assert.equal(groupedBooking.data.selectedSlotId, '');
  assert.equal(groupedBooking.data.expandedPeriodId, '');
  await groupedBooking.selectPeriod({ currentTarget: { dataset: { id: groupedBooking.data.timePeriods[1].id } } });
  assert.equal(groupedBooking.data.expandedPeriodId, groupedBooking.data.timePeriods[1].id);
  assert.equal(groupedBooking.data.selectedSlotId, '');
  await groupedBooking.selectSlot({ currentTarget: { dataset: { id: 'booking-12' } } });
  assert.equal(groupedBooking.data.selectedSlotId, 'booking-12');
  assert.equal(groupedBooking.data.canSubmit, true);
  const { instance: empty } = page('pages/booking/index.js', {}); empty.onShow(); assert.equal(empty.data.loading, false); assert(!empty.data.service.id);
  const app = require('../app.json');
  app.tabBar.list.forEach(tab => ['iconPath', 'selectedIconPath'].forEach(key => assert(fs.existsSync(path.join(__dirname, '..', tab[key])))));
  console.log('style flow passed: category/project navigation, style selection, tab handoff, booking empty state, icons');
})().catch(error => { console.error(error); process.exitCode = 1; });
