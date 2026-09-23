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
    const hasData = this.data.categories.length || this.data.banners.length || this.data.works.length || this.data.store.storeName;
    this.setData({ loading: !hasData, error: '' });
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    let result;
    try { result = await api.getHome(); }
    catch (error) {
      if (requestId !== this.requestId) return;
      this.setData({ loading: false, error: hasData ? '' : (error.message || '加载失败') });
      return;
    }
    if (requestId !== this.requestId) return;
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
    const banners = (result.banners || [])
      .filter((item) => item && item.imageUrl)
      .map((item, index) => ({ ...item, lazy: index > 0, imageError: false, imageFallbackAttempted: false }));
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
    const urls = this.data.banners.map(item => item.imageFallbackAttempted ? item.imageRemoteUrl : item.imageUrl).filter(Boolean);
    if (urls.length) wx.previewImage({urls, current: urls[event.currentTarget.dataset.index]});
  },
  handleBannerImageError(event) {
    const index = Number(event.currentTarget.dataset.index);
    const banner = this.data.banners[index];
    if (!banner) return;
    if (!banner.imageFallbackAttempted && banner.imageRemoteUrl && banner.imageRemoteUrl !== banner.imageUrl) {
      this.setData({ [`banners[${index}].imageFallbackAttempted`]: true });
      return;
    }
    this.setData({ [`banners[${index}].imageError`]: true });
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
    getApp().globalData.catalogSelection = { ...(getApp().globalData.catalogSelection || {}), categoryId, serviceId: '', workId: '' };
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
    const phoneNumber = String(this.data.store.phone || '').replace(/[^\d+]/g, '');
    if (!phoneNumber) {
      wx.showToast({ title: '门店暂未设置电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({ phoneNumber, fail: () => wx.showToast({ title: '拨号失败，请稍后重试', icon: 'none' }) });
  },


});
