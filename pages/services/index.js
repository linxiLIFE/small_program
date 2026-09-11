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
      const categories=result.categories||[], services=result.services||[];
      const project=services.find(item=>item.id===this.data.activeServiceId);
      const categoryId=project?.categoryId || (categories.some(c=>c.id===this.data.activeCategoryId)?this.data.activeCategoryId:categories[0]?.id||'');
      this.setData({ categories, services, works: result.works || [], activeCategoryId:categoryId, activeServiceId:project?.id || '', loading: false });
      this.filterWorks();
    } catch (error) { this.setData({ loading: false, error: '加载失败' }); }
  },
  filterWorks() {
    const { activeCategoryId, activeServiceId, services, works } = this.data;
    const filteredServices = services.filter(item => item.categoryId === activeCategoryId);
    const ids = new Set(filteredServices.map(item => item.id));
    this.setData({ filteredServices, visibleWorks: works.filter(item => ids.has(item.serviceId) && (!activeServiceId || item.serviceId === activeServiceId)) });
  },
  handleCategoryTap(event) { this.setData({ activeCategoryId: event.currentTarget.dataset.id || this.data.categories[0]?.id || '', activeServiceId: '' }); this.filterWorks(); },
  handleProjectTap(event) { this.setData({ activeServiceId: event.currentTarget.dataset.id || '' }); this.filterWorks(); },
  handleWorkTap(event) { wx.navigateTo({ url: `/pages/work-detail/index?workId=${encodeURIComponent(event.detail.work.id)}` }); }
});
