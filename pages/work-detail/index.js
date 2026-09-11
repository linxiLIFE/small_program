const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: { loading: true, error: '', work: {}, service: {}, technician: {} },

  onLoad(options) {
    this.workId = options.workId || '';
    this.loadDetail();
  },

  async loadDetail() {
    this.setData({loading:true,error:''});
    try {
    const work = await api.getWork(this.workId);
    const [service, technicianResult] = await Promise.all([
      api.getService(work.serviceId),
      api.listTechnicians(work.serviceId)
    ]);
    const technician = (technicianResult.technicians || []).find((item) => item.id === work.technicianId) || (technicianResult.technicians || [])[0] || {};
    this.setData({
      loading: false,
      work,
      service: { ...service, priceText: formatMoney(service.priceFen, false), durationText: formatDuration(service.durationMinutes) },
      technician: { ...technician, initial: technician.name ? technician.name.slice(0, 1) : '师' }
    });
    } catch(error) { this.setData({loading:false,error:error.message||'加载失败'}); }
  },

  previewImage() { if(this.data.work.imageUrl)wx.previewImage({urls:[this.data.work.imageUrl]}); },
  startBooking() {
    getApp().globalData.pendingBooking = { serviceId: this.data.service.id, technicianId: this.data.technician.id || '', workId: this.data.work.id };
    wx.switchTab({ url: '/pages/booking/index' });
  }
});
