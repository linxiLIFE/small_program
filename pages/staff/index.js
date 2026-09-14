const api = require('../../utils/api');
const { ORDER_STATUS_LABELS, ROLE_LABELS } = require('../../utils/constants');
const { formatDateTimeRange } = require('../../utils/format');

Page({
  data: { loading: true, loadingMore:false, nextCursor:null, profile: {}, orders: [], skeletons: [1, 2], activeStatus: 'RESERVED', tabs: [{ id: 'RESERVED', label: '待到店' }, { id: 'NO_SHOW_REVIEW', label: '未到店复核' }, { id: 'ARRIVED', label: '已到店' }, { id: 'IN_SERVICE', label: '服务中' }] },

  onLoad() {
    this.loadStaff();
  },

  onShow() {
    if (this.hasLoaded) this.loadOrders(this.data.activeStatus);
  },

  async loadStaff() {
    try {
      const profile = await api.getProfile();
      this.setData({ profile: { ...profile, roleLabel: ROLE_LABELS[profile.role] || '顾客' } });
      await this.loadOrders(this.data.activeStatus);
    } catch (error) {
      this.setData({ loading: false, orders: [] });
      wx.showToast({ title: error.message || '工作台加载失败', icon: 'none' });
    }
  },

  async loadOrders(status, append=false) {
    const hasData = this.hasLoaded || this.data.orders.length > 0;
    this.setData({ loading: !append&&!hasData, loadingMore:append });
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    try {
      const result = await api.staffListOrders(status,append?Number(this.data.nextCursor||0):0,20);
      if (requestId !== this.requestId) return;
      const orders = (result.orders || []).map((item) => ({ ...item, statusLabel: item.statusLabel || ORDER_STATUS_LABELS[item.status] || '处理中', timeLabel: item.startAt ? formatDateTimeRange(item.startAt, item.endAt, item.durationMinutes) : item.startAtLabel || '待确定' }));
      this.hasLoaded = true;
      this.setData({ orders:append?this.data.orders.concat(orders):orders, nextCursor:result.nextCursor, loading: false, loadingMore:false });
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.hasLoaded = true;
      this.setData({ orders: hasData ? this.data.orders : [], loading: false, loadingMore:false });
      if (!hasData) wx.showToast({ title: error.message || '订单加载失败', icon: 'none' });
    }
  },

  selectTab(event) {
    const status = event.currentTarget.dataset.status;
    this.setData({ activeStatus: status });
    this.loadOrders(status);
  },

  loadMore(){if(this.data.loadingMore||this.data.nextCursor===null)return;this.loadOrders(this.data.activeStatus,true);},

  async scanCheckIn() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const scan = await new Promise((resolve, reject) => wx.scanCode({ onlyFromCamera: true, scanType: ['qrCode'], success: resolve, fail: reject }));
      wx.showLoading({ title: '核销中' });
      const result = await api.redeemCheckInCode(scan.result || '');
      const order = result.order || result;
      wx.hideLoading();
      wx.showModal({ title: '核销成功', content: `${order.customerName || '预约顾客'}\n${order.serviceName || ''}\n${order.startAtLabel || ''}`, showCancel: false });
      await this.loadOrders(this.data.activeStatus);
    } catch (error) {
      wx.hideLoading();
      const cancelled = String(error.errMsg || '').includes('cancel');
      if (!cancelled) wx.showModal({ title: '无法核销', content: error.message || '请确认二维码属于当前技师的有效预约', showCancel: false });
    } finally {
      this.scanning = false;
    }
  },

  async transition(event) {
    const { id, action } = event.currentTarget.dataset;
    wx.showLoading({ title: '更新中' });
    try {
      await api.staffTransition(id, action);
      wx.showToast({ title: '状态已更新', icon: 'success' });
      this.loadOrders(this.data.activeStatus);
    } catch (error) {
      wx.showToast({ title: error.message || '更新失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
