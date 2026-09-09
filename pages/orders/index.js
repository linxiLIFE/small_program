const api = require('../../utils/api');
const { ORDER_STATUS_LABELS } = require('../../utils/constants');
const { formatMoney, formatDateTime, formatDuration } = require('../../utils/format');

Page({
  data: {
    tabs: [
      { id: '', label: '全部' },
      { id: 'PENDING_PAYMENT', label: '待付款' },
      { id: 'RESERVED', label: '待到店' },
      { id: 'COMPLETED', label: '已完成' }
    ],
    activeStatus: '',
    orders: [],
    skeletons: [1, 2],
    loading: true
  },

  onLoad(options) {
    this.setData({ activeStatus: options.status || '' });
    this.loadOrders(options.status || '');
  },

  onShow() {
    if (this.hasLoaded) this.loadOrders(this.data.activeStatus);
  },

  async loadOrders(status) {
    this.setData({ loading: true });
    try {
      const result = await api.listOrders(status);
      const orders = (result.orders || []).map((item) => ({
        ...item,
        statusLabel: item.statusLabel || ORDER_STATUS_LABELS[item.status] || '处理中',
        timeLabel: item.startAtLabel || formatDateTime(item.startAt),
        totalText: formatMoney(item.totalFen),
        paidText: formatMoney(item.paidFen),
        durationText: formatDuration(item.durationMinutes)
      }));
      this.hasLoaded = true;
      this.setData({ orders, loading: false });
    } catch (error) {
      this.hasLoaded = true;
      this.setData({ orders: [], loading: false });
      wx.showToast({ title: error.message || '预约记录加载失败', icon: 'none' });
    }
  },

  selectTab(event) {
    const status = event.currentTarget.dataset.status || '';
    this.setData({ activeStatus: status });
    this.loadOrders(status);
  },

  openOrder(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?orderId=${event.currentTarget.dataset.id}` });
  },

  goBooking() {
    wx.switchTab({ url: '/pages/booking/index' });
  }
});
