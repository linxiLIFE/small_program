const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const servicesPage = read('pages/services/index.wxml');
assert.match(servicesPage, /选择大项/);
assert.match(servicesPage, /选择小项目/);
assert.match(read('pages/services/index.js'), /pages\/style-select\/index/);
assert.match(read('pages/style-select/index.wxml'), /选择款式/);
assert.match(read('pages/style-select/index.js'), /listServiceStyles/);
assert.doesNotMatch(servicesPage, /BOOK YOUR STYLE|STEP /);
assert.match(read('pages/services/index.js'), /styleCount/);
assert.match(read('components/service-card/service-card.js'), /selected/);
assert.match(read('app.js'), /catalogSelection/);
assert.match(read('utils/api.js'), /pendingRequests/);
assert.match(read('utils/api.js'), /UNKNOWN_ACTION/);
assert.match(read('pages/booking/index.js'), /getBookingContext/);
assert.match(read('pages/booking/index.js'), /loadedKey/);
assert.match(read('pages/booking/index.js'), /showsAddonStep = isNailBooking && addonType !== 'REMOVAL'/);
assert.match(read('pages/booking/index.js'), /requiresBuilderChoice = showsAddonStep && addonType !== 'BUILDER'/);
assert.match(read('pages/booking/index.wxml'), /wx:if="\{\{showsAddonStep\}\}" class="booking-step addon-step"/);
assert.match(read('pages/booking/index.wxml'), /class="addon-panel card"/);
assert.doesNotMatch(read('pages/booking/index.wxml'), /需要卸甲吗|需要建构吗|先确认本次是否需要/);

const bookingPage = read('pages/booking/index.js');
assert.match(bookingPage, /workId: this\.workId/);
assert.match(bookingPage, /date: this\.data\.selectedDate/);
assert.match(bookingPage, /api\.getBookingContext\(this\.serviceId, this\.workId\)/);
assert.match(read('cloudfunctions/api/lib/booking.js'), /STYLE_REQUIRED/);
assert.match(read('cloudfunctions/api/lib/booking.js'), /claims\.workId === work\.id/);
assert.match(read('cloudfunctions/api/lib/catalog.js'), /listServiceCatalog/);
assert.match(read('cloudfunctions/api/lib/catalog.js'), /function loadCatalog/);
assert.match(read('cloudfunctions/api/index.js'), /listServiceStyles/);
assert.match(read('cloudfunctions/api/index.js'), /getBookingContext/);

const homePage = read('pages/index/index.wxml');
assert.match(homePage, /mode="aspectFill"/);
assert.match(homePage, /lazy-load/);
assert.doesNotMatch(homePage, /notification-prompt|开启微信预约提醒|enableNotifications/);
assert.doesNotMatch(read('pages/index/index.js'), /requestSubscriptionEvents|loadNotificationPrompt/);
assert.match(read('pages/booking/index.js'), /requestSubscriptionEvents\(this\.bookingSettings/);
assert.match(read('components/work-card/work-card.wxml'), /webp/);
assert.match(read('admin/src/components/HomeManager.vue'), /crop-ratio="2"/);
assert.match(read('admin/src/components/ImageUploader.vue'), /crop-banner/);
assert.match(read('admin/src/components/ImageUploader.vue'), /cropRect|cropSource/);
assert.match(read('admin/src/components/ImageUploader.vue'), /pointerdown/);
assert.match(read('admin/src/components/TeamManager.vue'), /type="checkbox"/);
assert.doesNotMatch(read('admin/src/components/CatalogManager.vue'), /整理时间/);
assert.match(read('cloudfunctions/api/lib/booking.js'), /Number\(service\.durationMinutes\)/);
assert.match(read('pages/index/index.js'), /wx\.makePhoneCall/);
assert.match(read('cloudfunctions/api/index.js'), /updateProfile/);
assert.match(read('pages/booking/index.wxml'), /<text class="step-title">时间<\/text>/);
assert.match(read('pages/booking/index.wxml'), /timePeriods/);
assert.match(read('pages/booking/index.js'), /buildTimePeriods/);
assert.match(read('cloudfunctions/api/lib/catalog.js'), /item\.bookableStandalone !== 0/);
assert.match(read('cloudfunctions/api/lib/catalog.js'), /priceFen: addonPriceFen\(item, 'REMOVAL'\)/);
assert.match(read('cloudfunctions/api/lib/booking.js'), /standaloneRemoval/);
assert.match(read('cloudfunctions/api/lib/booking.js'), /priceFen = addonPriceFen\(record, selection\.type\)/);
assert.match(read('cloudfunctions/api/lib/catalog-admin.js'), /ADDON_SINGLE_STYLE/);
assert.match(read('cloudfunctions/api/lib/catalog-admin.js'), /单独预约价格必须大于 0/);

const seedCatalog = require('../cloudfunctions/seed/lib/catalog-data');
const standaloneRemovalPrices = Object.fromEntries(seedCatalog.services
  .filter((item) => item.addonType === 'REMOVAL')
  .map((item) => [item.id, item.priceFen]));
assert.deepEqual(standaloneRemovalPrices, {
  'svc-nail-removal-natural': 1000,
  'svc-nail-removal-thick-builder': 2000,
  'svc-nail-removal-tips': 2000,
  'svc-foot-nail-removal-natural': 1000,
  'svc-foot-nail-removal-tips': 2000
});
assert.deepEqual(seedCatalog.services
  .filter((item) => item.addonType === 'REMOVAL' && item.freeAsAddon)
  .map((item) => item.id), [
  'svc-nail-removal-natural',
  'svc-foot-nail-removal-natural'
]);

console.log('hierarchy tests passed: three-level selection, style-required booking, banner crop and fill');
