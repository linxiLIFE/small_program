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
assert.doesNotMatch(servicesPage, /BOOK YOUR STYLE|STEP /);
assert.match(read('pages/services/index.js'), /styleCount/);
assert.match(read('components/service-card/service-card.js'), /selected/);

const bookingPage = read('pages/booking/index.js');
assert.match(bookingPage, /workId: this\.workId/);
assert.match(bookingPage, /api\.getWork\(this\.workId\)/);
assert.match(read('cloudfunctions/api/lib/booking.js'), /STYLE_REQUIRED/);
assert.match(read('cloudfunctions/api/lib/booking.js'), /claims\.workId === work\.id/);

assert.match(read('pages/index/index.wxml'), /mode="aspectFill"/);
assert.match(read('admin/src/components/HomeManager.vue'), /crop-ratio="2"/);
assert.match(read('admin/src/components/ImageUploader.vue'), /crop-banner/);
assert.match(read('admin/src/components/ImageUploader.vue'), /sourceWidth/);

console.log('hierarchy tests passed: three-level selection, style-required booking, banner crop and fill');
