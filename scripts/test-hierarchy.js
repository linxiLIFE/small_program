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

assert.match(read('pages/index/index.wxml'), /mode="aspectFill"/);
assert.match(read('pages/index/index.wxml'), /lazy-load/);
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
assert.match(read('pages/booking/index.wxml'), /选择服务时段/);
assert.match(read('pages/booking/index.wxml'), /timePeriods/);
assert.match(read('pages/booking/index.js'), /buildTimePeriods/);

console.log('hierarchy tests passed: three-level selection, style-required booking, banner crop and fill');
