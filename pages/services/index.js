const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: {
    categories: [],
    services: [],
    works: [],
    skeletons: [1, 2, 3],
    activeCategoryId: '',
    loading: true,
    error: ''
  },

  onLoad(options) {
    this.pendingCategoryId = options.categoryId || '';
    this.loadServices();
  },

  onShow() {
    const pendingCategoryId = getApp().globalData.pendingServiceCategoryId;
    if (pendingCategoryId !== undefined) {
      delete getApp().globalData.pendingServiceCategoryId;
      this.setCategory(pendingCategoryId);
      return;
    }
    if (this.pendingCategoryId && this.data.categories.length) {
      this.setCategory(this.pendingCategoryId);
      this.pendingCategoryId = '';
    }
  },

  async loadServices(categoryId = this.data.activeCategoryId) {
    this.setData({ loading: true, error: '' });
    const result = await api.listServices(categoryId);
    const services = (result.services || []).map((item) => ({
      ...item,
      priceText: formatMoney(item.priceFen, false),
      durationText: formatDuration(item.durationMinutes)
    }));
    this.setData({
      categories: result.categories || [],
      services,
      works: result.works || [],
      activeCategoryId: categoryId,
      loading: false
    });
  },

  setCategory(categoryId) {
    const value = categoryId || '';
    this.loadServices(value);
  },

  handleCategoryTap(event) {
    this.setCategory(event.currentTarget.dataset.id || '');
  },

  handleServiceTap(event) {
    wx.navigateTo({ url: `/pages/service-detail/index?serviceId=${event.detail.service.id}` });
  },

  handleWorkTap(event) {
    wx.navigateTo({ url: `/pages/work-detail/index?workId=${event.detail.work.id}` });
  }
});
