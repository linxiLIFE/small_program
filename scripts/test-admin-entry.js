const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

// Exercise the actual gesture with a clock and navigation stub.
let now = 10000;
const navigations = [];
const gesture = { module: { exports: {} }, Date: { now: () => now }, wx: { navigateTo: options => navigations.push(options), showToast() {} } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/admin-entry.js'), 'utf8'), gesture);
const { resetAdminEntry, handleAdminAvatarTap } = gesture.module.exports;
const host = {};
const tap = () => { now += 150; handleAdminAvatarTap.call(host); };
resetAdminEntry.call(host);
for (let i = 0; i < 4; i++) tap();
assert.equal(navigations.length, 0, 'four taps must not open admin');
tap();
assert.equal(navigations.length, 1);
assert.equal(navigations[0].url, '/pages/admin/index');
for (let i = 0; i < 5; i++) tap();
assert.equal(navigations.length, 1, 'prevent duplicate navigation');
resetAdminEntry.call(host);
for (let i = 0; i < 3; i++) tap();
now += 1001;
for (let i = 0; i < 4; i++) tap();
assert.equal(navigations.length, 1, 'a pause resets the gesture');
tap();
assert.equal(navigations.length, 2);
navigations[1].fail();
for (let i = 0; i < 5; i++) tap();
assert.equal(navigations.length, 3, 'failed navigation can be retried');
resetAdminEntry.call(host);
for (let i = 0; i < 4; i++) tap();
resetAdminEntry.call(host);
tap();
assert.equal(navigations.length, 3, 'leaving the page clears partial taps');


const appConfig = require('../app.json');
assert((appConfig.subPackages || []).some(pkg => pkg.pages.some(page => `${pkg.root}/${page}` === 'pages/admin/index')));
assert(!appConfig.tabBar.list.some(tab => tab.pagePath === 'pages/admin/index'));
assert(!fs.readFileSync(path.join(root,'pages/index/index.wxml'),'utf8').includes('home-avatar'));
assert(!fs.readFileSync(path.join(root,'pages/index/index.js'),'utf8').includes('getProfile'));
assert(fs.readFileSync(path.join(root,'pages/profile/index.wxml'),'utf8').includes('bindtap="handleAdminAvatarTap"'));
console.log('admin entry passed: five taps, timeout, reset, duplicate navigation, retry, hidden subpackage route');
