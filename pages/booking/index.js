const api = require('../../utils/api');
const mock = require('../../utils/mock-data');
const { formatMoney, formatDuration, formatDateLabel, maskPhone } = require('../../utils/format');
const { showPhoneAuthFailure, phoneBindFailureMessage } = require('../../utils/phone-auth');
const { buildTimePeriods, decorateBookingTimeline, timeLabel } = require('../../utils/booking-time');

const TIMELINE_STEP_MINUTES = 15;
const TIMELINE_HANDLE_WIDTH_PX = 28;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function decorateSelectedAddon(item) {
  const typeLabel = item.type === 'REMOVAL' ? '卸甲' : item.type === 'TIP' ? '加甲片' : '建构';
  return {
    ...item,
    typeLabel,
    detailText: item.type === 'TIP' ? `${Number(item.quantity || 0)} 个 · 不增加时长` : `+${Number(item.durationMinutes || 0)} 分钟`,
    priceText: formatMoney(item.priceFen || 0, false)
  };
}

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
    timelineDragging: false,
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
    emptyImageRemoteUrl: '',
    emptyImageError: false,
    emptyImageFallbackAttempted: false,
    emptyCategory: '',
    refundRuleText: '',
    noShowRuleText: '',
    isNailBooking: false,
    showsAddonStep: false,
    showsRemovalChoice: false,
    removalBadgeText: '',
    requiresBuilderChoice: false,
    removalOptions: [],
    builderOptions: [],
    selectedRemovalId: '',
    selectedBuilderId: '',
    supportsFootTipAddon: false,
    footTipOption: null,
    selectedFootTipChoice: '',
    selectedFootTipCount: 0,
    footTipTotalText: '0.00',
    addonStepTitle: '卸甲 / 建构',
    addonIncompleteText: '先选卸甲和建构',
    addonsReady: true,
    selectedAddons: [],
    workImageError: false,
    workImageFallbackAttempted: false
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
      const banner = (result.banners || []).find((item) => item.imageUrl);
      const categoryWithCover = (result.categories || []).find((item) => item.coverUrl);
      const image = banner ? banner.imageUrl : categoryWithCover ? categoryWithCover.coverUrl : '';
      const imageRemoteUrl = banner ? banner.imageRemoteUrl || '' : categoryWithCover ? categoryWithCover.coverRemoteUrl || '' : '';
      const category = (result.categories || [])[0];
      this.setData({ emptyImage: image, emptyImageRemoteUrl: imageRemoteUrl, emptyImageError: false, emptyImageFallbackAttempted: false, emptyCategory: category ? category.name : '' });
    } catch (error) {
      // 空状态本身不应因为宣传图接口暂不可用而阻塞预约入口。
      this.setData({ emptyImage: '', emptyImageRemoteUrl: '', emptyImageError: false, emptyImageFallbackAttempted: false, emptyCategory: '' });
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

  handleWorkImageError() {
    const remoteUrl = this.data.work && this.data.work.imageRemoteUrl;
    if (!this.data.workImageFallbackAttempted && remoteUrl && remoteUrl !== this.data.work.imageUrl) {
      this.setData({ workImageFallbackAttempted: true });
      return;
    }
    this.setData({ workImageError: true });
  },

  handleEmptyImageError() {
    if (!this.data.emptyImageFallbackAttempted && this.data.emptyImageRemoteUrl && this.data.emptyImageRemoteUrl !== this.data.emptyImage) {
      this.setData({ emptyImageFallbackAttempted: true });
      return;
    }
    this.setData({ emptyImageError: true });
  },

  handleTechnicianAvatarError(event) {
    const index = this.data.technicians.findIndex((item) => item.id === event.currentTarget.dataset.id);
    if (index < 0) return;
    const technician = this.data.technicians[index];
    if (!technician.avatarFallbackAttempted && technician.avatarRemoteUrl && technician.avatarRemoteUrl !== technician.avatarUrl) {
      this.setData({ [`technicians[${index}].avatarFallbackAttempted`]: true });
      return;
    }
    this.setData({ [`technicians[${index}].avatarError`]: true });
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
      const dates = mock.getDates(openDays);
      const technicians = (technicianResult.technicians || []).map((item) => ({
        ...item,
        avatarError: false,
        avatarFallbackAttempted: false,
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
      const addonType = String(service.addonType || '').toUpperCase();
      const expectsFootTipAddon = service.categoryId === 'foot-nail'
        && !service.isAddon
        && /本甲/.test([service.name, ...(Array.isArray(service.tags) ? service.tags : [])].join(''));
      const isNailBooking = ['nail', 'foot-nail'].includes(service.categoryId);
      const showsRemovalChoice = service.categoryId === 'nail' && addonType !== 'REMOVAL';
      const requiresBuilderChoice = showsRemovalChoice && addonType !== 'BUILDER' && !/建构/.test(String(service.name || ''));
      const expectsAddonStep = showsRemovalChoice || expectsFootTipAddon;
      const decorateAddon = (item) => ({
        ...item,
        priceText: Number(item.priceFen || 0) === 0 ? '免费' : `¥${formatMoney(item.priceFen, false)}`,
        durationText: `+${formatDuration(item.durationMinutes)}`
      });
      let addonContext = context.addons || { removals: [], builders: [] };
      const addonsIncomplete = showsRemovalChoice && (!(addonContext.removals || []).length
        || requiresBuilderChoice && !(addonContext.builders || []).length)
        || expectsFootTipAddon && !addonContext.footTip;
      if (expectsAddonStep && addonsIncomplete && typeof api.listBookingAddons === 'function') {
        addonContext = await api.listBookingAddons(service.categoryId, service.id);
      }
      const removalOptions = showsRemovalChoice ? (addonContext.removals || []).map((item) => decorateAddon(item)) : [];
      const builderOptions = requiresBuilderChoice ? (addonContext.builders || []).map((item) => decorateAddon(item)) : [];
      const footTipOption = expectsFootTipAddon ? addonContext.footTip : null;
      if (showsRemovalChoice && (!removalOptions.length || (requiresBuilderChoice && !builderOptions.length)) || (expectsFootTipAddon && !footTipOption)) {
        throw new Error('预约加项未加载完整，请刷新后重试');
      }
      const selectedRemovalId = showsRemovalChoice ? (preserveSelections ? this.data.selectedRemovalId : '') : 'none';
      const selectedBuilderId = requiresBuilderChoice
        ? (preserveSelections ? this.data.selectedBuilderId : '')
        : 'none';
      const supportsFootTipAddon = !!footTipOption;
      const showsAddonStep = showsRemovalChoice || supportsFootTipAddon;
      const removalBadgeText = Number(service.priceFen || 0) > 3000
        ? '三种卸甲均免费'
        : Number(service.priceFen || 0) === 3000
          ? '仅卸本甲免费'
          : '卸甲按所选方式收费';
      const selectedFootTipChoice = supportsFootTipAddon ? (preserveSelections ? this.data.selectedFootTipChoice : '') : 'none';
      const selectedFootTipCount = selectedFootTipChoice === 'add'
        ? Math.min(Number(footTipOption.maxQuantity || 10), Math.max(1, Number(this.data.selectedFootTipCount || 1)))
        : 0;
      const selectedAddons = [
        removalOptions.find((item) => item.id === selectedRemovalId),
        builderOptions.find((item) => item.id === selectedBuilderId),
        selectedFootTipChoice === 'add' ? decorateSelectedAddon({ ...footTipOption, quantity: selectedFootTipCount, priceFen: Number(footTipOption.unitPriceFen || 500) * selectedFootTipCount }) : null
      ].filter(Boolean).map((item) => item.typeLabel ? item : decorateSelectedAddon(item));
      const addonsReady = (!showsRemovalChoice || !!selectedRemovalId
        && (!requiresBuilderChoice || !!selectedBuilderId))
        && (!supportsFootTipAddon || !!selectedFootTipChoice);
      const addonStepTitle = supportsFootTipAddon && !showsRemovalChoice ? '加脚甲片' : (requiresBuilderChoice ? '卸甲 / 建构' : '卸甲');
      const addonIncompleteText = supportsFootTipAddon && !showsRemovalChoice ? '请选择是否需要加脚甲片' : (requiresBuilderChoice ? '先选卸甲和建构' : '先选卸甲');
      const state = getApp().globalData;
      state.catalogSelection = { ...(state.catalogSelection || {}), categoryId: service.categoryId, serviceId: service.id, workId: work.id };
      this.setData({
        loading: false,
        work,
        workImageError: false,
        workImageFallbackAttempted: false,
        service: { ...service, baseDurationMinutes: service.durationMinutes, priceText: formatMoney(service.priceFen, false), durationText: formatDuration(service.durationMinutes) },
        technicians,
        dates,
        selectedDate,
        selectedTechnicianId,
        profile: { ...(profile || {}), phoneLabel: profile && (profile.phoneMasked || maskPhone(profile.phone)) },
        isNailBooking,
        showsAddonStep,
        showsRemovalChoice,
        removalBadgeText,
        requiresBuilderChoice,
        removalOptions,
        builderOptions,
        selectedRemovalId,
        selectedBuilderId,
        supportsFootTipAddon,
        footTipOption,
        selectedFootTipChoice,
        selectedFootTipCount,
        footTipTotalText: formatMoney(Number(footTipOption && footTipOption.unitPriceFen || 0) * selectedFootTipCount, false),
        addonStepTitle,
        addonIncompleteText,
        addonsReady,
        selectedAddons,
        refundRuleText: `距预约开始不足 ${Number(settings.booking?.refundCutoffMinutes || 120)} 分钟不能自行取消或退款`,
        noShowRuleText: `开始后 ${Number(settings.booking?.noShowGraceMinutes || 15)} 分钟仍未核销，将扣除 ${formatMoney(Number(settings.booking?.noShowPenaltyFen || 3000))}；订单金额不足该费用时不退款，积分抵扣部分优先扣除`
      });
      this.loadedKey = bookingKey;
      this.hasLoaded = true;
      if (addonsReady) await this.loadSlots({ preserve: true, force: !preserveSelections, slotId: previousSlotId });
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
    if (!this.data.selectedTechnicianId || !this.data.selectedDate || !this.data.addonsReady) return;
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
    this.setData({ slots: [], timePeriods: [], timeline: {}, timelineHasOptions: false, timelineTrackWidth: 0, timelineStartX: 0, timelineEndX: 0, timelineSelectionStyle: '', timelineSelectionLabel: '', timelineDragging: false, selectedPeriodId: '', expandedPeriodId: '', selectedSlotId: '', selectedSlot: {}, quote: {}, canSubmit: false });
    try {
      const result = await api.getAvailableSlots({
        serviceId: this.serviceId,
        technicianId: this.data.selectedTechnicianId,
        date: this.data.selectedDate,
        ...this.addonPayload()
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
        timelineDragging: false,
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

  addonPayload() {
    const payload = {
      addonSelectionConfirmed: !this.data.showsRemovalChoice || this.data.addonsReady,
      removalServiceId: this.data.showsRemovalChoice && this.data.selectedRemovalId && this.data.selectedRemovalId !== 'none' ? this.data.selectedRemovalId : '',
      builderServiceId: this.data.requiresBuilderChoice && this.data.selectedBuilderId && this.data.selectedBuilderId !== 'none' ? this.data.selectedBuilderId : ''
    };
    if (this.data.supportsFootTipAddon) {
      payload.footTipSelectionConfirmed = !!this.data.selectedFootTipChoice;
      payload.footTipCount = this.data.selectedFootTipChoice === 'add' ? Number(this.data.selectedFootTipCount || 0) : 0;
    }
    return payload;
  },

  async selectAddon(event) {
    const type = event.currentTarget.dataset.type;
    const id = event.currentTarget.dataset.id || 'none';
    const changes = type === 'removal' ? { selectedRemovalId: id } : { selectedBuilderId: id };
    await this.applyAddonSelection(changes);
  },

  async selectFootTipChoice(event) {
    const choice = event.currentTarget.dataset.choice === 'add' ? 'add' : 'none';
    await this.applyAddonSelection({ selectedFootTipChoice: choice, selectedFootTipCount: choice === 'add' ? Math.max(1, Number(this.data.selectedFootTipCount || 1)) : 0 });
  },

  async changeFootTipCount(event) {
    if (this.data.selectedFootTipChoice !== 'add') return;
    const delta = Number(event.currentTarget.dataset.delta || 0);
    const maxQuantity = Number(this.data.footTipOption && this.data.footTipOption.maxQuantity || 10);
    const count = Math.min(maxQuantity, Math.max(1, Number(this.data.selectedFootTipCount || 1) + delta));
    if (count === this.data.selectedFootTipCount) return;
    await this.applyAddonSelection({ selectedFootTipCount: count });
  },

  async applyAddonSelection(changes = {}) {
    const selectedRemovalId = changes.selectedRemovalId !== undefined ? changes.selectedRemovalId : this.data.selectedRemovalId;
    const selectedBuilderId = changes.selectedBuilderId !== undefined ? changes.selectedBuilderId : this.data.selectedBuilderId;
    const selectedFootTipChoice = changes.selectedFootTipChoice !== undefined ? changes.selectedFootTipChoice : this.data.selectedFootTipChoice;
    const selectedFootTipCount = changes.selectedFootTipCount !== undefined ? changes.selectedFootTipCount : this.data.selectedFootTipCount;
    const footTipAddon = this.data.supportsFootTipAddon && selectedFootTipChoice === 'add'
      ? decorateSelectedAddon({
        ...this.data.footTipOption,
        quantity: selectedFootTipCount,
        priceFen: Number(this.data.footTipOption.unitPriceFen || 500) * selectedFootTipCount
      })
      : null;
    const selectedAddons = [
      this.data.removalOptions.find((item) => item.id === selectedRemovalId),
      this.data.builderOptions.find((item) => item.id === selectedBuilderId),
      footTipAddon
    ].filter(Boolean).map((item) => item.typeLabel ? item : decorateSelectedAddon(item));
    const totalDuration = Number(this.data.service.baseDurationMinutes || this.data.service.durationMinutes || 0)
      + selectedAddons.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0);
    const addonsReady = (!this.data.showsRemovalChoice || !!selectedRemovalId
      && (!this.data.requiresBuilderChoice || !!selectedBuilderId))
      && (!this.data.supportsFootTipAddon || !!selectedFootTipChoice);
    this.setData({
      ...changes,
      addonsReady,
      selectedAddons,
      footTipTotalText: formatMoney(Number(this.data.footTipOption && this.data.footTipOption.unitPriceFen || 0) * (selectedFootTipChoice === 'add' ? selectedFootTipCount : 0), false),
      service: { ...this.data.service, durationMinutes: totalDuration, durationText: formatDuration(totalDuration) },
      slots: [], timePeriods: [], timeline: {}, timelineHasOptions: false,
      selectedSlotId: '', selectedSlot: {}, quote: {}, canSubmit: false
    });
    if (addonsReady) await this.loadSlots({ preserve: false, force: true });
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
    this.setData({ selectedSlotId: slot.id, selectedSlot: slot, selectedPeriodId: period?.id || '', expandedPeriodId: period?.id || '', timelineDragging: false, quote: {}, canSubmit: false });
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
    this.updateTimelineSelectionRange(startAt, endAt);
  },

  updateTimelineSelectionRange(startAtValue, endAtValue, dragging, labelStartAtValue = startAtValue, labelEndAtValue = endAtValue) {
    const timeline = this.data.timeline || {};
    const timelineStart = Number(timeline.startAt);
    const timelineEnd = Number(timeline.endAt);
    if (!Number.isFinite(timelineStart) || !Number.isFinite(timelineEnd) || timelineEnd <= timelineStart) return;
    const startAt = Math.max(timelineStart, Math.min(timelineEnd, Number(startAtValue)));
    const endAt = Math.max(startAt, Math.min(timelineEnd, Number(endAtValue)));
    const range = Math.max(1, Number(timeline.endAt) - Number(timeline.startAt));
    const left = Math.max(0, Math.min(100, ((startAt - Number(timeline.startAt)) / range) * 100));
    const right = Math.max(left, Math.min(100, ((endAt - Number(timeline.startAt)) / range) * 100));
    const labelStartAt = Number.isFinite(Number(labelStartAtValue)) ? Number(labelStartAtValue) : startAt;
    const labelEndAt = Number.isFinite(Number(labelEndAtValue)) ? Number(labelEndAtValue) : endAt;
    const width = Number(this.data.timelineTrackWidth || 0);
    const handleWidth = TIMELINE_HANDLE_WIDTH_PX;
    const changes = {
      timelineSelectionStyle: `left:${left}%;width:${Math.max(0, right - left)}%;`,
      timelineSelectionLabel: `${timeLabel(labelStartAt)}—${timeLabel(labelEndAt)}`
    };
    if (width > 0) {
      const startX = (left / 100) * width - handleWidth / 2;
      const endX = (right / 100) * width - handleWidth / 2;
      const minHandleX = -handleWidth / 2;
      const maxHandleX = Math.max(minHandleX, width - handleWidth / 2);
      changes.timelineStartX = Math.max(minHandleX, Math.min(maxHandleX, startX));
      changes.timelineEndX = Math.max(minHandleX, Math.min(maxHandleX, endX));
    }
    if (typeof dragging === 'boolean') changes.timelineDragging = dragging;
    this.setData(changes);
  },

  measureTimeline() {
    if (typeof wx.createSelectorQuery !== 'function') return;
    wx.createSelectorQuery().select('#timeline-track').boundingClientRect((rect) => {
      if (!rect || !rect.width) return;
      this.setData({ timelineTrackWidth: rect.width });
      this.updateTimelineSelection(this.data.selectedSlot.id ? this.data.selectedSlot : this.data.timeline.availableSlots?.[0]);
    }).exec();
  },

  timelineRangeFromX(edge, value, snapToStep = false) {
    const timeline = this.data.timeline || {};
    const timelineStart = Number(timeline.startAt);
    const timelineEnd = Number(timeline.endAt);
    const width = Number(this.data.timelineTrackWidth || 0);
    if (!width || !Number.isFinite(timelineStart) || !Number.isFinite(timelineEnd) || timelineEnd <= timelineStart) return null;
    const handleWidth = TIMELINE_HANDLE_WIDTH_PX;
    const rawHandleX = Number(value);
    const handleX = Number.isFinite(rawHandleX) ? rawHandleX : 0;
    const x = Math.max(0, Math.min(width, handleX + handleWidth / 2));
    const rawPosition = timelineStart + (x / width) * (timelineEnd - timelineStart);
    const step = TIMELINE_STEP_MINUTES * 60 * 1000;
    const steppedPosition = timelineStart + Math.round((rawPosition - timelineStart) / step) * step;
    const snappedPosition = rawPosition <= timelineStart + step / 2
      ? timelineStart
      : rawPosition >= timelineEnd - step / 2
        ? timelineEnd
        : Math.max(timelineStart, Math.min(timelineEnd, steppedPosition));
    const position = snapToStep ? snappedPosition : rawPosition;
    const duration = Math.min(Math.max(1, Number(this.data.service.durationMinutes || timeline.durationMinutes || 60)) * 60000, timelineEnd - timelineStart);
    if (edge === 'end') {
      const endAt = Math.max(timelineStart + duration, Math.min(timelineEnd, position));
      return { startAt: endAt - duration, endAt };
    }
    const startAt = Math.max(timelineStart, Math.min(timelineEnd - duration, position));
    return { startAt, endAt: startAt + duration };
  },

  getTimelineTouchX(event) {
    const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
    if (!touch) return null;
    const value = touch.clientX !== undefined ? touch.clientX : touch.pageX;
    const x = Number(value);
    return Number.isFinite(x) ? x : null;
  },

  handleTimelineTouchStart(event) {
    const timeline = this.data.timeline || {};
    const availableSlots = timeline.availableSlots || [];
    if (!availableSlots.length || !timeline.startAt || !timeline.endAt) return;
    const edge = event.currentTarget.dataset.edge;
    const touchX = this.getTimelineTouchX(event);
    const width = Number(this.data.timelineTrackWidth || 0);
    if (!edge || touchX === null) return;
    if (!width) {
      this.measureTimeline();
      return;
    }
    const handleX = edge === 'end' ? Number(this.data.timelineEndX) : Number(this.data.timelineStartX);
    this.timelineTouch = { edge, startTouchX: touchX, startHandleX: handleX, lastHandleX: handleX };
    this.timelineDraggingEdge = edge;
    const range = this.timelineRangeFromX(edge, handleX);
    const snappedRange = this.timelineRangeFromX(edge, handleX, true);
    if (range) this.updateTimelineSelectionRange(range.startAt, range.endAt, true, snappedRange?.startAt, snappedRange?.endAt);
  },

  handleTimelineTouchMove(event) {
    const touchState = this.timelineTouch;
    if (!touchState) return;
    const touchX = this.getTimelineTouchX(event);
    const width = Number(this.data.timelineTrackWidth || 0);
    if (touchX === null || !width) return;
    const minHandleX = -TIMELINE_HANDLE_WIDTH_PX / 2;
    const maxHandleX = Math.max(minHandleX, width - TIMELINE_HANDLE_WIDTH_PX / 2);
    const handleX = Math.max(minHandleX, Math.min(maxHandleX, touchState.startHandleX + touchX - touchState.startTouchX));
    touchState.lastHandleX = handleX;
    const range = this.timelineRangeFromX(touchState.edge, handleX);
    const snappedRange = this.timelineRangeFromX(touchState.edge, handleX, true);
    if (!range) return;
    const now = Date.now();
    if (now - Number(this.lastTimelinePaintAt || 0) < 32) return;
    this.lastTimelinePaintAt = now;
    this.updateTimelineSelectionRange(range.startAt, range.endAt, true, snappedRange?.startAt, snappedRange?.endAt);
  },

  async handleTimelineTouchEnd(event) {
    const touchState = this.timelineTouch;
    if (!touchState) return;
    const timeline = this.data.timeline || {};
    const availableSlots = timeline.availableSlots || [];
    if (!availableSlots.length) {
      this.timelineTouch = null;
      this.timelineDraggingEdge = '';
      this.setData({ timelineDragging: false });
      return;
    }
    const touchX = this.getTimelineTouchX(event);
    const width = Number(this.data.timelineTrackWidth || 0);
    const minHandleX = -TIMELINE_HANDLE_WIDTH_PX / 2;
    const maxHandleX = Math.max(minHandleX, width - TIMELINE_HANDLE_WIDTH_PX / 2);
    let handleX = touchState.lastHandleX;
    if (touchX !== null && width) {
      handleX = Math.max(minHandleX, Math.min(maxHandleX, touchState.startHandleX + touchX - touchState.startTouchX));
    }
    const range = this.timelineRangeFromX(touchState.edge, handleX, true);
    this.timelineTouch = null;
    this.timelineDraggingEdge = '';
    if (!range) {
      this.setData({ timelineDragging: false });
      return;
    }
    this.updateTimelineSelectionRange(range.startAt, range.endAt, false);
    const position = touchState.edge === 'end' ? range.endAt : range.startAt;
    const slot = availableSlots.reduce((closest, item) => {
      const target = touchState.edge === 'end' ? Number(item.endAt) : Number(item.startAt);
      if (!closest || Math.abs(target - position) < Math.abs(Number(closest.target) - position)) return { ...item, target };
      return closest;
    }, null);
    if (!slot) {
      this.setData({ timelineDragging: false });
      return;
    }
    delete slot.target;
    await this.applySelectedSlot(slot);
  },

  handleTimelineTouchCancel() {
    if (!this.timelineTouch) return;
    this.timelineTouch = null;
    this.timelineDraggingEdge = '';
    this.setData({ timelineDragging: false });
    this.updateTimelineSelection(this.data.selectedSlot.id ? this.data.selectedSlot : this.data.timeline.availableSlots?.[0]);
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
        date: this.data.selectedDate,
        startAt: this.data.selectedSlot.startAt,
        pointsToUse: this.data.usePoints ? Number(this.data.profile.points || 0) : 0,
        ...this.addonPayload()
      });
      if (requestId !== this.quoteRequestId) return;
      this.setData({
        quote: {
          ...result,
          totalText: formatMoney(result.totalFen || 0),
          discountText: formatMoney(result.discountFen || 0),
          paidText: formatMoney(result.paidFen || 0)
        },
        selectedAddons: (result.addons || this.data.selectedAddons).map(decorateSelectedAddon),
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
    try {
      // 订阅消息必须紧跟用户点击触发，不能等创建订单和准备支付完成后再申请。
      // 这样全积分、0 元预约也会获得本次预约对应的通知额度。
      await this.requestBookingReminders();
      wx.showLoading({ title: '锁定时段中' });
      const requestFingerprint = JSON.stringify({
        workId: this.workId,
        serviceId: this.serviceId,
        technicianId: this.data.selectedTechnicianId,
        date: this.data.selectedDate,
        startAt: Number(this.data.selectedSlot.startAt),
        quoteId: this.data.quote.quoteId,
        pointsToUse: Number(this.data.quote.pointsToUse || 0),
        ...this.addonPayload()
      });
      if (this.idempotencyFingerprint !== requestFingerprint) {
        this.idempotencyFingerprint = requestFingerprint;
        this.idempotencyKey = `booking-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
      const result = await api.createOrder({
        workId: this.workId,
        serviceId: this.serviceId,
        technicianId: this.data.selectedTechnicianId,
        date: this.data.selectedDate,
        startAt: this.data.selectedSlot.startAt,
        quoteId: this.data.quote.quoteId,
        pointsToUse: this.data.quote.pointsToUse || 0,
        ...this.addonPayload(),
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

  async requestBookingReminders() {
    try {
      await api.requestSubscriptionEvents(this.bookingSettings, ['appointmentSuccess', 'arrivalReminder', 'noShowRefund']);
    } catch (error) {
      console.warn('预约提醒授权未完成', { code: error.code || error.errCode || '' });
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
          const confirmed = await this.confirmPaymentResult(orderId);
          wx.hideLoading();
          if (!confirmed) wx.showToast({ title: '支付结果仍在确认', icon: 'none' });
          wx.redirectTo({ url: `/pages/order-detail/index?orderId=${orderId}${confirmed ? '' : '&paymentConfirming=1'}` });
          resolve();
        },
        fail: async (error) => {
          const cancelled = error && (error.errMsg || '').includes('cancel');
          let status = '';
          try { const result = await api.queryPayment(orderId); status = result && result.status || ''; } catch (queryError) { status = 'UNKNOWN'; }
          const confirming = ['PREPAY_SUBMITTING', 'PREPAY_CREATED', 'UNKNOWN', 'CLOSE_PENDING'].includes(status);
          wx.showModal({ title: confirming ? '支付待确认' : cancelled ? '已返回订单' : '请查看订单', content: confirming ? '支付结果尚未确定，请勿重复支付；系统会继续查单。' : '请在订单倒计时结束前查看支付状态。', showCancel: false, success: () => wx.redirectTo({ url: `/pages/order-detail/index?orderId=${orderId}${confirming ? '&paymentConfirming=1' : ''}` }) });
          resolve();
        }
      });
    });
  },

  async confirmPaymentResult(orderId) {
    for (const delay of [0, 1000, 2000, 4000, 8000]) {
      if (delay) await wait(delay);
      try {
        const result = await api.queryPayment(orderId);
        if (result && ['SUCCESS', 'CLOSED'].includes(result.status)) return true;
      } catch (error) {
        // The callback and reconciliation job continue when this device cannot query.
      }
    }
    return false;
  },

  formatDate(event) {
    return formatDateLabel(event);
  },

  noop() {}
});
