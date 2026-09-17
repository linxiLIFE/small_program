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
  detail.data = {
    service: { id: 'svc-nail-french', categoryId: 'nail' },
    work: { id: 'work-001' },
    technician: { id: 'tech-lin' },
    technicians: [{ id: 'tech-lin', name: '林老师' }, { id: 'tech-zhou', name: '周老师' }],
    selectedTechnicianId: 'tech-lin'
  };
  detail.selectTechnician({ currentTarget: { dataset: { id: 'tech-zhou' } } });
  assert.equal(detail.data.selectedTechnicianId, 'tech-zhou');
  detail.startBooking();
  assert.equal(calls[0].url, '/pages/booking/index'); assert.equal(selected.pendingBooking.workId, 'work-001');
  assert.equal(selected.pendingBooking.technicianId, 'tech-zhou');
  const { instance: booking } = page('pages/booking/index.js', {}, selected);
  let loaded = false; booking.loadBooking = () => { loaded = true; }; booking.onShow();
  assert(loaded); assert.equal(booking.workId, 'work-001'); assert.equal(booking.serviceId, 'svc-nail-french'); assert(!selected.pendingBooking);
  let repeated = false; booking.loadBooking = () => { repeated = true; }; booking.hasLoaded = true; booking.onShow(); assert(!repeated);
  const bookingDate = mock.getDates()[1].value;
  const bookingService = { ...mock.services[0], id: 'svc-nail-natural-color-30', name: '本甲纯色｜30元色板', priceFen: 3000 };
  const bookingWork = { ...mock.works[0], id: 'work-nail-natural-color-30', serviceId: bookingService.id };
  const bookingApi = {
    getBookingContext: async () => ({
      settings: { booking: { openDays: 14, slotStepMinutes: 15 }, points: { maxPercent: 10 } },
      service: bookingService,
      technicians: [mock.technicians[0]],
      profile: mock.profile,
      work: bookingWork,
      addons: { removals: [], builders: [] }
    }),
    listBookingAddons: async () => ({
      removals: [
        { id: 'removal-1', name: '卸本甲', type: 'REMOVAL', priceFen: 0, durationMinutes: 30 },
        { id: 'removal-2', name: '卸甲片', type: 'REMOVAL', priceFen: 2000, durationMinutes: 40 },
        { id: 'removal-3', name: '卸超厚本甲建构', type: 'REMOVAL', priceFen: 2000, durationMinutes: 45 }
      ],
      builders: [{ id: 'builder-1', name: 'V建构', type: 'BUILDER', priceFen: 1500, durationMinutes: 30 }]
    }),
    getAvailableSlots: async () => ({
      stepMinutes: 15,
      slots: [
        { id: 'booking-10', startAt: Date.parse(`${bookingDate}T10:00:00+08:00`), available: true },
        { id: 'booking-1015', startAt: Date.parse(`${bookingDate}T10:15:00+08:00`), available: true },
        { id: 'booking-12', startAt: Date.parse(`${bookingDate}T12:00:00+08:00`), available: true }
      ]
    }),
    createQuote: async () => ({ quoteId: 'quote-test', totalFen: 29900, discountFen: 0, paidFen: 29900, pointsToUse: 0 })
  };
  const { instance: groupedBooking } = page('pages/booking/index.js', bookingApi, {});
  groupedBooking.onLoad({ serviceId: bookingService.id, workId: bookingWork.id });
  groupedBooking.data.selectedDate = bookingDate;
  await groupedBooking.loadBooking();
  assert.deepStrictEqual(groupedBooking.data.removalOptions.map((item) => item.priceText), ['免费', '¥20.00', '¥20.00']);
  assert.equal(groupedBooking.data.removalBadgeText, '仅卸本甲免费');
  await groupedBooking.selectAddon({ currentTarget: { dataset: { type: 'removal', id: 'none' } } });
  await groupedBooking.selectAddon({ currentTarget: { dataset: { type: 'builder', id: 'none' } } });
  assert.deepStrictEqual(groupedBooking.data.timePeriods.map((period) => period.label), ['上午', '下午']);
  assert.equal(groupedBooking.data.selectedSlotId, '');
  assert.equal(groupedBooking.data.expandedPeriodId, '');
  groupedBooking.data.timelineTrackWidth = 360;
  groupedBooking.updateTimelineSelection(groupedBooking.data.timeline.availableSlots[0]);
  const firstRange = groupedBooking.timelineRangeFromX('start', -14, true);
  const lastRange = groupedBooking.timelineRangeFromX('end', groupedBooking.data.timelineTrackWidth - 14, true);
  assert.equal(firstRange.startAt, groupedBooking.data.timeline.startAt);
  assert.equal(lastRange.endAt, groupedBooking.data.timeline.endAt);
  await groupedBooking.selectPeriod({ currentTarget: { dataset: { id: groupedBooking.data.timePeriods[1].id } } });
  assert.equal(groupedBooking.data.expandedPeriodId, groupedBooking.data.timePeriods[1].id);
  assert.equal(groupedBooking.data.selectedSlotId, '');
  await groupedBooking.selectSlot({ currentTarget: { dataset: { id: 'booking-12' } } });
  assert.equal(groupedBooking.data.selectedSlotId, 'booking-12');
  assert.equal(groupedBooking.data.canSubmit, true);
  await groupedBooking.selectSlot({ currentTarget: { dataset: { id: 'booking-10' } } });
  const endBeforeDrag = groupedBooking.data.timelineEndX;
  groupedBooking.handleTimelineTouchStart({ currentTarget: { dataset: { edge: 'start' } }, touches: [{ clientX: 100 }] });
  groupedBooking.handleTimelineTouchMove({ touches: [{ clientX: 130 }] });
  assert(groupedBooking.data.timelineDragging);
  assert(groupedBooking.data.timelineEndX > endBeforeDrag);
  await groupedBooking.handleTimelineTouchEnd({ changedTouches: [{ clientX: 130 }] });
  assert(!groupedBooking.data.timelineDragging);
  const footService = { ...bookingService, id: 'svc-foot-nail-natural-color-40', categoryId: 'foot-nail', categoryName: '脚部美甲', name: '本甲纯色｜40元色板', priceFen: 4000, durationMinutes: 60, tags: ['本甲', '纯色'] };
  const footWork = { ...bookingWork, id: 'work-foot-natural-color-40', serviceId: footService.id };
  const slotPayloads = [];
  const footBookingApi = {
    getBookingContext: async () => ({
      settings: { booking: { openDays: 14, slotStepMinutes: 15 }, points: { maxPercent: 10 } },
      service: footService,
      technicians: [mock.technicians[0]],
      profile: mock.profile,
      work: footWork,
      addons: {
        removals: [{ id: 'foot-removal-1', name: '卸脚部本甲', type: 'REMOVAL', priceFen: 0, durationMinutes: 30 }],
        builders: [{ id: 'foot-builder-1', name: '脚部V建构', type: 'BUILDER', priceFen: 1500, durationMinutes: 30 }],
        footTip: { id: 'svc-foot-nail-addon-single-tip', name: '加脚甲片', type: 'TIP', unitPriceFen: 500, priceFen: 500, durationMinutes: 0, maxQuantity: 10 }
      }
    }),
    getAvailableSlots: async (payload) => {
      slotPayloads.push(payload);
      return { stepMinutes: 15, slots: [{ id: 'foot-10', startAt: Date.parse(`${bookingDate}T10:00:00+08:00`), available: true }] };
    },
    createQuote: async (payload) => ({ quoteId: 'quote-foot', totalFen: 4000 + Number(payload.footTipCount || 0) * 500, discountFen: 0, paidFen: 4000 + Number(payload.footTipCount || 0) * 500, pointsToUse: 0 })
  };
  const { instance: footBooking } = page('pages/booking/index.js', footBookingApi, {});
  footBooking.onLoad({ serviceId: footService.id, workId: footWork.id });
  await footBooking.loadBooking();
  assert.equal(footBooking.data.supportsFootTipAddon, true);
  assert.equal(footBooking.data.showsRemovalChoice, false);
  assert.equal(footBooking.data.requiresBuilderChoice, false);
  assert.equal(footBooking.data.removalOptions.length, 0);
  assert.equal(footBooking.data.builderOptions.length, 0);
  assert.equal(footBooking.data.addonStepTitle, '加脚甲片');
  assert.equal(footBooking.data.addonsReady, false);
  await footBooking.selectFootTipChoice({ currentTarget: { dataset: { choice: 'add' } } });
  assert.equal(slotPayloads.at(-1).footTipCount, 1);
  assert.equal(footBooking.data.service.durationMinutes, 60);
  await footBooking.changeFootTipCount({ currentTarget: { dataset: { delta: 1 } } });
  assert.equal(slotPayloads.at(-1).footTipCount, 2);
  assert.equal(footBooking.data.selectedAddons.find((item) => item.type === 'TIP').priceFen, 1000);
  assert.equal(footBooking.data.service.durationMinutes, 60);
  const { instance: empty } = page('pages/booking/index.js', {}); empty.onShow(); assert.equal(empty.data.loading, false); assert(!empty.data.service.id);
  const bookingWxml = fs.readFileSync(path.join(__dirname, '..', 'pages/booking/index.wxml'), 'utf8');
  assert.match(bookingWxml, /timeline\.segments\.length && timelineHasOptions/);
  assert.match(bookingWxml, /当天没有可预约时段/);
  assert.match(bookingWxml, /\{\{item\.priceText\}\} · \{\{item\.durationText\}\}/);
  assert.match(bookingWxml, /加甲片数量/);
  assert.match(bookingWxml, /不增加服务时长/);
  assert(!bookingWxml.includes('不加时'));
  assert(!bookingWxml.includes('step-subtitle'));
  assert(!bookingWxml.includes('timeline-instruction'));
  const detailWxml = fs.readFileSync(path.join(__dirname, '..', 'pages/work-detail/index.wxml'), 'utf8');
  assert.match(detailWxml, /wx:for="\{\{technicians\}\}"/);
  assert.match(detailWxml, /bindtap="selectTechnician"/);
  const app = require('../app.json');
  app.tabBar.list.forEach(tab => ['iconPath', 'selectedIconPath'].forEach(key => assert(fs.existsSync(path.join(__dirname, '..', tab[key])))));
  console.log('style flow passed: category/project navigation, style selection, tab handoff, booking empty state, icons');
})().catch(error => { console.error(error); process.exitCode = 1; });
