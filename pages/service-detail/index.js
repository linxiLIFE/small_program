const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');
const { STORE_NAME, createShareCard } = require('../../utils/share');

Page({
  data: {
    loading: true, error: '',
    service: {},
    coverImageError: false,
    coverFallbackAttempted: false
  },

  onLoad(options) {
    this.serviceId = options.serviceId || '';
    this.loadDetail();
  },

  onShareAppMessage() {
    const service = this.data.service;
    const serviceId = service.id || this.serviceId;
    if (!serviceId) return createShareCard(`选款预约｜${STORE_NAME}`, '/pages/services/index');
    const imageUrl = this.data.coverImageError ? '' : this.data.coverFallbackAttempted ? service.coverRemoteUrl : service.coverUrl;
    return createShareCard(`${service.name || '项目详情'}｜${STORE_NAME}`,
      `/pages/service-detail/index?serviceId=${encodeURIComponent(serviceId)}`, imageUrl);
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
      this.setData({ loading: false, service: normalized, coverImageError: false, coverFallbackAttempted: false });
    } catch(error) {
      if (requestId !== this.requestId) return;
      this.setData({ loading: false, error: hasData ? '' : (error.message || '加载失败') });
    }
  },

  startBooking() {
    const service = this.data.service;
    wx.navigateTo({ url: `/pages/style-select/index?categoryId=${encodeURIComponent(service.categoryId)}&serviceId=${encodeURIComponent(service.id)}` });
  },

  handleCoverImageError() {
    const remoteUrl = this.data.service.coverRemoteUrl;
    if (!this.data.coverFallbackAttempted && remoteUrl && remoteUrl !== this.data.service.coverUrl) {
      this.setData({ coverFallbackAttempted: true });
      return;
    }
    this.setData({ coverImageError: true });
  },

  goBack() {
    wx.navigateBack();
  }
});
