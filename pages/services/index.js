const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: {
    categories: [],
    services: [],
    filteredServices: [],
    works: [],
    activeCategoryId: '',
    activeServiceId: '',
    loading: true,
    error: ''
  },

  onShow() {
    const state = getApp().globalData;
    const selection = state.catalogSelection || {};
    const hasPendingCategory = state.pendingServiceCategoryId !== undefined;
    const hasPendingService = state.pendingServiceId !== undefined;
    this.requestedCategoryId = hasPendingCategory
      ? state.pendingServiceCategoryId
      : (hasPendingService ? '' : (selection.categoryId || this.data.activeCategoryId));
    this.requestedServiceId = hasPendingService
      ? state.pendingServiceId
      : (hasPendingCategory ? '' : (selection.serviceId || this.data.activeServiceId));
    delete state.pendingServiceCategoryId;
    delete state.pendingServiceId;
    this.loadServices();
  },

  async loadServices() {
    const hasData = this.data.categories.length > 0;
    this.setData({ loading: !hasData, error: '' });
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    try {
      const result = await api.listServices();
      if (requestId !== this.requestId) return;
      const categories = result.categories || [];
      const works = result.works || [];
      const services = (result.services || []).map((item) => ({
        ...item,
        priceText: formatMoney(item.priceFen, false),
        durationText: formatDuration(item.durationMinutes),
        styleCount: Number(item.styleCount !== undefined ? item.styleCount : works.filter((work) => work.serviceId === item.id && work.published !== false).length)
      }));
      const requestedCategory = categories.find((item) => item.id === this.requestedCategoryId);
      const requestedService = services.find((item) => item.id === this.requestedServiceId);
      const activeCategoryId = requestedCategory?.id || requestedService?.categoryId || this.data.activeCategoryId || '';
      const activeServiceId = requestedService && requestedService.categoryId === activeCategoryId
        ? requestedService.id
        : (services.some((item) => item.id === this.data.activeServiceId && item.categoryId === activeCategoryId) ? this.data.activeServiceId : '');
      const categoryOptions = categories.map((category) => {
        const categoryServices = services.filter((service) => service.categoryId === category.id);
        return {
          ...category,
          serviceCount: categoryServices.length,
          styleCount: categoryServices.reduce((count, service) => count + service.styleCount, 0),
          serviceCountText: `${categoryServices.length} 个小项目`,
          styleCountText: `${categoryServices.reduce((count, service) => count + service.styleCount, 0)} 款式`
        };
      });
      const filteredServices = activeCategoryId ? services.filter((item) => item.categoryId === activeCategoryId) : [];
      this.setData({ categories: categoryOptions, services, works, activeCategoryId, activeServiceId, filteredServices, loading: false });
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.setData({ loading: false, error: hasData ? '' : '加载失败' });
    }
  },

  filterServices(categoryId = this.data.activeCategoryId) {
    const { services } = this.data;
    const filteredServices = categoryId ? services.filter((item) => item.categoryId === categoryId) : [];
    const activeServiceId = filteredServices.some((item) => item.id === this.data.activeServiceId) ? this.data.activeServiceId : '';
    this.setData({ filteredServices, activeServiceId });
  },

  handleCategoryTap(event) {
    const activeCategoryId = event.currentTarget.dataset.id || '';
    const state = getApp().globalData;
    state.catalogSelection = { ...(state.catalogSelection || {}), categoryId: activeCategoryId, serviceId: '', workId: '' };
    this.setData({ activeCategoryId, activeServiceId: '' });
    this.filterServices(activeCategoryId);
  },

  handleProjectTap(event) {
    const serviceId = event.detail?.service?.id || event.currentTarget.dataset.id || '';
    const service = this.data.services.find((item) => item.id === serviceId);
    if (!service) return;
    const state = getApp().globalData;
    state.catalogSelection = { ...(state.catalogSelection || {}), categoryId: service.categoryId, serviceId: service.id, workId: '' };
    this.setData({ activeServiceId: service.id });
    wx.navigateTo({ url: `/pages/style-select/index?categoryId=${encodeURIComponent(service.categoryId)}&serviceId=${encodeURIComponent(service.id)}` });
  }
});
