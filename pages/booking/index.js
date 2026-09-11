const api = require('../../utils/api');
const mock = require('../../utils/mock-data');
const { formatMoney, formatDuration, formatDateLabel, maskPhone } = require('../../utils/format');
const { showPhoneAuthFailure, phoneBindFailureMessage } = require('../../utils/phone-auth');

Page({
  data: {
    loading: true,
    service: {},
    technicians: [],
    dates: [],
    slots: [],
    selectedTechnicianId: '',
    selectedDate: '',
    selectedSlotId: '',
    selectedSlot: {},
    profile: {},
    usePoints: false,
    quote: {},
    submitting: false,
    canSubmit: false,
    pointHint: ''
  },

  onLoad(options) {
    this.serviceId = options.serviceId || '';
    this.initialTechnicianId = options.technicianId || '';
    this.idempotencyKey = `booking-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  },

  onShow() {
    const pending = getApp().globalData.pendingBooking;
    if (pending) {
      delete getApp().globalData.pendingBooking;
      this.serviceId = pending.serviceId; this.workId = pending.workId || ''; this.initialTechnicianId = pending.technicianId || '';
      this.idempotencyKey = `booking-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      this.setData({ loading: true, canSubmit: false, quote: {}, usePoints: false });
      this.loadBooking();
    } else if (!this.serviceId) { this.setData({ loading: false, service: {} }); }
  },

  chooseStyle() { wx.switchTab({ url: '/pages/services/index' }); },

  async loadBooking() {
    try {
      const settings = await api.getSettings();
      const dates = mock.getDates().slice(0, Number(settings.booking.openDays));
      this.bookingSettings = settings;
      const selectedDate = dates[0] ? dates[0].value : '';
      const [service, technicianResult, profile, work] = await Promise.all([
        api.getService(this.serviceId),
        api.listTechnicians(this.serviceId),
        api.getProfile(),
        this.workId ? api.getWork(this.workId) : Promise.resolve(null)
      ]);
      const technicians = (technicianResult.technicians || []).map((item) => ({
        ...item,
        initial: item.name ? item.name.slice(0, 1) : '师'
      }));
      const selectedTechnicianId = technicians.find((item) => item.id === this.initialTechnicianId)
        ? this.initialTechnicianId
        : (technicians[0] ? technicians[0].id : '');
      this.setData({
        loading: false,
        work,
        service: { ...service, priceText: formatMoney(service.priceFen, false), durationText: formatDuration(service.durationMinutes) },
        technicians,
        dates,
        selectedDate,
        selectedTechnicianId,
        profile: { ...profile, phoneLabel: profile.phoneMasked || maskPhone(profile.phone) }
      });
      await this.loadSlots();
    } catch (error) {
      this.setData({ loading: false, canSubmit: false, service: {}, technicians: [], slots: [] });
      wx.showModal({ title: '预约页面暂不可用', content: error.message || '请先登录微信账号后重试。', showCancel: false });
    }
  },

  async loadSlots() {
    if (!this.data.selectedTechnicianId || !this.data.selectedDate) return;
    this.setData({ slots: [], selectedSlotId: '', selectedSlot: {}, canSubmit: false });
    try {
    const result = await api.getAvailableSlots({
      serviceId: this.serviceId,
      technicianId: this.data.selectedTechnicianId,
      date: this.data.selectedDate
    });
    const slots = result.slots || [];
    this.setData({ slots });
    if (slots.length) {
      this.setData({ selectedSlotId: slots[0].id, selectedSlot: slots[0] });
      await this.refreshQuote();
    }
    } catch(error) { this.setData({canSubmit:false,slots:[],pointHint:error.message||'时段加载失败'});wx.showToast({title:'时段加载失败，请重试',icon:'none'}); }
  },

  async selectTechnician(event) {
    this.setData({ selectedTechnicianId: event.currentTarget.dataset.id });
    await this.loadSlots();
  },

  async selectDate(event) {
    this.setData({ selectedDate: event.currentTarget.dataset.date });
    await this.loadSlots();
  },

  async selectSlot(event) {
    const slot = this.data.slots.find((item) => item.id === event.currentTarget.dataset.id);
    if (!slot || slot.available === false) return;
    this.setData({ selectedSlotId: slot.id, selectedSlot: slot });
    await this.refreshQuote();
  },

  async togglePoints(event) {
    this.setData({ usePoints: !!event.detail.value });
    await this.refreshQuote();
  },

  async refreshQuote() {
    if (!this.data.selectedSlotId) return;
    try {
      const result = await api.createQuote({
        serviceId: this.serviceId,
        technicianId: this.data.selectedTechnicianId,
        startAt: this.data.selectedSlot.startAt,
        pointsToUse: this.data.usePoints ? Number(this.data.profile.points || 0) : 0
      });
      this.setData({
        quote: {
          ...result,
          totalText: formatMoney(result.totalFen || 0),
          discountText: formatMoney(result.discountFen || 0),
          paidText: formatMoney(result.paidFen || 0)
        },
        canSubmit: true,
        pointHint: result.pointsToUse ? `本单使用 ${result.pointsToUse} 积分，抵扣 ${formatMoney(result.discountFen)}` : `开启后按本单 ${this.bookingSettings?.points?.maxPercent || 0}% 上限抵扣`
      });
    } catch (error) {
      this.setData({ canSubmit: false, pointHint: error.message || '报价暂时不可用' });
    }
  },

  async handleGetPhoneNumber(event) {
    const detail = event.detail || {};
    const code = detail.code;
    console.info('[phone-auth] booking callback', { errMsg: detail.errMsg || '', errno: detail.errno || 0, hasCode: !!code });
    if (!code) return showPhoneAuthFailure(detail);
    wx.showLoading({ title: '绑定中' });
    try {
      const profile = await api.bindPhone(code);
      this.setData({ profile: { ...profile, phoneLabel: profile.phoneMasked || maskPhone(profile.phone) } });
      wx.showToast({ title: '手机号已绑定', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '手机号绑定失败', content: phoneBindFailureMessage(error), showCancel: false });
    } finally {
      wx.hideLoading();
    }
  },

  handleAgreePrivacyAuthorization() {
    console.info('[phone-auth] privacy authorization agreed');
  },

  async submitBooking() {
    if (!this.data.canSubmit || this.data.submitting) return;
    if (!this.data.profile.phone && !this.data.profile.phoneMasked) {
      wx.showToast({ title: '请先授权手机号', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '锁定时段中' });
    try {
      const result = await api.createOrder({
        workId: this.workId || '',
        serviceId: this.serviceId,
        technicianId: this.data.selectedTechnicianId,
        date: this.data.selectedDate,
        startAt: this.data.selectedSlot.startAt,
        quoteId: this.data.quote.quoteId,
        pointsToUse: this.data.quote.pointsToUse || 0,
        idempotencyKey: this.idempotencyKey,
        quote: this.data.quote
      });
      const order = result.order || result;
      wx.hideLoading();
      if (!result.paymentRequired || order.paidFen <= 0) {
        wx.redirectTo({ url: `/pages/order-detail/index?orderId=${order.id}` });
        return;
      }
      const payment = await api.preparePayment(order.id);
      if (!payment || !payment.configured || !payment.timeStamp) {
        wx.showModal({
          title: '订单已保留',
          content: (payment && payment.message) || '微信支付资质尚未配置，请在服务端补齐后再支付。',
          confirmText: '查看订单',
          cancelText: '留在此页',
          success: (modal) => {
            if (modal.confirm) wx.redirectTo({ url: `/pages/order-detail/index?orderId=${order.id}` });
          }
        });
        return;
      }
      await this.requestPayment(payment, order.id);
    } catch (error) {
      wx.hideLoading();
      const message = error.code === 'SLOT_TAKEN' ? '这个时间刚被预约了，请换一个时间。' : (error.message || '预约暂时失败，请稍后重试');
      wx.showModal({ title: '预约未完成', content: message, showCancel: false });
      await this.loadSlots();
    } finally {
      this.setData({ submitting: false });
    }
  },

  requestPayment(payment, orderId) {
    return new Promise((resolve) => {
      wx.requestPayment({
        timeStamp: String(payment.timeStamp),
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType || 'RSA',
        paySign: payment.paySign,
        success: async () => {
          wx.showLoading({ title: '确认支付中' });
          try { await api.queryPayment(orderId); } finally { wx.hideLoading(); }
          wx.redirectTo({ url: `/pages/order-detail/index?orderId=${orderId}` });
          resolve();
        },
        fail: (error) => {
          const cancelled = error && (error.errMsg || '').includes('cancel');
          wx.showModal({ title: cancelled ? '已取消支付' : '支付待确认', content: '订单仍会保留 5 分钟，你可以在订单详情中重新查询支付状态。', showCancel: false, success: () => wx.redirectTo({ url: `/pages/order-detail/index?orderId=${orderId}` }) });
          resolve();
        }
      });
    });
  },

  formatDate(event) {
    return formatDateLabel(event);
  }
});
