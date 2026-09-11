const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: {
    categories: [],
    services: [],
    filteredServices: [],
    works: [],
    activeCategoryId: '',
    loading: true,
    error: ''
  },

  onShow() {
    const state = getApp().globalData;
    this.requestedCategoryId = state.pendingServiceCategoryId !== undefined ? state.pendingServiceCategoryId : this.data.activeCategoryId;
    this.requestedServiceId = state.pendingServiceId !== undefined ? state.pendingServiceId : '';
    delete state.pendingServiceCategoryId;
    delete state.pendingServiceId;
    this.loadServices();
  },

  async loadServices() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.listServices();
    const categories = result.categories || [];
    const works = result.works || [];
      const services = (result.services || []).map((item) => ({
        ...item,
        priceText: formatMoney(item.priceFen, false),
        durationText: formatDuration(item.durationMinutes),
        styleCount: Number(item.styleCount !== undefined ? item.styleCount : works.filter((work) => work.serviceId === item.id && work.published !== false).length)
      }));
      const requestedCategory = categories.find((item) => item.id === this.requestedCategoryId);
      const activeCategoryId = requestedCategory?.id || services.find((item) => item.id === this.requestedServiceId)?.categoryId || '';
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
      this.setData({ categories: categoryOptions, services, works, activeCategoryId, loading: false });
      this.filterServices(activeCategoryId);
    } catch (error) { this.setData({ loading: false, error: '加载失败' }); }
  },

  filterServices(categoryId = this.data.activeCategoryId) {
    const { services } = this.data;
    const filteredServices = categoryId ? services.filter((item) => item.categoryId === categoryId) : [];
    this.setData({ filteredServices });
  },

  handleCategoryTap(event) {
    const activeCategoryId = event.currentTarget.dataset.id || '';
    this.setData({ activeCategoryId });
    this.filterServices(activeCategoryId);
  },

  handleProjectTap(event) {
    const serviceId = event.detail?.service?.id || event.currentTarget.dataset.id || '';
    const service = this.data.services.find((item) => item.id === serviceId);
    if (!service) return;
    wx.navigateTo({ url: `/pages/style-select/index?categoryId=${encodeURIComponent(service.categoryId)}&serviceId=${encodeURIComponent(service.id)}` });
  }
});
