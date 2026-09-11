const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: {
    loading: true, error: '',
    isDemo: false,
    store: {},
    categories: [],
    services: [],
    works: [],
    technicians: [], banners: []
  },

  onShow() {
    this.loadHome();
  },

  async loadHome() {
    this.setData({ loading: true, error: '' });
    let result;
    try { result = await api.getHome(); }
    catch (error) { this.setData({ loading: false, error: error.message || '加载失败' }); return; }
    const services = (result.services || []).map((item) => ({
      ...item,
      priceText: formatMoney(item.priceFen, false),
      durationText: formatDuration(item.durationMinutes)
    }));
    const categories = (result.categories || []).map((category) => {
      const categoryServices = services.filter((service) => service.categoryId === category.id);
      const serviceCount = Number(category.serviceCount !== undefined ? category.serviceCount : categoryServices.length);
      const styleCount = Number(category.styleCount !== undefined ? category.styleCount : categoryServices.reduce((count, service) => count + Number(service.styleCount || 0), 0));
      return { ...category, serviceCount, styleCount, serviceCountText: `${serviceCount} 个小项目`, styleCountText: `${styleCount} 款式` };
    });
    const banners = (result.banners || []).filter((item) => item && item.imageUrl);
    const works = (result.works || []).map((work) => ({
      ...work,
      serviceName: work.serviceName || services.find((service) => service.id === work.serviceId)?.name || ''
    }));
    this.setData({
      loading: false,
      isDemo: !!getApp().globalData.isDemo,
      store: result.store || {},
      banners,
      categories,
      services,
      works,
      technicians: result.technicians || []
    });
  },

  previewBanner(event) {
    const urls = this.data.banners.map(item => item.imageUrl).filter(Boolean);
    if (urls.length) wx.previewImage({urls, current: urls[event.currentTarget.dataset.index]});
  },
  openLocation() {
    const store=this.data.store;
    if(store.latitude!==null && store.latitude!==undefined && store.longitude!==null && store.longitude!==undefined && Number.isFinite(Number(store.latitude)) && Number.isFinite(Number(store.longitude))) {
      wx.openLocation({latitude:Number(store.latitude),longitude:Number(store.longitude),name:store.storeName,address:store.address,scale:17,fail:()=>wx.showToast({title:'地图暂时无法打开',icon:'none'})});
    } else if(store.address) wx.setClipboardData({data:store.address});
  },
  openProject(event) {
    getApp().globalData.pendingServiceId = event.currentTarget.dataset.id;
    wx.switchTab({ url: '/pages/services/index' });
  },

  goServices() {
    wx.switchTab({ url: '/pages/services/index' });
  },

  handleCategoryTap(event) {
    const categoryId = event.currentTarget.dataset.id || '';
    getApp().globalData.pendingServiceCategoryId = categoryId;
    wx.switchTab({ url: '/pages/services/index' });
  },

  handleServiceTap(event) {
    const serviceId = event.detail.service.id;
    wx.navigateTo({ url: `/pages/service-detail/index?serviceId=${serviceId}` });
  },

  handleWorkTap(event) {
    const workId = event.detail.work.id;
    wx.navigateTo({ url: `/pages/work-detail/index?workId=${workId}` });
  },

  makePhoneCall() {
    if (!this.data.store.phone) return;
    wx.makePhoneCall({ phoneNumber: this.data.store.phone });
  },


});
