const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: {
    loading: true,
    isDemo: false,
    store: {},
    categories: [],
    services: [],
    works: [],
    technicians: []
  },

  onLoad() {
    this.loadHome();
  },

  async loadHome() {
    this.setData({ loading: true });
    const result = await api.getHome();
    const services = (result.services || []).map((item) => ({
      ...item,
      priceText: formatMoney(item.priceFen, false),
      durationText: formatDuration(item.durationMinutes)
    }));
    this.setData({
      loading: false,
      isDemo: !!getApp().globalData.isDemo,
      store: result.store || {},
      categories: result.categories || [],
      services,
      works: result.works || [],
      technicians: result.technicians || []
    });
  },

  goServices() {
    wx.switchTab({ url: '/pages/services/index' });
  },

  handleCategoryTap(event) {
    const categoryId = event.currentTarget.dataset.id || '';
    getApp().globalData.pendingServiceCategoryId = categoryId;
    wx.switchTab({ url: '/pages/services/index' });
  },

  handleServiceTap(event) {
    const serviceId = event.detail.service.id;
    wx.navigateTo({ url: `/pages/service-detail/index?serviceId=${serviceId}` });
  },

  handleWorkTap(event) {
    const workId = event.detail.work.id;
    wx.navigateTo({ url: `/pages/work-detail/index?workId=${workId}` });
  },

  makePhoneCall() {
    if (!this.data.store.phone) return;
    wx.makePhoneCall({ phoneNumber: this.data.store.phone });
  },

  showAddress() {
    wx.showModal({
      title: '到店提示',
      content: this.data.store.address || '预约成功后，店员会向你发送详细地址。',
      showCancel: false
    });
  }
});
