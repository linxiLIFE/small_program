const api = require('../../utils/api');
const { ORDER_STATUS_LABELS } = require('../../utils/constants');
const { formatMoney, formatDateTimeRange, formatCountdown, formatDuration } = require('../../utils/format');

const PAYMENT_HOLD_MS = 5 * 60 * 1000;

function getPaymentDeadline(order) {
  if (!order || order.status !== 'PENDING_PAYMENT') return 0;
  const deadline = Number(order.deadline || order.paymentDeadline || 0);
  if (Number.isFinite(deadline) && deadline > 0) return deadline;
  const createdAt = Number(order.createdAt || 0);
  return createdAt > 0 ? createdAt + PAYMENT_HOLD_MS : 0;
}

function getCountdownFields(order, now = Date.now()) {
  const paymentDeadline = getPaymentDeadline(order);
  if (!paymentDeadline) return { paymentDeadline: 0, countdownText: '', countdownUrgent: false };
  const remaining = paymentDeadline - now;
  return {
    paymentDeadline,
    countdownText: formatCountdown(remaining),
    countdownUrgent: remaining <= 60 * 1000
  };
}

function amountLabel(order) {
  if (order.status === 'PENDING_PAYMENT') return '待支付';
  const refund = { INIT:'退款待提交', PENDING_CONFIG:'退款待配置', SUBMITTING:'退款提交中', PROCESSING:'退款处理中', SUCCESS:'已退款', RETRY_REQUIRED:'退款待重试', WAITING_FUNDS:'退款待充值', CONFIG_OR_DATA_ERROR:'退款配置异常', MANUAL_ACTION:'退款待人工处理', CLOSED:'退款已关闭', ABNORMAL:'退款异常' };
  return refund[order.refundStatus] || '实付';
}

Page({
  data: {
    tabs: [
      { id: '', label: '全部' },
      { id: 'PENDING_PAYMENT', label: '待付款' },
      { id: 'RESERVED', label: '待到店' },
      { id: 'ACTIVE_SERVICE', label: '进行中' },
      { id: 'COMPLETED', label: '已完成' },
      { id: 'CANCELLED', label: '已取消' }
    ],
    activeStatus: '',
    orders: [],
    skeletons: [1, 2],
    loading: true,
    loadingMore: false,
    nextCursor: null
  },

  onLoad(options) {
    this.setData({ activeStatus: options.status || '' });
    this.loadOrders(options.status || '');
  },

  onShow() {
    if (this.hasLoaded) this.loadOrders(this.data.activeStatus);
  },

  onHide() {
    this.stopCountdown();
  },

  onUnload() {
    this.destroyed = true;
    this.stopCountdown();
  },

  async loadOrders(status, append = false) {
    const hasData = this.hasLoaded || this.data.orders.length > 0;
    this.setData({ loading: !append && !hasData, loadingMore: append });
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    try {
      const statusGroups = {
        ACTIVE_SERVICE: ['ARRIVED', 'IN_SERVICE'],
        CANCELLED: ['CANCELLED', 'CANCELLED_BY_USER', 'CANCELLED_NO_SHOW', 'CANCEL_PENDING_REFUND', 'REFUNDED']
      };
      const requestedStatus = statusGroups[status] || status;
      const result = await api.listOrders(requestedStatus, append ? Number(this.data.nextCursor || 0) : 0, 20);
      if (requestId !== this.requestId) return;
      const orders = (result.orders || []).map((item) => ({
        ...item,
        ...getCountdownFields(item),
        statusLabel: item.statusLabel || ORDER_STATUS_LABELS[item.status] || '处理中',
        styleTitle: item.work && item.work.title !== item.serviceName ? item.work.title : '',
        timeLabel: item.startAt ? formatDateTimeRange(item.startAt, item.endAt, item.durationMinutes) : item.startAtLabel || '待确定',
        totalText: formatMoney(item.totalFen),
        paidText: formatMoney(item.paidFen),
        durationText: formatDuration(item.durationMinutes),
        addonLabel: (item.addons || []).map((addon) => addon.name).join(' · '),
        imageError: false,
        technicianLabel: item.technicianName || '待安排',
        amountLabel: amountLabel(item)
      }));
      this.hasLoaded = true;
      const combined = append ? this.data.orders.concat(orders) : orders;
      this.setData({ orders: combined, nextCursor: result.nextCursor, loading: false, loadingMore: false });
      this.startCountdown();
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.hasLoaded = true;
      this.setData({ orders: hasData ? this.data.orders : [], loading: false, loadingMore: false });
      if (!hasData) wx.showToast({ title: error.message || '预约记录加载失败', icon: 'none' });
    }
  },

  selectTab(event) {
    const status = event.currentTarget.dataset.status || '';
    this.setData({ activeStatus: status });
    this.loadOrders(status);
  },

  handleImageError(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.orders.findIndex((item) => item.id === id);
    if (index >= 0) this.setData({ [`orders[${index}].imageError`]: true });
  },

  loadMore() {
    if (this.data.loadingMore || this.data.nextCursor === null) return;
    this.loadOrders(this.data.activeStatus, true);
  },

  openOrder(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?orderId=${event.currentTarget.dataset.id}` });
  },

  startCountdown() {
    this.stopCountdown();
    if (this.destroyed || !this.data.orders.some((item) => item.status === 'PENDING_PAYMENT' && item.paymentDeadline)) return;
    this.refreshCountdowns();
    this.countdownTimer = setInterval(() => this.refreshCountdowns(), 1000);
  },

  stopCountdown() {
    if (!this.countdownTimer) return;
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  },

  refreshCountdowns() {
    if (this.destroyed) return;
    const now = Date.now();
    const expiredIds = [];
    const orders = this.data.orders.map((item) => {
      if (item.status !== 'PENDING_PAYMENT' || !item.paymentDeadline) return item;
      const remaining = Number(item.paymentDeadline) - now;
      if (remaining <= 0) expiredIds.push(item.id);
      return {
        ...item,
        countdownText: formatCountdown(remaining),
        countdownUrgent: remaining <= 60 * 1000
      };
    });
    this.setData({ orders });
    if (expiredIds.length) this.reconcileExpiredOrders(expiredIds);
  },

  async reconcileExpiredOrders(orderIds) {
    if (this.reconcilingExpired || Date.now() < (this.nextExpireCheckAt || 0)) return;
    this.reconcilingExpired = true;
    try {
      await Promise.all(orderIds.map((orderId) => api.queryPayment(orderId).catch((error) => {
        console.warn('订单超时状态刷新失败', { orderId, message: error.message });
      })));
      if (this.destroyed) return;
      api.clearCache('listOrders');
      await this.loadOrders(this.data.activeStatus);
    } finally {
      this.nextExpireCheckAt = Date.now() + 5000;
      this.reconcilingExpired = false;
    }
  },

  goBooking() {
    wx.switchTab({ url: '/pages/booking/index' });
  }
});
