const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: { loading: true, error: '', work: {}, service: {}, technician: {} },

  onLoad(options) {
    this.workId = options.workId || '';
    const state = getApp().globalData;
    state.catalogSelection = { ...(state.catalogSelection || {}), workId: this.workId };
    this.loadDetail();
  },

  async loadDetail() {
    const hasData = !!this.data.work.id;
    this.setData({ loading: !hasData, error: '' });
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    try {
      const work = await api.getWork(this.workId);
      const [service, technicianResult] = await Promise.all([
        api.getService(work.serviceId),
        api.listTechnicians(work.serviceId)
      ]);
      if (requestId !== this.requestId) return;
      const technician = (technicianResult.technicians || []).find((item) => item.id === work.technicianId) || (technicianResult.technicians || [])[0] || {};
      const state = getApp().globalData;
      state.catalogSelection = { ...(state.catalogSelection || {}), categoryId: service.categoryId, serviceId: service.id, workId: work.id };
      this.setData({
        loading: false,
        work,
        service: { ...service, priceText: formatMoney(service.priceFen, false), durationText: formatDuration(service.durationMinutes) },
        technician: { ...technician, initial: technician.name ? technician.name.slice(0, 1) : '师' }
      });
    } catch(error) {
      if (requestId !== this.requestId) return;
      this.setData({ loading: false, error: hasData ? '' : (error.message || '加载失败') });
    }
  },

  previewImage() { if(this.data.work.imageUrl)wx.previewImage({urls:[this.data.work.imageUrl]}); },
  startBooking() {
    const state = getApp().globalData;
    state.catalogSelection = { ...(state.catalogSelection || {}), categoryId: this.data.service.categoryId, serviceId: this.data.service.id, workId: this.data.work.id };
    getApp().globalData.pendingBooking = { serviceId: this.data.service.id, technicianId: this.data.technician.id || '', workId: this.data.work.id };
    wx.switchTab({ url: '/pages/booking/index' });
  }
});
