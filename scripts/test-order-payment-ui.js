const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let currentOrder;
const api = {
  getOrder: async () => currentOrder,
  queryPayment: async () => ({ status: 'UNKNOWN' }),
  clearCache() {}
};
let definition;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/order-detail/index.js'), 'utf8'), {
  require(name) {
    if (name === '../../utils/api') return api;
    if (name === '../../utils/constants') return { ORDER_STATUS_LABELS: {} };
    if (name === '../../utils/format') return {
      formatMoney: value => `¥${(Number(value || 0) / 100).toFixed(2)}`,
      formatDateTimeRange: () => '预约时间',
      formatCountdown: () => '05:00',
      formatDuration: value => `${value}分钟`
    };
    throw new Error(`unexpected require: ${name}`);
  },
  Page(value) { definition = value; },
  wx: { showToast() {}, showLoading() {}, hideLoading() {}, showModal() {}, requestPayment() {}, navigateBack() {} },
  console,
  Date,
  Promise,
  setTimeout,
  setInterval,
  clearInterval
});

function page() {
  const instance = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  instance.setData = function setData(changes, callback) {
    for (const [key, value] of Object.entries(changes)) {
      const parts = key.split('.');
      let target = this.data;
      for (let index = 0; index < parts.length - 1; index += 1) target = target[parts[index]] ||= {};
      target[parts[parts.length - 1]] = value;
    }
    if (callback) callback();
  };
  return instance;
}

(async () => {
  const loadFromRedirect = page();
  let resumed = 0;
  loadFromRedirect.resumePaymentConfirmation = async () => { resumed += 1; };
  loadFromRedirect.onLoad({ orderId: 'order-1', paymentConfirming: '1' });
  assert.strictEqual(resumed, 1);

  const resume = page();
  resume.data.paymentConfirming = true;
  resume.data.order = { id: 'order-1' };
  let loaded = 0;
  let confirmed = 0;
  resume.loadOrder = async () => { loaded += 1; };
  resume.confirmPaymentResult = async () => { confirmed += 1; };
  await resume.resumePaymentConfirmation();
  assert.strictEqual(loaded, 1);
  assert.strictEqual(confirmed, 1);

  currentOrder = {
    id: 'points-order',
    status: 'RESERVED',
    paymentStatus: 'SUCCESS',
    refundStatus: 'NOT_REQUIRED',
    paidFen: 0,
    totalFen: 1000,
    discountFen: 1000,
    pointsUsed: 20,
    durationMinutes: 60
  };
  const pointsPage = page();
  pointsPage.orderId = currentOrder.id;
  pointsPage.data.paymentConfirming = true;
  await pointsPage.loadOrder();
  assert.strictEqual(pointsPage.data.paymentConfirming, false);
  assert.strictEqual(pointsPage.data.order.paymentProgressLabel, '积分支付完成，无需微信支付');
  assert.strictEqual(pointsPage.data.order.paidLabel, '支付方式');
  assert.strictEqual(pointsPage.data.order.paidText, '积分支付');

  console.log('order payment UI tests passed: confirmation resumes and points-only orders are explicit');
})().catch(error => { console.error(error); process.exitCode = 1; });
