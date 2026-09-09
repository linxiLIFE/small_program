const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: { loading: true, work: {}, service: {}, technician: {} },

  onLoad(options) {
    this.workId = options.workId || '';
    this.loadDetail();
  },

  async loadDetail() {
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
  },

  startBooking() {
    wx.navigateTo({ url: `/pages/booking/index?serviceId=${this.data.service.id}&technicianId=${this.data.technician.id || ''}` });
  }
});
