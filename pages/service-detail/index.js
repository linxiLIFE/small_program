const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: {
    loading: true,
    service: {},
    technicians: [],
    selectedTechnicianId: ''
  },

  onLoad(options) {
    this.serviceId = options.serviceId || '';
    this.loadDetail();
  },

  async loadDetail() {
    this.setData({ loading: true });
    const [service, technicianResult] = await Promise.all([
      api.getService(this.serviceId),
      api.listTechnicians(this.serviceId)
    ]);
    const normalized = {
      ...service,
      priceText: formatMoney(service.priceFen, false),
      durationText: formatDuration(service.durationMinutes),
      bufferText: service.bufferMinutes ? `含 ${service.bufferMinutes} 分钟整理时间` : ''
    };
    const technicians = (technicianResult.technicians || []).map((item, index) => ({
      ...item,
      selected: index === 0,
      initial: item.name ? item.name.slice(0, 1) : '师'
    }));
    this.setData({
      loading: false,
      service: normalized,
      technicians,
      selectedTechnicianId: technicians[0] ? technicians[0].id : ''
    });
  },

  selectTechnician(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({
      selectedTechnicianId: id,
      technicians: this.data.technicians.map((item) => ({ ...item, selected: item.id === id }))
    });
  },

  startBooking() {
    const query = [`serviceId=${this.data.service.id}`];
    if (this.data.selectedTechnicianId) query.push(`technicianId=${this.data.selectedTechnicianId}`);
    wx.navigateTo({ url: `/pages/booking/index?${query.join('&')}` });
  },

  goBack() {
    wx.navigateBack();
  }
});
