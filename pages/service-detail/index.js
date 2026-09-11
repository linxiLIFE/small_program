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
    this.setData({loading:true,error:''});
    try {
    this.setData({ loading: true });
    const service = await api.getService(this.serviceId);
    const normalized = {
      ...service,
      priceText: formatMoney(service.priceFen, false),
      durationText: formatDuration(service.durationMinutes),
      bufferText: service.bufferMinutes ? `含 ${service.bufferMinutes} 分钟整理时间` : ''
    };
    this.setData({
      loading: false,
      service: normalized,
    });
    } catch(error) { this.setData({loading:false,error:error.message||'加载失败'}); }
  },

  startBooking() {
    const service = this.data.service;
    wx.navigateTo({ url: `/pages/style-select/index?categoryId=${encodeURIComponent(service.categoryId)}&serviceId=${encodeURIComponent(service.id)}` });
  },

  goBack() {
    wx.navigateBack();
  }
});
