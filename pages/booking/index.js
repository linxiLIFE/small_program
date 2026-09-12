const api = require('../../utils/api');
const mock = require('../../utils/mock-data');
const { formatMoney, formatDuration, formatDateLabel, maskPhone } = require('../../utils/format');
const { showPhoneAuthFailure, phoneBindFailureMessage } = require('../../utils/phone-auth');
const { buildTimePeriods, decorateBookingTimeline, timeLabel } = require('../../utils/booking-time');

function loadBookingContext(serviceId, workId) {
  return Promise.all([
    api.getSettings(),
    api.getService(serviceId),
    api.listTechnicians(serviceId),
    api.getProfile(),
    api.getWork(workId)
  ]).then(([settings, service, technicianResult, profile, work]) => ({
    settings,
    service,
    technicians: technicianResult.technicians || [],
    profile,
    work
  }));
}

Page({
  data: {
    loading: true,
    service: {},
    work: null,
    technicians: [],
    dates: [],
    slots: [],
    timePeriods: [],
    timeline: {},
    timelineHasOptions: false,
    timelineTrackWidth: 0,
    timelineStartX: 0,
    timelineEndX: 0,
    timelineSelectionStyle: '',
    timelineSelectionLabel: '',
    selectedPeriodId: '',
    expandedPeriodId: '',
    selectedTechnicianId: '',
    selectedDate: '',
    selectedSlotId: '',
    selectedSlot: {},
    profile: {},
    usePoints: false,
    quote: {},
    submitting: false,
    canSubmit: false,
    pointHint: '',
    emptyImage: '',
    emptyCategory: ''
  },

  onLoad(options) {
    this.serviceId = options.serviceId || '';
    this.workId = options.workId || '';
    this.initialTechnicianId = options.technicianId || '';
    this.idempotencyKey = `booking-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.hasLoaded = false;
    this.loadingPromise = null;
  },

  onShow() {
    const state = getApp().globalData;
    const pending = state.pendingBooking;
    if (pending) {
      delete state.pendingBooking;
      const changed = this.serviceId !== pending.serviceId
        || this.workId !== (pending.workId || '')
        || this.initialTechnicianId !== (pending.technicianId || '');
      this.serviceId = pending.serviceId;
      this.workId = pending.workId || '';
      this.initialTechnicianId = pending.technicianId || '';
      this.idempotencyKey = `booking-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      if (changed || !this.hasLoaded) this.loadBooking({ force: changed });
    } else if (this.serviceId && this.workId) {
      if (!this.hasLoaded && !this.loadingPromise) this.loadBooking();
    } else if (!this.serviceId || !this.workId) {
      this.setData({ loading: false, service: {}, work: null, canSubmit: false });
      this.loadEmptyState();
    }
  },

  async loadEmptyState() {
    if (this.emptyStateLoaded) return;
    this.emptyStateLoaded = true;
    try {
      const result = await api.getHome();
      const image = (result.banners || []).find((item) => item.imageUrl)?.imageUrl
        || (result.categories || []).find((item) => item.coverUrl)?.coverUrl
        || '';
      const category = (result.categories || [])[0];
      this.setData({ emptyImage: image, emptyCategory: category ? category.name : '' });
    } catch (error) {
      // 空状态本身不应因为宣传图接口暂不可用而阻塞预约入口。
      this.setData({ emptyImage: '', emptyCategory: '' });
    }
  },

  chooseStyle() {
    if (this.serviceId && this.data.service.categoryId) {
      const state = getApp().globalData;
      state.catalogSelection = {
        ...(state.catalogSelection || {}),
        categoryId: this.data.service.categoryId,
        serviceId: this.serviceId,
        workId: this.workId
      };
      const workQuery = this.workId ? `&workId=${encodeURIComponent(this.workId)}` : '';
      wx.navigateTo({ url: `/pages/style-select/index?categoryId=${encodeURIComponent(this.data.service.categoryId)}&serviceId=${encodeURIComponent(this.serviceId)}${workQuery}` });
      return;
    }
    wx.switchTab({ url: '/pages/services/index' });
  },

  async loadBooking({ force = false } = {}) {
    if (!this.serviceId || !this.workId) return;
    if (this.loadingPromise && !force) return this.loadingPromise;
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    this.slotRequestId = (this.slotRequestId || 0) + 1;
    this.quoteRequestId = (this.quoteRequestId || 0) + 1;
    const bookingKey = `${this.serviceId}:${this.workId}:${this.initialTechnicianId}`;
    const preserveSelections = this.loadedKey === bookingKey;
    const hasData = !!this.data.service.id;
    this.setData({ loading: !hasData, canSubmit: false, quote: preserveSelections ? this.data.quote : {} });
    const previousDate = this.data.selectedDate;
    const previousSlotId = this.data.selectedSlotId;
    const previousTechnicianId = this.data.selectedTechnicianId;
    const request = (async () => {
    try {
      const context = typeof api.getBookingContext === 'function'
        ? await api.getBookingContext(this.serviceId, this.workId)
        : await loadBookingContext(this.serviceId, this.workId);
      const settings = context.settings || {};
      const service = context.service;
      const technicianResult = { technicians: context.technicians || [] };
      const profile = context.profile || {};
      const work = context.work;
      if (!service || !work || work.serviceId !== service.id) throw new Error('款式与小项目不匹配，请重新选择');
      const openDays = Math.max(1, Number(settings.booking?.openDays || 14));
      const dates = mock.getDates().slice(0, openDays);
      const technicians = (technicianResult.technicians || []).map((item) => ({
        ...item,
        initial: item.name ? item.name.slice(0, 1) : '师'
      }));
      const preferredTechnicianId = !preserveSelections && this.initialTechnicianId
        ? this.initialTechnicianId
        : previousTechnicianId;
      const selectedTechnicianId = technicians.find((item) => item.id === preferredTechnicianId)
        ? preferredTechnicianId
        : (technicians.find((item) => item.id === this.initialTechnicianId) || technicians[0] || {}).id || '';
      const selectedDate = dates.some((item) => item.value === previousDate)
        ? previousDate
        : (dates[0] ? dates[0].value : '');
      if (requestId !== this.requestId) return;
      this.bookingSettings = settings;
      const state = getApp().globalData;
      state.catalogSelection = { ...(state.catalogSelection || {}), categoryId: service.categoryId, serviceId: service.id, workId: work.id };
      this.setData({
        loading: false,
        work,
        service: { ...service, priceText: formatMoney(service.priceFen, false), durationText: formatDuration(service.durationMinutes) },
        technicians,
        dates,
        selectedDate,
        selectedTechnicianId,
        profile: { ...(profile || {}), phoneLabel: profile && (profile.phoneMasked || maskPhone(profile.phone)) }
      });
      this.loadedKey = bookingKey;
      this.hasLoaded = true;
      await this.loadSlots({ preserve: true, force: !preserveSelections, slotId: previousSlotId });
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.hasLoaded = false;
      this.setData({ loading: false, canSubmit: false, service: hasData ? this.data.service : {}, work: hasData ? this.data.work : null, technicians: hasData ? this.data.technicians : [], slots: hasData ? this.data.slots : [] });
      wx.showModal({ title: '预约页面暂不可用', content: error.message || '请先登录微信账号后重试。', showCancel: false });
    }
    })();
    this.loadingPromise = request;
    try {
      return await request;
    } finally {
      if (this.loadingPromise === request) this.loadingPromise = null;
    }
  },

  async loadSlots({ preserve = true, force = false, slotId = this.data.selectedSlotId } = {}) {
    if (!this.data.selectedTechnicianId || !this.data.selectedDate) return;
    if (!force && this.data.slots.length) {
      const timePeriods = buildTimePeriods(this.data.slots, this.bookingSettings?.booking?.slotStepMinutes, this.data.service.durationMinutes);
      const normalizedSlots = timePeriods.reduce((all, period) => all.concat(period.slots), []);
      const timeline = decorateBookingTimeline(this.data.timeline, normalizedSlots, this.data.service.durationMinutes, this.bookingSettings?.booking?.slotStepMinutes);
      const currentSlot = slotId
        ? normalizedSlots.find((item) => item.id === slotId && item.available !== false)
        : null;
      if (!slotId || currentSlot) {
        const currentPeriod = currentSlot && timePeriods.find((period) => period.slots.some((item) => item.id === currentSlot.id));
        const expandedPeriodId = timePeriods.some((period) => period.id === this.data.expandedPeriodId)
          ? this.data.expandedPeriodId
          : '';
        const selectedSlotId = currentSlot?.id || '';
        if (this.data.selectedSlotId !== selectedSlotId || !this.data.timePeriods.length) {
          this.setData({
            slots: normalizedSlots,
            timePeriods,
            timeline,
            timelineHasOptions: !!(timeline.availableSlots && timeline.availableSlots.length),
            selectedSlotId,
            selectedSlot: currentSlot || {},
            selectedPeriodId: currentPeriod?.id || '',
            expandedPeriodId
          });
        }
        this.updateTimelineSelection(currentSlot || timeline.availableSlots?.[0]);
        if (currentSlot && !this.data.quote.quoteId) await this.refreshQuote();
        return;
      }
    }
    const previousSlotId = preserve ? slotId : '';
    const requestId = (this.slotRequestId || 0) + 1;
    this.slotRequestId = requestId;
    this.setData({ slots: [], timePeriods: [], timeline: {}, timelineHasOptions: false, timelineTrackWidth: 0, timelineStartX: 0, timelineEndX: 0, timelineSelectionStyle: '', timelineSelectionLabel: '', selectedPeriodId: '', expandedPeriodId: '', selectedSlotId: '', selectedSlot: {}, quote: {}, canSubmit: false });
    try {
      const result = await api.getAvailableSlots({
        serviceId: this.serviceId,
        technicianId: this.data.selectedTechnicianId,
        date: this.data.selectedDate
      });
      if (requestId !== this.slotRequestId) return;
      const slots = result.slots || [];
      const timePeriods = buildTimePeriods(slots, result.stepMinutes || this.bookingSettings?.booking?.slotStepMinutes, this.data.service.durationMinutes);
      const normalizedSlots = timePeriods.reduce((all, period) => all.concat(period.slots), []);
      const timeline = decorateBookingTimeline(result.timeline, normalizedSlots, this.data.service.durationMinutes, result.stepMinutes || this.bookingSettings?.booking?.slotStepMinutes);
      const selectedSlot = normalizedSlots.find((item) => item.id === previousSlotId && item.available !== false) || {};
      const selectedPeriod = timePeriods.find((period) => period.slots.some((item) => item.id === selectedSlot.id));
      const previousExpandedPeriodId = preserve ? this.data.expandedPeriodId : '';
      const expandedPeriodId = timePeriods.some((period) => period.id === previousExpandedPeriodId)
        ? previousExpandedPeriodId
        : '';
      this.setData({
        slots: normalizedSlots,
        timePeriods,
        timeline,
        timelineHasOptions: !!(timeline.availableSlots && timeline.availableSlots.length),
        timelineTrackWidth: 0,
        timelineStartX: 0,
        timelineEndX: 0,
        timelineSelectionStyle: '',
        timelineSelectionLabel: '',
        selectedSlotId: selectedSlot.id || '',
        selectedSlot,
        selectedPeriodId: selectedPeriod?.id || '',
        expandedPeriodId
      });
      this.updateTimelineSelection(selectedSlot.id ? selectedSlot : timeline.availableSlots?.[0]);
      this.measureTimeline();
      if (selectedSlot.id) await this.refreshQuote();
    } catch(error) {
      if (requestId !== this.slotRequestId) return;
      this.setData({ canSubmit: false, slots: [], timeline: {}, timelineHasOptions: false, pointHint: error.message || '时段加载失败' });
      wx.showToast({ title: '时段加载失败，请重试', icon: 'none' });
    }
  },

  async selectTechnician(event) {
    this.setData({ selectedTechnicianId: event.currentTarget.dataset.id });
    await this.loadSlots({ preserve: false, force: true });
  },

  async selectDate(event) {
    this.setData({ selectedDate: event.currentTarget.dataset.date });
    await this.loadSlots({ preserve: false, force: true });
  },

  async selectPeriod(event) {
    const period = this.data.timePeriods.find((item) => item.id === event.currentTarget.dataset.id);
    if (!period) return;
    if (this.data.expandedPeriodId === period.id) {
      this.setData({ expandedPeriodId: '' });
      return;
    }
    this.setData({ expandedPeriodId: period.id });
  },

  async selectSlot(event) {
    const slot = this.data.slots.find((item) => item.id === event.currentTarget.dataset.id);
    if (!slot || slot.available === false) return;
    await this.applySelectedSlot(slot);
  },

  async applySelectedSlot(slot) {
    if (!slot || slot.available === false) return;
    const period = this.data.timePeriods.find((item) => item.slots.some((candidate) => candidate.id === slot.id));
    this.setData({ selectedSlotId: slot.id, selectedSlot: slot, selectedPeriodId: period?.id || '', expandedPeriodId: period?.id || '', quote: {}, canSubmit: false });
    this.updateTimelineSelection(slot);
    await this.refreshQuote();
  },

  updateTimelineSelection(slot) {
    const timeline = this.data.timeline || {};
    if (!slot || !timeline.startAt || !timeline.endAt) {
      this.setData({ timelineSelectionStyle: '', timelineSelectionLabel: '' });
      return;
    }
    const startAt = Number(slot.startAt);
    const endAt = Number(slot.endAt) > startAt ? Number(slot.endAt) : startAt + Number(this.data.service.durationMinutes || 60) * 60000;
    const range = Math.max(1, Number(timeline.endAt) - Number(timeline.startAt));
    const left = Math.max(0, Math.min(100, ((startAt - Number(timeline.startAt)) / range) * 100));
    const right = Math.max(left, Math.min(100, ((endAt - Number(timeline.startAt)) / range) * 100));
    const width = Math.max(1, this.data.timelineTrackWidth || 1);
    const handleWidth = 28;
    const startX = Math.max(0, Math.min(Math.max(0, width - handleWidth), (left / 100) * width - handleWidth / 2));
    const endX = Math.max(0, Math.min(Math.max(0, width - handleWidth), (right / 100) * width - handleWidth / 2));
    this.setData({
      timelineStartX: startX,
      timelineEndX: endX,
      timelineSelectionStyle: `left:${left}%;width:${Math.max(0, right - left)}%;`,
      timelineSelectionLabel: `${timeLabel(startAt)}—${timeLabel(endAt)}`
    });
  },

  measureTimeline() {
    if (typeof wx.createSelectorQuery !== 'function') return;
    wx.createSelectorQuery().select('#timeline-track').boundingClientRect((rect) => {
      if (!rect || !rect.width) return;
      this.setData({ timelineTrackWidth: rect.width });
      this.updateTimelineSelection(this.data.selectedSlot.id ? this.data.selectedSlot : this.data.timeline.availableSlots?.[0]);
    }).exec();
  },

  async handleTimelineChange(event) {
    const timeline = this.data.timeline || {};
    const availableSlots = timeline.availableSlots || [];
    if (!availableSlots.length || !timeline.startAt || !timeline.endAt) return;
    const width = Math.max(1, Number(this.data.timelineTrackWidth || 0));
    const handleWidth = 28;
    const x = Number(event.detail && event.detail.x || 0) + handleWidth / 2;
    const position = Number(timeline.startAt) + Math.max(0, Math.min(1, x / width)) * (Number(timeline.endAt) - Number(timeline.startAt));
    const edge = event.currentTarget.dataset.edge;
    const slot = availableSlots.reduce((closest, item) => {
      const target = edge === 'end' ? Number(item.endAt) : Number(item.startAt);
      if (!closest || Math.abs(target - position) < Math.abs(Number(closest.target) - position)) return { ...item, target };
      return closest;
    }, null);
    if (!slot) return;
    delete slot.target;
    await this.applySelectedSlot(slot);
  },

  async togglePoints(event) {
    this.setData({ usePoints: !!event.detail.value });
    await this.refreshQuote();
  },

  async refreshQuote() {
    if (!this.data.selectedSlotId) return;
    const requestId = (this.quoteRequestId || 0) + 1;
    this.quoteRequestId = requestId;
    this.setData({ canSubmit: false });
    try {
      const result = await api.createQuote({
        workId: this.workId,
        serviceId: this.serviceId,
        technicianId: this.data.selectedTechnicianId,
        startAt: this.data.selectedSlot.startAt,
        pointsToUse: this.data.usePoints ? Number(this.data.profile.points || 0) : 0
      });
      if (requestId !== this.quoteRequestId) return;
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
      if (requestId !== this.quoteRequestId) return;
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
        workId: this.workId,
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
      const message = error.code === 'SLOT_TAKEN' ? '这个服务时段刚被预约了，请换一个服务时段。' : (error.message || '预约暂时失败，请稍后重试');
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
  },

  noop() {}
});
