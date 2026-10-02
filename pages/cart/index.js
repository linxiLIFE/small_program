const api = require('../../utils/api');
const cart = require('../../utils/cart');
const { formatMoney, formatDateTimeRange, formatDuration } = require('../../utils/format');

Page({
  data: { loading: true, items: [], selectedCount: 0, quote: null, error: '', submitting: false, usePoints: false, profile: {}, pendingCheckout: false },
  async onShow() {
    this.visible = true;
    const request = (this.showRequest || 0) + 1;
    this.showRequest = request;
    try {
      const profile = (typeof api.getCachedProfile === 'function' && api.getCachedProfile()) || await api.getProfile();
      if (!this.visible || request !== this.showRequest) return;
      this.userId = profile.id;
      const items = cart.list(this.userId).map(item => ({ ...item, selected: true, totalText: formatMoney(item.totalFen), timeText: formatDateTimeRange(item.payload.startAt, item.endAt, item.durationMinutes), durationText: formatDuration(item.durationMinutes), addonText: (item.addons || []).map(x => x.name).join('、') }));
      this.checkoutAttempt = wx.getStorageSync(`cart-checkout:${this.userId}`) || null;
      cart.save(this.userId, cart.list(this.userId));
      this.setData({ loading: false, items, profile, selectedCount: items.length, pendingCheckout: !!this.checkoutAttempt });
      if (!this.checkoutAttempt) {
        this.scheduleQuote();
        api.getSettings().then(settings => {
          if (this.visible && request === this.showRequest) { this.pointsRule = settings.points; if (this.data.quote?.preview) this.previewQuote(); }
        }).catch(() => {});
      }
    } catch (error) { if (this.visible && request === this.showRequest) this.setData({ loading: false, error: error.message || '购物车加载失败' }); }
  },
  onHide() { this.visible = false; clearTimeout(this.quoteTimer); this.quoteRequest = (this.quoteRequest || 0) + 1; this.showRequest = (this.showRequest || 0) + 1; },
  chooseStyle() { wx.switchTab({ url: '/pages/services/index' }); },
  async toggleItem(event) {
    if (this.data.submitting || this.checkoutAttempt) return;
    const id = event.currentTarget.dataset.id;
    const items = this.data.items.map(item => item.id === id ? { ...item, selected: !item.selected } : item);
    this.setData({ items, selectedCount: items.filter(x => x.selected).length });
    this.scheduleQuote();
  },
  async togglePoints(event) {
    if (this.data.submitting || this.checkoutAttempt) return;
    this.setData({ usePoints: event.detail.value });
    this.scheduleQuote();
  },
  async removeItem(event) {
    if (this.data.submitting || this.checkoutAttempt) return;
    const id = event.currentTarget.dataset.id;
    cart.remove(this.userId, [id]);
    const items = this.data.items.filter(x => x.id !== id);
    this.setData({ items, selectedCount: items.filter(x => x.selected).length });
    this.scheduleQuote();
  },
  editItem(event) {
    if (this.data.submitting || this.checkoutAttempt) return;
    const item = this.data.items.find(x => x.id === event.currentTarget.dataset.id);
    if (!item) return;
    getApp().globalData.pendingBooking = { serviceId: item.payload.serviceId, workId: item.payload.workId, technicianId: item.payload.technicianId, cartItemId: item.id, cartDraft: item.payload };
    wx.switchTab({ url: '/pages/booking/index' });
  },
  previewQuote() {
    const selected = this.data.items.filter(item => item.selected);
    if (!selected.length) { this.setData({ quote: null }); return; }
    let remainingPoints = this.data.usePoints ? Number(this.data.profile.points || 0) : 0;
    let totalFen = 0, discountFen = 0, pointsToUse = 0;
    const rule = this.pointsRule;
    for (const item of selected) {
      const total = Number(item.totalFen || 0);
      const units = rule && rule.unit > 0 && rule.discountFen > 0
        ? Math.min(Math.floor(remainingPoints / rule.unit), Math.floor(Math.floor(total * rule.maxPercent / 100) / rule.discountFen)) : 0;
      const points = units * Number(rule?.unit || 0);
      totalFen += total; discountFen += units * Number(rule?.discountFen || 0); pointsToUse += points; remainingPoints -= points;
    }
    this.setData({ quote: { preview: true, totalFen, discountFen, paidFen: totalFen - discountFen, pointsToUse, totalText: formatMoney(totalFen), discountText: formatMoney(discountFen), paidText: formatMoney(totalFen - discountFen) } });
  },
  scheduleQuote() {
    clearTimeout(this.quoteTimer);
    this.quoteRequest = (this.quoteRequest || 0) + 1;
    this.setData({ error: '' });
    this.previewQuote();
    this.quoteTimer = setTimeout(() => { this.quoteTimer = null; this.refreshQuote({ preservePreview: true }); }, 200);
  },
  async refreshQuote({ preservePreview = false } = {}) {
    clearTimeout(this.quoteTimer);
    const request = (this.quoteRequest || 0) + 1;
    this.quoteRequest = request;
    const selected = this.data.items.filter(x => x.selected);
    this.setData({ ...(preservePreview ? {} : { quote: null }), error: '' });
    if (!selected.length) return null;
    try {
      const result = await api.createCartQuote({ items: selected.map(x => x.payload), pointsToUse: this.data.usePoints ? Number(this.data.profile.points || 0) : 0 });
      if (request !== this.quoteRequest) return null;
      const quote = { ...result, totalText: formatMoney(result.totalFen), discountText: formatMoney(result.discountFen), paidText: formatMoney(result.paidFen) };
      const quoteById = new Map(selected.map((item, index) => [item.id, result.quotes[index]]));
      const items = this.data.items.map(item => {
        const updated = quoteById.get(item.id);
        return updated ? { ...item, totalFen: updated.totalFen, durationMinutes: updated.durationMinutes, totalText: formatMoney(updated.totalFen), durationText: formatDuration(updated.durationMinutes), timeText: formatDateTimeRange(item.payload.startAt, item.payload.startAt + updated.durationMinutes * 60000, updated.durationMinutes) } : item;
      });
      this.setData({ quote, items });
      return quote;
    } catch (error) {
      if (request === this.quoteRequest) this.setData({ quote: null, error: error.message || '请重新选择预约时间' });
      return null;
    }
  },
  async checkout() {
    if (this.data.submitting || !this.checkoutAttempt && !this.data.selectedCount) return;
    if (!this.data.profile.phoneMasked && !this.data.profile.phone) { wx.showToast({ title: '请先在预约页授权手机号', icon: 'none' }); return; }
    this.setData({ submitting: true });
    let createdOrderId = '';
    try {
      // Subscription authorization stays in the user's button gesture.
      const settings = await api.getSettings();
      try { await api.requestSubscriptionEvents(settings, ['appointmentSuccess', 'arrivalReminder', 'noShowRefund']); } catch (error) { /* Booking can proceed without subscription permission. */ }
      if (!this.checkoutAttempt) {
        const previous = this.data.quote;
        const selected = this.data.items.filter(x => x.selected);
        const quote = await this.refreshQuote();
        if (!quote) return;
        if (previous && (previous.paidFen !== quote.paidFen || previous.totalFen !== quote.totalFen)) {
          wx.showModal({ title: '金额已更新', content: `当前合计 ${quote.paidText}，请核对后再次结算。`, showCancel: false });
          return;
        }
        const attempt = { ids: selected.map(x => x.id), payload: { items: selected.map((item, index) => ({ ...item.payload, quoteId: quote.quotes[index].quoteId, pointsToUse: quote.quotes[index].pointsToUse })), idempotencyKey: `cart-${Date.now()}-${Math.random().toString(36).slice(2, 12)}` } };
        // Persist before sending. A timeout retries this same request after reopening.
        wx.setStorageSync(`cart-checkout:${this.userId}`, attempt);
        this.checkoutAttempt = attempt;
        this.setData({ pendingCheckout: true });
      }
      wx.showLoading({ title: '检查预约时段' });
      const result = await api.createCartOrder(this.checkoutAttempt.payload);
      createdOrderId = (result.orders.find(x => x.paidFen > 0) || result.orders[0]).id;
      cart.remove(this.userId, this.checkoutAttempt.ids);
      wx.setStorageSync(`cart-checkout:${this.userId}`, null);
      this.checkoutAttempt = null;
      this.setData({ pendingCheckout: false });
      wx.hideLoading();
      const order = result.orders.find(x => x.paidFen > 0) || result.orders[0];
      if (!result.paymentRequired) { wx.navigateTo({ url: '/pages/orders/index' }); return; }
      const payment = await api.prepareCartPayment(result.groupId);
      if (!payment || !payment.configured || !payment.timeStamp) {
        wx.showModal({ title: '预约已保留', content: payment && payment.message || '请在订单中继续付款。', showCancel: false, success: () => wx.navigateTo({ url: `/pages/order-detail/index?orderId=${order.id}` }) });
        return;
      }
      await new Promise(resolve => wx.requestPayment({
        timeStamp: String(payment.timeStamp), nonceStr: payment.nonceStr, package: payment.package, signType: payment.signType || 'RSA', paySign: payment.paySign,
        success: async () => {
          let confirmed = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            try { const paymentResult = await api.queryCartPayment(result.groupId); if (['SUCCESS', 'CLOSED'].includes(paymentResult.status)) { confirmed = true; break; } } catch (error) { /* Server callback and jobs continue confirming. */ }
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
          }
          wx.navigateTo({ url: `/pages/order-detail/index?orderId=${order.id}${confirmed ? '' : '&paymentConfirming=1'}` }); resolve();
        },
        fail: () => { wx.navigateTo({ url: `/pages/order-detail/index?orderId=${order.id}&paymentConfirming=1` }); resolve(); }
      }));
    } catch (error) {
      if (!createdOrderId && this.checkoutAttempt && error.isBusinessError) {
        wx.setStorageSync(`cart-checkout:${this.userId}`, null);
        this.checkoutAttempt = null;
        this.setData({ pendingCheckout: false });
      }
      if (createdOrderId) {
        wx.showModal({ title: '预约已保留', content: '请在订单中查看支付状态或继续付款。', showCancel: false, success: () => wx.navigateTo({ url: `/pages/order-detail/index?orderId=${createdOrderId}` }) });
        return;
      }
      wx.showModal({ title: this.checkoutAttempt ? '结算结果待确认' : '结算未完成', content: this.checkoutAttempt ? '网络暂时不可用，请点击继续确认结算，避免重复下单。' : error.message || '请查看订单或重新选择预约时间', showCancel: false });
      this.setData({ error: error.message || '结算未完成' });
    } finally { wx.hideLoading(); this.setData({ submitting: false }); }
  }
});
