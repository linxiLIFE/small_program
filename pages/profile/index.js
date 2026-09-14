const api = require('../../utils/api');
const { maskPhone } = require('../../utils/format');
const { showPhoneAuthFailure, phoneBindFailureMessage } = require('../../utils/phone-auth');

const ORDER_SUMMARY_ITEMS = [
  { id: 'PENDING_PAYMENT', label: '待付款', icon: '¥' },
  { id: 'RESERVED', label: '待到店', icon: '⌖' },
  { id: 'ACTIVE_SERVICE', label: '服务中', icon: '✦' },
  { id: 'COMPLETED', label: '已完成', icon: '✓' }
];

function buildOrderSummary(orders) {
  const list = Array.isArray(orders) ? orders : [];
  return ORDER_SUMMARY_ITEMS.map((item) => ({
    ...item,
    count: list.filter((order) => (item.id === 'ACTIVE_SERVICE' ? ['ARRIVED', 'IN_SERVICE'].includes(order.status) : order.status === item.id)).length
  }));
}

Page({
  data: { loading: true, profile: {}, storePhone: '', settings: {}, inviteRewardPoints:10, isDemo: false, editingName: false, draftNickname: '', inviteDraft: '', bindingInvite: false, orderSummary: buildOrderSummary([]) },

  onLoad(options) {
    if (options && options.invite) this.setData({ inviteDraft: String(options.invite).toUpperCase() });
    this.loadProfile();
  },

  onShow() {
    if (this.hasLoaded) this.loadProfile();
  },

  async loadProfile() {
    try {
      const [profile, settings, orderResult] = await Promise.all([
        api.getProfile(),
        api.getSettings().catch(() => ({ store: {} })),
        api.listOrders().catch(() => ({ orders: [] }))
      ]);
      getApp().setUser(profile);
      this.hasLoaded = true;
      this.setData({
        loading: false,
        profile: { ...profile, phoneLabel: profile.phoneMasked || maskPhone(profile.phone) },
        settings,
        inviteRewardPoints:Number(settings && settings.points && settings.points.inviteRewardPoints || 10),
        storePhone: settings && settings.store ? settings.store.phone || '' : '',
        isDemo: !!getApp().globalData.isDemo,
        orderSummary: buildOrderSummary(orderResult && orderResult.orders)
      });
    } catch (error) {
      this.hasLoaded = true;
      this.setData({ loading: false, profile: {}, isDemo: false, orderSummary: buildOrderSummary([]) });
      wx.showToast({ title: error.message || '用户资料加载失败', icon: 'none' });
    }
  },

  openOrders() {
    wx.navigateTo({ url: '/pages/orders/index' });
  },

  openOrdersStatus(event) {
    const status = event.currentTarget.dataset.status || '';
    wx.navigateTo({ url: status ? `/pages/orders/index?status=${status}` : '/pages/orders/index' });
  },

  openPoints() {
    wx.navigateTo({ url: '/pages/points/index' });
  },

  inputInviteCode(event) {
    this.setData({ inviteDraft: String(event.detail.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) });
  },

  async bindInvite() {
    if (this.data.bindingInvite || !this.data.inviteDraft) return;
    this.setData({ bindingInvite: true });
    try {
      const result = await api.bindInviteCode(this.data.inviteDraft);
      this.setData({ profile: { ...result.profile, phoneLabel: result.profile.phoneMasked || '' }, inviteDraft: '' });
      wx.showModal({ title: '邀请绑定成功', content: `你和邀请人各获得 ${result.rewardPoints || 0} 积分`, showCancel: false });
    } catch (error) {
      wx.showToast({ title: error.message || '邀请码绑定失败', icon: 'none' });
    } finally {
      this.setData({ bindingInvite: false });
    }
  },

  copyInviteCode() {
    if (!this.data.profile.inviteCode) return;
    wx.setClipboardData({ data: this.data.profile.inviteCode });
  },

  async enableReminders() {
    try {
      const result = await api.requestSubscriptionEvents(this.data.settings, ['appointmentSuccess', 'arrivalReminder', 'noShowRefund']);
      const accepted = Object.values(result.statuses || {}).filter((status) => status === 'accept').length;
      wx.showToast({ title: accepted ? `已开启 ${accepted} 项提醒` : '未开启提醒', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: '提醒授权未完成', icon: 'none' });
    }
  },

  onShareAppMessage() {
    const code = this.data.profile.inviteCode || '';
    return { title: '一起预约四个小姐姐的店', path: `/pages/profile/index?invite=${encodeURIComponent(code)}` };
  },

  contactService() {
    const phoneNumber = String(this.data.storePhone || '').replace(/[^\d+]/g, '');
    if (!phoneNumber) {
      wx.showToast({ title: '门店暂未设置电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({ phoneNumber, fail: () => wx.showToast({ title: '拨号失败，请稍后重试', icon: 'none' }) });
  },

  editNickname() {
    this.setData({ editingName: true, draftNickname: this.data.profile.nickname || '' });
  },

  inputNickname(event) {
    this.setData({ draftNickname: event.detail.value || '' });
  },

  cancelNickname() {
    this.setData({ editingName: false, draftNickname: '' });
  },

  async saveNickname() {
    const nickname = String(this.data.draftNickname || '').trim();
    if (!nickname || nickname.length > 20) {
      wx.showToast({ title: '用户名需填写 1 到 20 个字符', icon: 'none' });
      return;
    }
    try {
      const profile = await api.updateProfile(nickname);
      getApp().setUser(profile);
      this.setData({ editingName: false, draftNickname: '', profile: { ...profile, phoneLabel: profile.phoneMasked || maskPhone(profile.phone) } });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    }
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
