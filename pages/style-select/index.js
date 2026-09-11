const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: '',
    service: {},
    works: [],
    activeWorkId: ''
  },

  onLoad(options = {}) {
    const state = getApp().globalData;
    const selection = state.catalogSelection || {};
    this.categoryId = options.categoryId || '';
    this.serviceId = options.serviceId || '';
    this.activeWorkId = options.workId || (selection.serviceId === this.serviceId ? selection.workId : '') || '';
    state.catalogSelection = { ...selection, categoryId: this.categoryId, serviceId: this.serviceId, workId: this.activeWorkId };
    this.setData({ activeWorkId: this.activeWorkId });
    return this.loadStyles();
  },

  async loadStyles() {
    if (!this.serviceId) {
      this.setData({ loading: false, error: '小项目不存在' });
      return;
    }
    const hasData = this.data.service.id && this.data.works.length;
    this.setData({ loading: !hasData, error: '' });
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    try {
      const result = await api.listServiceStyles(this.serviceId);
      if (requestId !== this.requestId) return;
      const service = result.service;
      if (!service) throw new Error('小项目不存在或已下架');
      const works = (result.works || [])
        .map((item) => ({ ...item, serviceName: '' }));
      const state = getApp().globalData;
      const selection = state.catalogSelection || {};
      const activeWorkId = works.some((item) => item.id === this.activeWorkId) ? this.activeWorkId : '';
      state.catalogSelection = { ...selection, categoryId: service.categoryId || this.categoryId, serviceId: service.id, workId: activeWorkId };
      this.setData({
        loading: false,
        service: {
          ...service,
          priceText: formatMoney(service.priceFen, false),
          durationText: formatDuration(service.durationMinutes)
        },
        works,
        activeWorkId
      });
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.setData({ loading: false, error: hasData ? '' : (error.message || '加载失败') });
    }
  },

  handleWorkTap(event) {
    const work = event.detail?.work;
    const workId = work?.id;
    if (!workId) return;
    const state = getApp().globalData;
    state.catalogSelection = { ...(state.catalogSelection || {}), categoryId: this.data.service.categoryId || this.categoryId, serviceId: this.serviceId, workId };
    this.setData({ activeWorkId: workId });
    wx.navigateTo({ url: `/pages/work-detail/index?workId=${encodeURIComponent(workId)}` });
  }
});
