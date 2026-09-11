const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: {
    loading: true, error: '',
    service: {}
  },

  onLoad(options) {
    this.serviceId = options.serviceId || '';
    this.loadDetail();
  },

  async loadDetail() {
    const hasData = !!this.data.service.id;
    this.setData({ loading: !hasData, error: '' });
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    try {
      const service = await api.getService(this.serviceId);
      if (requestId !== this.requestId) return;
      const normalized = {
        ...service,
        priceText: formatMoney(service.priceFen, false),
        durationText: formatDuration(service.durationMinutes)
      };
      this.setData({ loading: false, service: normalized });
    } catch(error) {
      if (requestId !== this.requestId) return;
      this.setData({ loading: false, error: hasData ? '' : (error.message || '加载失败') });
    }
  },

  startBooking() {
    const service = this.data.service;
    wx.navigateTo({ url: `/pages/style-select/index?categoryId=${encodeURIComponent(service.categoryId)}&serviceId=${encodeURIComponent(service.id)}` });
  },

  goBack() {
    wx.navigateBack();
  }
});
