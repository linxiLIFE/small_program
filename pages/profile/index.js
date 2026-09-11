const api = require('../../utils/api');
const { maskPhone } = require('../../utils/format');
const { showPhoneAuthFailure, phoneBindFailureMessage } = require('../../utils/phone-auth');

Page({
  data: { loading: true, profile: {}, isDemo: false },

  onLoad() {
    this.loadProfile();
  },

  onShow() {
    if (this.hasLoaded) this.loadProfile();
  },

  async loadProfile() {
    try {
      const profile = await api.getProfile();
      getApp().setUser(profile);
      this.hasLoaded = true;
      this.setData({
        loading: false,
        profile: { ...profile, phoneLabel: profile.phoneMasked || maskPhone(profile.phone) },
        isDemo: !!getApp().globalData.isDemo
      });
    } catch (error) {
      this.hasLoaded = true;
      this.setData({ loading: false, profile: {}, isDemo: false });
      wx.showToast({ title: error.message || '用户资料加载失败', icon: 'none' });
    }
  },

  openOrders() {
    wx.navigateTo({ url: '/pages/orders/index' });
  },

  openPoints() {
    wx.navigateTo({ url: '/pages/points/index' });
  },

  contactService() {
    if (this.data.profile.storePhone) wx.makePhoneCall({ phoneNumber: this.data.profile.storePhone });
    else wx.showModal({ title: '联系客服', content: '请在预约成功后通过订单联系门店。', showCancel: false });
  },

  privacy() {
    if (typeof wx.openPrivacyContract === 'function') {
      wx.openPrivacyContract({
        fail: () => wx.showModal({ title: '隐私与授权', content: '我们只在预约所必需的范围内使用微信身份、手机号和订单信息。敏感联系方式仅在服务端受控保存，不会写入前端日志。', showCancel: false })
      });
      return;
    }
    wx.showModal({ title: '隐私说明', content: '我们只在预约所必需的范围内使用微信身份、手机号和订单信息。敏感联系方式仅在服务端受控保存，不会写入前端日志。', showCancel: false });
  },

  async handleGetPhoneNumber(event) {
    const detail = event.detail || {};
    const code = detail.code;
    console.info('[phone-auth] profile callback', { errMsg: detail.errMsg || '', errno: detail.errno || 0, hasCode: !!code });
    if (!code) return showPhoneAuthFailure(detail);
    try {
      const profile = await api.bindPhone(code);
      getApp().setUser(profile);
      this.setData({ profile: { ...profile, phoneLabel: profile.phoneMasked || maskPhone(profile.phone) } });
      wx.showToast({ title: '绑定成功', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '手机号绑定失败', content: phoneBindFailureMessage(error), showCancel: false });
    }
  },

  handleAgreePrivacyAuthorization() {
    console.info('[phone-auth] privacy authorization agreed');
  }
});
