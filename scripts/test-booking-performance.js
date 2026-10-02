const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function timers() {
  let next = 0;
  const pending = new Map();
  return {
    setTimeout(fn) { pending.set(++next, fn); return next; },
    clearTimeout(id) { pending.delete(id); },
    async flush() { const tasks = [...pending.values()]; pending.clear(); for (const fn of tasks) await fn(); await new Promise(resolve => setImmediate(resolve)); },
    get size() { return pending.size; }
  };
}
function page(file, api, timer) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    Page: value => { definition = value; }, console,
    setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
    require: ref => ref.endsWith('/api') ? api : ref.endsWith('/format') ? require('../utils/format') : {},
    getApp: () => ({ globalData: {} })
  });
  return { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(data) { Object.assign(this.data, data); } };
}
(async () => {
  // The real exported API uses one aggregate call and shares in-flight prefetch.
  let release;
  const requests = [];
  const gate = new Promise(resolve => { release = resolve; });
  const app = { globalData: {} };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/api.js'), 'utf8'), {
    module, exports: module.exports, console, getApp: () => app,
    wx: { cloud: { callFunction: async ({ data }) => { requests.push(data.action); await gate; return { result: { ok: true, data: { service: { id: 's' }, work: { id: 'w' }, profile: { id: 'u', points: 100 }, settings: { points: { unit: 20, discountFen: 100, maxPercent: 10 } } } } }; } } },
    require: ref => ref === '../cloud-config' ? { env: 'test' } : ref === './image-cache' ? { withCachedImagePaths: value => value } : {}
  });
  const realApi = module.exports;
  assert.equal(typeof realApi.getBookingContext, 'function');
  const prefetch = realApi.getBookingContext('s', 'w');
  const entry = realApi.getBookingContext('s', 'w');
  release(); await Promise.all([prefetch, entry]);
  assert.deepEqual(requests, ['getBookingContext']);
  assert.equal(realApi.getCachedProfile().id, 'u');
  await realApi.getProfile(); await realApi.getSettings();
  assert.equal(requests.length, 1, 'aggregate response must seed profile/settings caches');

  const timer = timers();
  const booking = page('pages/booking/index.js', {}, timer);
  Object.assign(booking.data, { service: { durationMinutes: 60, baseDurationMinutes: 60 }, boostOption: { id: 'boost', unitPriceFen: 1000, durationMinutes: 10 }, addonsReady: true });
  let slotRequests = 0;
  booking.loadSlots = async () => { slotRequests++; };
  for (let index = 0; index < 6; index++) await booking.changeBoostCount({ currentTarget: { dataset: { delta: 1 } } });
  assert.equal(booking.data.boostCount, 6);
  assert.equal(booking.data.service.durationMinutes, 120);
  assert.equal(slotRequests, 0); assert.equal(timer.size, 1);
  await timer.flush(); assert.equal(slotRequests, 1, 'burst edits must request only the final quantity');
  for (let index = 0; index < 8; index++) await booking.changeBoostCount({ currentTarget: { dataset: { delta: -1 } } });
  assert.equal(booking.data.boostCount, 0);

  let quotes = 0;
  const cart = page('pages/cart/index.js', { createCartQuote: async ({ items }) => { quotes++; return { quotes: items.map(() => ({ totalFen: 5000, durationMinutes: 60 })), totalFen: 5000 * items.length, discountFen: 0, paidFen: 5000 * items.length, pointsToUse: 0 }; } }, timer);
  cart.data.items = ['a', 'b'].map(id => ({ id, selected: true, totalFen: 5000, payload: { startAt: Date.now() } }));
  cart.data.profile = { points: 100 };
  cart.pointsRule = { unit: 20, discountFen: 100, maxPercent: 10 };
  await cart.toggleItem({ currentTarget: { dataset: { id: 'b' } } });
  assert.equal(cart.data.quote.paidFen, 5000, 'selection total must update before network');
  await cart.toggleItem({ currentTarget: { dataset: { id: 'b' } } });
  await cart.toggleItem({ currentTarget: { dataset: { id: 'b' } } });
  assert.equal(quotes, 0);
  await timer.flush(); assert.equal(quotes, 1); assert.equal(cart.data.quote.preview, undefined);
  cart.data.usePoints = true; cart.previewQuote();
  assert.equal(cart.data.quote.paidFen, 4500); assert.equal(cart.data.quote.pointsToUse, 100);
  cart.scheduleQuote(); cart.onHide(); assert.equal(timer.size, 0);
  console.log('booking performance passed: aggregate prefetch reused, profile/settings cached, unlimited boost burst coalesced, instant cart totals and one request per burst');
})().catch(error => { console.error(error); process.exitCode = 1; });
