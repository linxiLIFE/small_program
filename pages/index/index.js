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

  onShow() {
    this.loadHome();
  },

  async loadHome() {
    this.setData({ loading: true });
    let result;
    try { result = await api.getHome(); }
    catch (error) { this.setData({ loading: false }); wx.showToast({ title: '加载失败', icon: 'none' }); return; }
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

  openProject(event) {
    getApp().globalData.pendingServiceId = event.currentTarget.dataset.id;
    wx.switchTab({ url: '/pages/services/index' });
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


});
