const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

const NOTIFICATION_PROMPT_HIDE_KEY = 'notification-prompt-hide-until';
const NOTIFICATION_EVENTS = ['appointmentSuccess', 'arrivalReminder', 'noShowRefund'];
const ACCEPTED_SUBSCRIPTION_STATUSES = new Set(['accept', 'acceptWithAudio']);

function configuredNotificationEvents(settings) {
  const notifications = settings && settings.notifications;
  const templates = notifications && notifications.templates || {};
  return Object.keys(templates).filter((event) => templates[event] && templates[event].templateId);
}

Page({
  data: {
    loading: true, error: '',
    isDemo: false,
    store: {},
    categories: [],
    services: [],
    works: [],
    technicians: [], banners: [],
    notificationPrompt: {
      visible: false,
      loading: false,
      configuredCount: 0
    }
  },

  onShow() {
    this.loadHome();
    this.loadNotificationPrompt();
  },

  async loadNotificationPrompt() {
    const hiddenUntil = Number(wx.getStorageSync(NOTIFICATION_PROMPT_HIDE_KEY) || 0);
    if (hiddenUntil > Date.now()) return;
    try {
      const settings = await api.getSettings();
      const notifications = settings && settings.notifications || {};
      const configuredCount = configuredNotificationEvents(settings).length;
      if (getApp().globalData.isDemo || notifications.enabled === false || !configuredCount) {
        this.setData({ 'notificationPrompt.visible': false });
        return;
      }
      this.notificationSettings = settings;
      this.setData({
        'notificationPrompt.visible': true,
        'notificationPrompt.loading': false,
        'notificationPrompt.configuredCount': configuredCount
      });
    } catch (error) {
      // 授权入口不是首页主流程；配置接口暂不可用时不打扰顾客。
      this.setData({ 'notificationPrompt.visible': false });
    }
  },

  async enableNotifications() {
    if (this.data.notificationPrompt.loading) return;
    const settings = this.notificationSettings;
    if (!settings) {
      await this.loadNotificationPrompt();
      return;
    }
    this.setData({ 'notificationPrompt.loading': true });
    try {
      const result = await api.requestSubscriptionEvents(settings, NOTIFICATION_EVENTS);
      const statuses = Object.values(result.statuses || {});
      const accepted = statuses.filter((status) => ACCEPTED_SUBSCRIPTION_STATUSES.has(status)).length;
      if (accepted) {
        wx.removeStorageSync(NOTIFICATION_PROMPT_HIDE_KEY);
        this.setData({ 'notificationPrompt.visible': false, 'notificationPrompt.loading': false });
        wx.showToast({ title: `已开启 ${accepted} 项提醒`, icon: 'success' });
      } else {
        wx.setStorageSync(NOTIFICATION_PROMPT_HIDE_KEY, Date.now() + 24 * 60 * 60 * 1000);
        this.setData({ 'notificationPrompt.visible': false, 'notificationPrompt.loading': false });
        wx.showToast({ title: '你可以稍后在“我的”里开启', icon: 'none' });
      }
    } catch (error) {
      this.setData({ 'notificationPrompt.loading': false });
      wx.showToast({ title: '授权未完成，请稍后再试', icon: 'none' });
    }
  },

  hideNotificationPrompt() {
    wx.setStorageSync(NOTIFICATION_PROMPT_HIDE_KEY, Date.now() + 7 * 24 * 60 * 60 * 1000);
    this.setData({ 'notificationPrompt.visible': false });
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
      .map((item, index) => ({ ...item, lazy: index > 0 }));
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
