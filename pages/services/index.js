const api = require('../../utils/api');
Page({
  data: { categories: [], services: [], works: [], visibleWorks: [], activeCategoryId: '', activeServiceId: '', loading: true, error: '' },
  onShow() {
    const state = getApp().globalData;
    if (state.pendingServiceCategoryId !== undefined || state.pendingServiceId !== undefined) {
      this.setData({ activeCategoryId: state.pendingServiceCategoryId || '', activeServiceId: state.pendingServiceId || '' });
      delete state.pendingServiceCategoryId; delete state.pendingServiceId;
      this.filterWorks();
    }
    this.loadServices();
  },
  async loadServices() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.listServices();
      this.setData({ categories: result.categories || [], services: result.services || [], works: result.works || [], loading: false });
      this.filterWorks();
    } catch (error) { this.setData({ loading: false, error: '加载失败' }); }
  },
  filterWorks() {
    const { activeCategoryId, activeServiceId, services, works } = this.data;
    const filteredServices = services.filter(item => !activeCategoryId || item.categoryId === activeCategoryId);
    const ids = new Set(filteredServices.map(item => item.id));
    this.setData({ filteredServices, visibleWorks: works.filter(item => ids.has(item.serviceId) && (!activeServiceId || item.serviceId === activeServiceId)) });
  },
  handleCategoryTap(event) { this.setData({ activeCategoryId: event.currentTarget.dataset.id || '', activeServiceId: '' }); this.filterWorks(); },
  handleProjectTap(event) { this.setData({ activeServiceId: event.currentTarget.dataset.id || '' }); this.filterWorks(); },
  handleWorkTap(event) { wx.navigateTo({ url: `/pages/work-detail/index?workId=${encodeURIComponent(event.detail.work.id)}` }); }
});
