const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: '',
    work: {},
    service: {},
    technician: {},
    technicians: [],
    selectedTechnicianId: '',
    imageError: false
  },

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
      const technicians = (technicianResult.technicians || []).map((item) => ({
        ...item,
        initial: item.name ? item.name.slice(0, 1) : '师'
      }));
      const technician = technicians.find((item) => item.id === work.technicianId) || technicians[0] || {};
      const state = getApp().globalData;
      state.catalogSelection = { ...(state.catalogSelection || {}), categoryId: service.categoryId, serviceId: service.id, workId: work.id };
      this.setData({
        loading: false,
        work,
        imageError: false,
        service: { ...service, priceText: formatMoney(service.priceFen, false), durationText: formatDuration(service.durationMinutes) },
        technicians,
        selectedTechnicianId: technician.id || '',
        technician
      });
    } catch(error) {
      if (requestId !== this.requestId) return;
      this.setData({ loading: false, error: hasData ? '' : (error.message || '加载失败') });
    }
  },

  previewImage() { if(this.data.work.imageUrl && !this.data.imageError)wx.previewImage({urls:[this.data.work.imageUrl]}); },
  handleImageError() { this.setData({ imageError: true }); },
  selectTechnician(event) {
    const technicianId = event.currentTarget.dataset.id;
    const technician = this.data.technicians.find((item) => item.id === technicianId);
    if (!technician) return;
    this.setData({ selectedTechnicianId: technicianId, technician });
  },
  startBooking() {
    const state = getApp().globalData;
    state.catalogSelection = { ...(state.catalogSelection || {}), categoryId: this.data.service.categoryId, serviceId: this.data.service.id, workId: this.data.work.id };
    const selectedTechnician = this.data.technicians.find((item) => item.id === this.data.selectedTechnicianId) || this.data.technician || {};
    getApp().globalData.pendingBooking = { serviceId: this.data.service.id, technicianId: selectedTechnician.id || '', workId: this.data.work.id };
    wx.switchTab({ url: '/pages/booking/index' });
  }
});
