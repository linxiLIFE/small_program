const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');
const constants = require('../cloudfunctions/api/lib/constants');
const realTime = require('../cloudfunctions/api/lib/time');
const clone = x => JSON.parse(JSON.stringify(x));
const secondCategory = '514aa7c9-1cf3-4fe1-ba92-fcc2de47694e';
let changeBoostInTransaction = false;
let tables, context = { openid: 'customer', appid: 'wx-test' }, providerState = 'NOTPAY', providerCalls = [], transactionCount = 0, failCommit = false;
const settings = clone(constants.DEFAULT_SETTINGS);
settings.schedule.weekly.forEach(day => { day.enabled = true; day.shifts = [{ start: '00:00', end: '23:45', breaks: [] }]; });
function reset() {
  tables = { users: { customer: { id: 'customer', openid: 'customer', phoneCipher: 'bound', nickname: '测试' } }, categories: {}, services: {}, works: {}, technicians: {}, points_accounts: { customer: { id: 'customer', available: 100, frozen: 0, debt: 0 } } };
  ['nail', secondCategory, 'foot-nail', 'lash', 'nail-care'].forEach(id => { tables.categories[id] = { id, name: id, enabled: true }; });
  [['hand', 'nail'], ['tips', secondCategory], ['foot', 'foot-nail'], ['lash', 'lash']].forEach(([id, categoryId]) => {
    tables.services[id] = { id, categoryId, name: categoryId === 'foot-nail' ? '脚部本甲纯色' : '纯色', enabled: true, priceFen: 5000, durationMinutes: 60 };
    tables.works[`work-${id}`] = { id: `work-${id}`, serviceId: id, title: id, published: true };
  });
  tables.services.removal = { id: 'removal', categoryId: 'nail-care', name: '卸甲片', enabled: true, addonType: 'REMOVAL', priceFen: 2000, durationMinutes: 20 };
  tables.services.builder = { id: 'builder', categoryId: 'nail-care', name: '单独塑形建构', enabled: true, addonType: 'BUILDER', priceFen: 3000, durationMinutes: 30 };
  tables.services.boost = { id: 'boost', categoryId: 'nail', name: '加油包', enabled: true, priceFen: 1000, durationMinutes: 10 };
  tables.technicians.tech = { id: 'tech', name: '技师', enabled: true, categoryIds: ['nail', secondCategory, 'foot-nail', 'lash', 'nail-care'] };
  tables.technicians['tech-other'] = { ...clone(tables.technicians.tech), id: 'tech-other', name: '另一位技师' };
  providerState = 'NOTPAY'; providerCalls = []; failCommit = false; changeBoostInTransaction = false;
}
const matches = (row, where) => Object.entries(where).every(([key, value]) => value && value.op === 'in' ? value.value.includes(row[key]) : value && value.op === 'exists' ? (row[key] !== undefined) === value.value : row[key] === value);
const find = async (table, where = {}, opts = {}) => Object.values(tables[table] || {}).filter(x => matches(x, where)).slice(opts.skip || 0, (opts.skip || 0) + (opts.limit || 10000));
const getOptional = async (table, id, reader) => {
  if (changeBoostInTransaction && reader && table === 'categories') { tables.services.boost.priceFen = 999; changeBoostInTransaction = false; }
  return clone(tables[table] && tables[table][id] || null);
};
const db = {
  command: { in: value => ({ op: 'in', value }), exists: value => ({ op: 'exists', value }) },
  collection: table => ({
    doc: id => ({ set: async ({ data }) => {
      // Emulate the two production financial unique keys.
      if (table === 'payments') for (const [otherId, other] of Object.entries(tables.payments || {})) {
        if (otherId !== id && (data.transactionId && other.transactionId === data.transactionId || data.merchantOrderNo && other.merchantOrderNo === data.merchantOrderNo)) throw new Error('DUPLICATE_FINANCIAL_KEY');
      }
      (tables[table] ||= {})[id] = clone(data);
    } }),
    where: where => ({ limit: limit => ({ get: async () => ({ data: await find(table, where, { limit }) }) }) })
  }),
  insertIfAbsent: async (table, id, data) => { if (!tables[table]?.[id]) (tables[table] ||= {})[id] = clone(data); },
  query: async (sql, params) => [[{ total_fen: Object.values(tables.refunds || {}).filter(r => r.orderId === params[0] && r.status === 'SUCCESS' && r.id !== params[1]).reduce((sum, r) => sum + r.amountFen, 0) }]],
  runTransaction: async callback => {
    const before = clone(tables); transactionCount++;
    try { const result = await callback(db); if (failCommit) throw new Error('COMMIT_TIMEOUT'); return result; }
    catch (error) { tables = before; throw error; }
  }
};
const wechat = {
  verifyNotifySignature: () => true, decryptNotification: x => x,
  isConfigured: () => true, config: () => ({ appid: 'wx-test', mchid: 'merchant' }),
  createJsapiPrepay: async payload => { providerCalls.push(['prepay', payload]); return { prepayId: 'prepay-test', timeStamp: '1', package: 'prepay_id=prepay-test', nonceStr: 'nonce', paySign: 'sign' }; },
  buildJsapiPayParams: () => ({ timeStamp: '1', package: 'prepay_id=prepay-test' }),
  queryOrder: async () => ({ trade_state: providerState, amount: { total: currentGroup().amountFen, currency: 'CNY' }, payer: { openid: 'customer' }, transaction_id: 'wx-transaction', success_time: new Date().toISOString() }),
  closeOrder: async no => { providerCalls.push(['close', no]); providerState = 'CLOSED'; },
  queryRefund: async () => { const error = new Error('missing'); error.code = 'PAYMENT_PROVIDER_ERROR'; error.details = { providerCode: 'RESOURCE_NOT_EXISTS' }; throw error; },
  createRefund: async payload => { providerCalls.push(['refund', payload]); return { status: 'PROCESSING', refund_id: 'wx-refund' }; }
};
const stubs = {
  './db': { db, getOptional, find, findAll: find, cloud: {}, getContext: () => context },
  './auth': { requireOpenId: () => context, ensureUser: async () => clone(tables.users.customer) },
  './settings': { getCurrentSettings: async () => clone(settings), publicSettings: x => x },
  './notification-service': { notifyOrderEvent: async () => ({ sent: false }) },
  './analytics': { bookingCounts: async () => ({}) },
  './contact-crypto': {},
  './wechat-pay': wechat
};
const modules = {};
function load(name) {
  if (modules[name]) return modules[name].exports;
  const mod = { exports: {} }; modules[name] = mod;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib', `${name}.js`), 'utf8'), { module: mod, exports: mod.exports, Buffer, console, process: { env: { QUOTE_SIGNING_SECRET: 'test-secret-32-characters-long-enough' } }, require: ref => stubs[ref] || (ref.startsWith('./') ? load(ref.slice(2)) : require(ref)) }, { filename: `${name}.js` });
  return mod.exports;
}
const booking = load('booking'), catalog = load('catalog'), cart = load('cart'), groupPayment = load('cart-payment'), payment = load('payment-service');
const date = realTime.toDateString(Date.now() + 2 * 86400000);
const payload = (id, hour, extras = {}) => ({ serviceId: id, workId: `work-${id}`, technicianId: 'tech', date, startAt: realTime.dateToTimestamp(date, `${hour}:00`), addonSelectionConfirmed: true, footTipSelectionConfirmed: true, ...extras });
function currentGroup() { return Object.values(tables.payments || {}).find(x => x.orderIds); }
async function checkout(items, key = 'checkout') {
  const quote = await cart.createCartQuote({ items, pointsToUse: 100 });
  const request = { items: items.map((x, i) => ({ ...x, quoteId: quote.quotes[i].quoteId, pointsToUse: quote.quotes[i].pointsToUse })), idempotencyKey: key };
  return { quote, request, result: await cart.createCartOrder(request) };
}
(async () => {
  reset();
  // One payer can book overlapping appointments for different people/technicians.
  const simultaneous = [payload('hand', '10', { boostCount: 2 }), payload('tips', '10', { technicianId: 'tech-other' })];
  const together = await checkout(simultaneous, 'different-technicians');
  assert.equal(together.result.orders.length, 2);
  assert.equal(together.result.paidFen, 11500);
  assert.equal(together.quote.pointsToUse, 100);
  assert.equal(tables.points_accounts.customer.frozen, 100);
  assert.equal(tables.technician_days[`tech_${date}`].occupancies.length, 1);
  assert.equal(tables.technician_days[`tech-other_${date}`].occupancies.length, 1);
  assert((await cart.createCartOrder(together.request)).replay);
  await payment.preparePayment(together.result.orders[0].id);
  assert.equal(providerCalls.filter(x => x[0] === 'prepay').length, 1);
  assert.equal(providerCalls[0][1].amountFen, 11500);
  await groupPayment.markGroupSuccess(together.result.groupId, { amountFen: 11500, payerOpenid: 'customer', transactionId: 'simultaneous-payment' });
  assert(Object.values(tables.orders).every(o => o.status === 'RESERVED' && o.userId === 'customer'));
  assert.equal(tables.points_accounts.customer.frozen, 0);
  // An existing paid appointment under this account also permits a new cart
  // booking on another technician. Direct booking retains its customer check.
  const next = payload('foot', '10', { technicianId: 'tech-other', startAt: simultaneous[1].startAt + 3600000 });
  const nextQuote = await booking.createQuote(next);
  await assert.rejects(booking.createOrder({ ...next, quoteId: nextQuote.quoteId, idempotencyKey: 'standalone-conflict' }), error => error.code === 'CUSTOMER_SLOT_TAKEN');
  assert.equal(Object.keys(tables.orders).length, 2);
  await checkout([next], 'cart-for-another-person');
  assert.equal(Object.keys(tables.orders).length, 3);
  await assert.rejects(cart.createCartQuote({ items: [simultaneous[0]] }), error => error.code === 'SLOT_TAKEN');
  reset();
  // Interleaving another technician must not hide a same-technician conflict;
  // boost duration counts, while adjacent appointments at the boundary are valid.
  await assert.rejects(cart.createCartQuote({ items: [simultaneous[0], simultaneous[1], payload('foot', '11')] }), error => error.code === 'CART_SLOT_CONFLICT');
  await checkout([payload('hand', '10'), payload('tips', '11')], 'adjacent-appointments');
  reset();
  tables.services.hand.priceFen = 0; tables.services.tips.priceFen = 0;
  const freeTogether = await checkout([payload('hand', '10'), payload('tips', '10', { technicianId: 'tech-other' })], 'free-simultaneous');
  assert.equal(freeTogether.result.paymentRequired, false);
  assert(freeTogether.result.orders.every(o => o.status === 'RESERVED'));
  reset();
  // A competing payer takes the second technician after quoting: checkout must
  // roll back the first technician's occupancy and all points/order writes.
  const raceItems = [payload('hand', '10'), payload('tips', '10', { technicianId: 'tech-other' })];
  const raceQuote = await cart.createCartQuote({ items: raceItems, pointsToUse: 100 });
  tables.technician_days = { [`tech-other_${date}`]: { id: `tech-other_${date}`, technicianId: 'tech-other', date, shifts: [{ start: '00:00', end: '23:45', breaks: [] }], occupancies: [{ orderId: 'other-payer', startAt: raceItems[1].startAt, endAt: raceItems[1].startAt + 3600000, status: 'RESERVED' }] } };
  const beforeRace = clone(tables);
  await assert.rejects(cart.createCartOrder({ items: raceItems.map((x, i) => ({ ...x, quoteId: raceQuote.quotes[i].quoteId, pointsToUse: raceQuote.quotes[i].pointsToUse })), idempotencyKey: 'different-technician-race' }), error => error.code === 'SLOT_TAKEN');
  assert.deepEqual(tables, beforeRace);
  reset();
  // Fee threshold excludes removal itself and is evaluated before point discounts.
  for (const id of ['hand', 'tips']) {
    reset();tables.services[id].priceFen=3000;
    const options=await catalog.listBookingAddons(tables.services[id].categoryId,await catalog.getService(id));
    assert.equal(options.removals[0].basePriceFen,2000);
    for (const [base, count, fee, total] of [[2999,1,2000,5999],[3000,1,0,4000],[1500,2,2000,5500],[1500,3,0,4500],[3000,0,2000,5000]]) {
      tables.services[id].priceFen=base;
      const q=await booking.createQuote(payload(id,'10',{boostCount:count,removalServiceId:'removal'}));
      assert.equal(q.addons.find(a=>a.type==='REMOVAL').priceFen,fee);assert.equal(q.totalFen,total);
      assert.equal(q.durationMinutes,80+count*10,'waiver must preserve removal duration');
    }
    tables.services[id].priceFen=3000;
    const {result:waived,quote:waivedQuote}=await checkout([payload(id,'10',{boostCount:1,removalServiceId:'removal'})],'waiver-'+id);
    assert.equal(waivedQuote.totalFen,4000);assert(waivedQuote.paidFen<4000);
    assert.equal(tables.orders[waived.orders[0].id].addonSnapshots.find(a=>a.type==='REMOVAL').priceFen,0);
  }
  reset();tables.services.hand.priceFen=3000;
  const changedPayload=payload('hand','10',{boostCount:1,removalServiceId:'removal'});
  const changedQuote=await cart.createCartQuote({items:[changedPayload]});
  changeBoostInTransaction=true;
  await assert.rejects(cart.createCartOrder({items:[{...changedPayload,quoteId:changedQuote.quotes[0].quoteId,pointsToUse:0}],idempotencyKey:'boost-price-changed'}),error=>error.code==='QUOTE_CHANGED');
  assert.equal(Object.keys(tables.orders||{}).length,0);assert.equal(providerCalls.length,0);
  reset();
  assert(catalog.isHandNailCategory(secondCategory));
  const addons = await catalog.listBookingAddons(secondCategory, await catalog.getService('tips'));
  assert.equal(addons.removals[0].priceFen, 0); assert.equal(addons.builders[0].id, 'builder'); assert.equal(addons.boost.id, 'boost');
  assert.equal(addons.removals[0].categoryId, 'nail-care');
  tables.technicians.tech.categoryIds.push('nail-care');
  tables.works['work-removal'] = { id: 'work-removal', serviceId: 'removal', title: '独立卸甲', published: true };
  tables.works['work-builder'] = { id: 'work-builder', serviceId: 'builder', title: '独立建构', published: true };
  const removalOnly = await booking.createQuote(payload('removal', '10'));
  const builderOnly = await booking.createQuote(payload('builder', '10'));
  assert.equal(removalOnly.totalFen, 2000); assert.equal(removalOnly.durationMinutes, 20); assert.equal(removalOnly.addons.length, 0);
  assert.equal(builderOnly.totalFen, 3000); assert.equal(builderOnly.durationMinutes, 30); assert.equal(builderOnly.addons.length, 0);
  for (const id of ['hand', 'tips', 'foot']) {
    const quote = await booking.createQuote(payload(id, '10', { boostCount: 2 }));
    assert.equal(quote.totalFen, 7000); assert.equal(quote.durationMinutes, 80); assert.equal(quote.addons[0].quantity, 2);
  }
  const largeBoost = await booking.createQuote(payload('hand', '10', { boostCount: 5 }));
  assert.equal(largeBoost.totalFen, 10000); assert.equal(largeBoost.durationMinutes, 110);
  const tipQuote = await booking.createQuote(payload('tips', '10', { removalServiceId: 'removal', builderServiceId: 'builder' }));
  assert.equal(tipQuote.totalFen, 8000); assert.equal(tipQuote.durationMinutes, 110);
  for (const count of [-1, 1.5, 'invalid', Number.MAX_SAFE_INTEGER]) await assert.rejects(booking.createQuote(payload('hand', '10', { boostCount: count })), error => error.code === 'INVALID_ADDON');
  assert(!catalog.supportsBoostAddon(tables.services.removal)); assert(!catalog.supportsBoostAddon(tables.services.builder));
  assert(catalog.supportsBoostAddon({ ...tables.services.hand, name: '本甲建构纯色' }));
  await assert.rejects(booking.createQuote(payload('lash', '10', { boostCount: 1 })), error => error.code === 'INVALID_ADDON');
  await assert.rejects(cart.createCartQuote({ items: [payload('hand', '10'), payload('tips', '10')] }), error => error.code === 'CART_SLOT_CONFLICT');
  assert.equal(Object.keys(tables.orders || {}).length, 0);
  let { result, request, quote } = await checkout([payload('hand', '10', { boostCount: 1 }), payload('tips', '12')]);
  assert.equal(result.orders.length, 2); assert.equal(quote.pointsToUse, 100); assert.equal(tables.points_accounts.customer.frozen, 100);
  assert.equal(result.paidFen, 10500); assert.equal(Object.keys(tables.orders).length, 2);
  const replay = await cart.createCartOrder(request); assert(replay.replay); assert.equal(replay.groupId, result.groupId); assert.equal(Object.keys(tables.orders).length, 2);
  await assert.rejects(cart.createCartOrder({ ...request, items: request.items.map((x, i) => i ? { ...x, startAt: x.startAt + 3600000 } : x) }), error => error.code === 'IDEMPOTENCY_CONFLICT');
  const pay = await payment.preparePayment(result.orders[1].id); assert(pay.configured); assert.equal(providerCalls[0][1].amountFen, 10500);
  await payment.preparePayment(result.orders[0].id); assert.equal(providerCalls.filter(x => x[0] === 'prepay').length, 1);
  await assert.rejects(groupPayment.markGroupSuccess(result.groupId, { amountFen: 1 }), error => error.code === 'PAYMENT_AMOUNT_MISMATCH');
  await assert.rejects(groupPayment.markGroupSuccess(result.groupId, { amountFen: 10500, payerOpenid: 'other' }), error => error.code === 'PAYMENT_PAYER_MISMATCH');
  const callback = { id: 'callback-one', event_type: 'TRANSACTION.SUCCESS', resource: { appid: 'wx-test', mchid: 'merchant', out_trade_no: currentGroup().merchantOrderNo, amount: { total: 10500, currency: 'CNY' }, payer: { openid: 'customer' }, transaction_id: 'wx-transaction' } };
  const notifyEvent = data => ({ headers: { 'Wechatpay-Timestamp': String(Math.floor(Date.now() / 1000)), 'Wechatpay-Nonce': 'nonce', 'Wechatpay-Signature': 'signature', 'Wechatpay-Serial': 'serial' }, body: JSON.stringify(data) });
  await payment.handleNotify(notifyEvent(callback));
  assert((await payment.handleNotify(notifyEvent(callback))).duplicate);
  providerState = 'SUCCESS'; const paid = await payment.queryPayment(result.orders[0].id); assert.equal(paid.status, 'SUCCESS');
  assert(Object.values(tables.orders).every(o => o.status === 'RESERVED')); assert.equal(tables.points_accounts.customer.frozen, 0);
  assert.equal(Object.values(tables.payments).filter(p => p.transactionId).length, 1);
  const duplicated = await groupPayment.markGroupSuccess(result.groupId, { amountFen: 10500, transactionId: 'wx-transaction' }); assert(duplicated.duplicate);
  const order = result.orders[1]; await booking.cancelOrder(order.id);
  const refund = providerCalls.find(x => x[0] === 'refund')[1]; assert.equal(refund.amountFen, 5000); assert.equal(refund.totalFen, 10500); assert.equal(refund.outTradeNo, currentGroup().merchantOrderNo);
  const refundRow = Object.values(tables.refunds)[0];
  await payment.handleNotify(notifyEvent({ id: 'refund-callback-one', event_type: 'REFUND.SUCCESS', resource: { appid: 'wx-test', mchid: 'merchant', out_refund_no: refundRow.refundNo, out_trade_no: currentGroup().merchantOrderNo, amount: { refund: 5000, total: 10500, currency: 'CNY' }, refund_id: 'wx-refund' } }));
  assert.equal(tables.orders[order.id].refundStatus, 'SUCCESS');
  assert.equal(tables.orders[result.orders[0].id].status, 'RESERVED');
  reset();
  ({ result } = await checkout([payload('hand', '10'), payload('tips', '12')]));
  await booking.cancelOrder(result.orders[0].id);
  assert(Object.values(tables.orders).every(o => o.status === 'CANCELLED')); assert.equal(tables.points_accounts.customer.frozen, 0); assert.equal(tables.points_accounts.customer.available, 100);
  // Late payment cannot revive cancelled appointments; each order gains durable refund intent.
  const late = await groupPayment.markGroupSuccess(result.groupId, { amountFen: result.paidFen, transactionId: 'late' });
  assert(late.shouldRefund); assert(Object.values(tables.orders).every(o => o.status === 'CANCELLED')); assert.equal(Object.keys(tables.refunds).length, 2);
  reset();
  const items = [payload('hand', '10'), payload('tips', '12')]; const beforeQuote = await cart.createCartQuote({ items });
  const taken = { orderId: 'other', startAt: items[1].startAt, endAt: items[1].startAt + 3600000, status: 'RESERVED' };
  tables.technician_days = { [`tech_${date}`]: { id: `tech_${date}`, technicianId: 'tech', date, shifts: [{ start: '00:00', end: '23:45', breaks: [] }], occupancies: [taken] } };
  await assert.rejects(cart.createCartOrder({ items: items.map((x, i) => ({ ...x, quoteId: beforeQuote.quotes[i].quoteId })), idempotencyKey: 'conflict' }), error => error.code === 'SLOT_TAKEN');
  assert.equal(Object.keys(tables.orders || {}).length, 0); assert.equal(Object.keys(tables.payments || {}).length, 0); assert.equal(tables.technician_days[`tech_${date}`].occupancies.length, 1);
  reset();
  tables.services.hand.priceFen = 0;
  ({ result } = await checkout([payload('hand', '10'), payload('tips', '12')]));
  assert(result.orders.every(o => o.status === 'PENDING_PAYMENT'));
  providerState = 'SUCCESS'; await payment.queryPayment(result.orders[0].id); assert(Object.values(tables.orders).every(o => o.status === 'RESERVED'));
  reset();
  tables.services.hand.priceFen = 0; tables.services.tips.priceFen = 0;
  ({ result } = await checkout([payload('hand', '10'), payload('tips', '12')])); assert.equal(result.paymentRequired, false); assert(result.orders.every(o => o.status === 'RESERVED'));
  // Storage is isolated by customer and duplicate draft additions replace rather than multiply.
  const storage = {}; const localModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/cart.js'), 'utf8'), { module: localModule, wx: { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; } } });
  const drafts = localModule.exports; drafts.add('one', { payload: items[0] }); drafts.add('one', { payload: items[0] }); assert.equal(drafts.list('one').length, 1); assert.equal(drafts.list('two').length, 0);
  // A stale server must never enable payment after silently ignoring boostCount.
  let pageDefinition;
  const quoteApi = { createQuote: async () => ({ quoteId: 'old', addons: [], totalFen: 5000, paidFen: 5000 }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/booking/index.js'), 'utf8'), {
    Page: page => { pageDefinition = page; }, console, setTimeout,
    require: ref => ref.endsWith('/api') ? quoteApi : ref.endsWith('/format') ? require('../utils/format') : {}
  });
  const page = { ...pageDefinition, workId: 'w', serviceId: 's', data: { ...pageDefinition.data, selectedSlotId: 'slot', selectedSlot: { startAt: 1 }, boostOption: {}, boostCount: 1 }, setData(changes) { Object.assign(this.data, changes); } };
  await page.refreshQuote(); assert.equal(page.data.canSubmit, false); assert.match(page.data.quoteError, /加油包计费尚未启用/); assert.equal(page.data.quote.quoteId, undefined);
  quoteApi.createQuote = async () => ({ quoteId: 'new', addons: [{ type: 'BOOST', quantity: 1, priceFen: 1000, durationMinutes: 10 }], totalFen: 6000, paidFen: 6000 });
  await page.refreshQuote(); assert.equal(page.data.canSubmit, true);
  console.log('cart booking tests passed: shared nail rules, boost price/duration, per-technician overlap, simultaneous multi-person checkout, standalone customer check, atomic rollback, idempotency, points allocation, one provider payment, grouped confirmation, independent refunds, close/late payment, zero-cash items, customer-isolated drafts');
})().catch(error => { console.error(error); process.exitCode = 1; });
