const admin = require('./api');
const { formatMoney, formatDateTimeRange } = require('../../utils/format');
const { ORDER_STATUS_LABELS } = require('../../utils/constants');
const { storeDateString } = require('../../utils/store-time');
const clone = value => JSON.parse(JSON.stringify(value));
const money = value => formatMoney(Number(value || 0));
const today = () => storeDateString(Date.now());
const MENU = [
  { id: 'home', title: '首页设置', icon: '▧' }, { id: 'catalog', title: '项目与款式', icon: '✦' },
  { id: 'featured', title: '精选管理', icon: '★' }, { id: 'team', title: '技师管理', icon: '♧' },
  { id: 'schedule', title: '技师排班', icon: '◷' }, { id: 'settings', title: '门店与预约设置', icon: '⚙' }
];
const STATUS = [{ id: '', name: '全部状态' }, ...Object.entries(ORDER_STATUS_LABELS).map(([id, name]) => ({ id, name }))];
const RETRY_REFUNDS = ['RETRY_REQUIRED', 'CLOSED', 'WAITING_FUNDS', 'CONFIG_OR_DATA_ERROR'];
function decorateOrder(order, canRefund) {
  const remaining = Number(order.remainingRefundableFen || 0);
  return { ...order, statusLabel: order.statusLabel || ORDER_STATUS_LABELS[order.status] || order.status,
    timeLabel: order.startAt ? formatDateTimeRange(order.startAt, order.endAt, Number(order.durationMinutes || 0)) : order.startAtLabel,
    moneyLabel: money(order.paidFen), remainingLabel: money(remaining),
    addonLabel: (order.addons || []).map(a => `${a.name} · ${money(a.priceFen)}`).join(' / '),
    canRefund: !!canRefund && remaining > 0 && !order.refundInProgress && Number(order.paidFen) > 0 &&
      ['RESERVED','ARRIVED','IN_SERVICE','COMPLETED','NO_SHOW_REVIEW','CANCEL_PENDING_REFUND','CANCELLED','CANCELLED_BY_USER','CANCELLED_NO_SHOW'].includes(order.status) &&
      ['', 'NOT_REQUIRED', 'SUCCESS', ...RETRY_REFUNDS].includes(order.refundStatus || ''),
    transition: ['RESERVED','NO_SHOW_REVIEW'].includes(order.status) ? 'checkIn' : order.status === 'ARRIVED' ? 'start' : order.status === 'IN_SERVICE' ? 'complete' : '',
    transitionLabel: ['RESERVED','NO_SHOW_REVIEW'].includes(order.status) ? '确认到店' : order.status === 'ARRIVED' ? '开始服务' : '完成服务'
  };
}

Page({
  data: {
    checking: true, session: null, owner: false, technician: false, username: '', password: '', loggingIn: false,
    error: '', notice: '', loading: false, saving: false, tab: 'dashboard', section: '', title: '经营概览', menu: [],
    rangeOptions: ['近 7 天','近 30 天','近 90 天','近一年'], rangeIndex: 1, customRange: false, dateFrom: '', dateTo: '',
    summary: null, metrics: [], rankings: [], trend: [],
    query: { query: '', status: '', technicianId: '', serviceId: '', workId: '', dateFrom: '', dateTo: '', page: 1, limit: 20, sortBy: 'startAt', sortDirection: 'desc' },
    statuses: STATUS, statusIndex: 0, orders: [], orderPage: 1, orderPages: 1, orderTotal: 0, checkCode: '',
    catalog: { categories: [], services: [], works: [], technicians: [] },
    categoryOptions: [], serviceOptions: [], workOptions: [], technicianOptions: [],
    catalogKind: 'category', categoryIndex: 0, serviceIndex: 0, catalogItems: [], featured: [], featuredAvailable: [],
    settings: null, banners: [], qrRef: '', qrPreview: '', settingFields: [
      { path: 'booking.openDays', title: '开放预约天数' }, { path: 'booking.minAdvanceMinutes', title: '最少提前分钟' },
      { path: 'booking.unpaidHoldMinutes', title: '未付款保留分钟' }, { path: 'booking.refundCutoffMinutes', title: '可提前取消分钟' },
      { path: 'booking.noShowGraceMinutes', title: '未到店宽限分钟' }, { path: 'points.pointRateFen', title: '消费多少分获 1 积分' },
      { path: 'points.unit', title: '每次抵扣所需积分' }, { path: 'points.discountFen', title: '每次抵扣金额（分）' },
      { path: 'points.maxPercent', title: '单笔最高抵扣百分比' }, { path: 'points.inviteRewardPoints', title: '邀请方奖励积分' },
      { path: 'notifications.arrivalLeadMinutes', title: '到店提醒提前分钟' }
    ], notificationFields: [], penaltyYuan: '',
    scheduleDate: today(), schedule: null, plan: null, scheduleTechnicianIndex: 0, personal: null,
    editor: '', editorTitle: '', draft: {}, editorCategories: [], editorServices: [], addonOptions: ['普通项目','卸甲','建构'], addonIndex: 0,
    refund: null, refundYuan: '', refundReason: '', accountTechnician: null, accountUsername: '', accountPassword: '', cropper: null
  },

  onLoad() { this.restoreSession(); },
  onUnload() { this.sequence = (this.sequence || 0) + 1; },
  backHome() { wx.switchTab({ url: '/pages/index/index' }); },
  setField(event) { const path = event.currentTarget.dataset.path; if (path) this.setData({ [path]: event.detail.value }); },
  stopTap() {},
  async restoreSession() {
    this.setData({ checking: true, error: '' });
    try { if (admin.getSavedSession()) this.setSession(await admin.request('staffSession')); }
    catch (err) { this.setData({ error: err.message }); }
    finally { this.setData({ checking: false }); }
    if (this.data.session) await this.loadPage();
  },
  setSession(session) {
    if (!session || session.role === 'UNASSIGNED') throw new Error('此账号没有后台管理权限');
    const owner = session.role === 'OWNER'; const technician = session.role === 'TECHNICIAN';
    this.setData({ session, owner, technician, menu: owner ? MENU : technician ? [{ id: 'personal', title: '我的排班', icon: '◷' }] : [], title: technician ? '我的排班' : '经营概览' });
  },
  async login() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true, error: '' });
    try {
      const session = await admin.login(this.data.username.trim(), this.data.password);
      this.setSession(session); this.setData({ password: '' }); await this.loadPage();
    } catch (err) { this.setData({ error: err.message, password: '' }); }
    finally { this.setData({ loggingIn: false }); }
  },
  async logout() {
    if (this.data.saving) return;
    try { await admin.logout(); } catch (_) { /* The client has still cleared the local session. */ }
    this.sequence = (this.sequence || 0) + 1;
    this.setData({ session: null, password: '', summary: null, orders: [], settings: null, personal: null, catalog: { categories: [], services: [], works: [], technicians: [] }, editor: '', accountTechnician: null, accountPassword: '', refund: null, tab: 'dashboard', section: '', error: '', notice: '' });
  },
  handleError(err) {
    if (err.code === 'UNAUTHENTICATED' || err.code === 'FORBIDDEN') {
      if (err.code === 'UNAUTHENTICATED') this.setData({ session: null, orders: [], summary: null, personal: null, settings: null });
    }
    this.setData({ error: err.message || '操作失败，请重试' });
  },
  async selectTab(event) {
    if (this.data.saving) return;
    const tab = event.currentTarget.dataset.tab;
    this.setData({ tab, section: '', error: '', notice: '', title: tab === 'dashboard' ? this.data.technician ? '我的排班' : '经营概览' : tab === 'orders' ? '预约订单' : '其他' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 }); await this.loadPage();
  },
  async openSection(event) {
    const section = event.currentTarget.dataset.id;
    this.setData({ section, error: '', notice: '', title: this.data.menu.find(item => item.id === section)?.title || '其他' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 }); await this.loadPage();
  },
  closeSection() { this.sequence = (this.sequence || 0) + 1; this.setData({ section: '', title: '其他', error: '', notice: '', loading: false }); },
  async loadPage() {
    if (!this.data.session) return;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const { tab, section, technician } = this.data;
      if (technician && (tab === 'dashboard' || tab === 'orders' || section === 'personal')) {
        const personal = await admin.request('mySchedule', { date: this.data.scheduleDate });
        if (sequence !== this.sequence) return;
        this.setData({ personal: { ...personal, orders: personal.orders.map(order => decorateOrder(order, false)) }, plan: clone(personal.plan) });
      } else if (tab === 'dashboard') {
        const params = this.data.customRange ? { dateFrom: this.data.dateFrom, dateTo: this.data.dateTo } : { days: [7,30,90,365][this.data.rangeIndex] };
        if (this.data.customRange && (!params.dateFrom || !params.dateTo)) throw new Error('请选择起止日期');
        const result = await admin.request('adminSummary', params);
        if (sequence !== this.sequence) return;
        const m = result.metrics;
        const max = Math.max(1, ...result.trend.map(item => Math.abs(item.netFen)));
        this.setData({ summary: result, metrics: [
          { title: '净收款', value: money(m.netFen), accent: true }, { title: '完成服务', value: `${m.completedCount} 单` },
          { title: '到店顾客', value: `${m.customerCount} 人` }, { title: '客单价', value: money(m.averageOrderFen) },
          { title: '已到账退款', value: money(m.refundFen) }, { title: '未到店率', value: `${m.noShowRate}%` }
        ], trend: result.trend.map(item => ({ ...item, height: Math.max(2, Math.round(Math.abs(item.netFen) / max * 100)), negative: item.netFen < 0, label: item.date.slice(5), value: money(item.netFen) })),
        rankings: [{ title: '大项分布', items: result.categories }, { title: '热门款式', items: result.works }, { title: '项目预约', items: result.services }, { title: '技师预约', items: result.technicians }] });
      } else if (tab === 'orders') {
        const result = await admin.request('adminListOrders', this.data.query);
        if (sequence !== this.sequence) return;
        this.setData({ orders: result.orders.map(order => decorateOrder(order, result.canRefund)), orderPage: result.page, orderPages: result.pages || 1, orderTotal: result.total });
        await this.loadCatalog(sequence);
      } else if (['catalog','featured','team'].includes(section)) await this.loadCatalog(sequence);
      else if (['home','settings'].includes(section)) {
        const settings = await admin.request('getSettings'); if (sequence !== this.sequence) return;
        this.setData({ settings, banners: (settings.home?.banners || []).map(item => ({ id: item.id, imageUrl: item.imageFileID || item.imageUrl, previewUrl: item.imageUrl })), qrRef: settings.store.wechatQrFileID || settings.store.wechatQrUrl || '', qrPreview: settings.store.wechatQrUrl || '', penaltyYuan: String(Number(settings.booking.noShowPenaltyFen || 0) / 100),
          settingFields: this.data.settingFields.map(field => ({ ...field, value: field.path.split('.').reduce((value,key)=>value[key],settings) })),
          notificationFields: Object.entries(settings.notifications.templates).map(([id, value]) => ({ id, title: ({ appointmentSuccess: '预约成功', arrivalReminder: '到店提醒', checkInSuccess: '核销成功', noShowRefund: '退款成功' })[id], fields: Object.keys(value).filter(key => key.endsWith('Key')).map(key => ({ key, value: value[key] })) })) });
      } else if (section === 'schedule') {
        const schedule = await admin.request('adminSchedule', { date: this.data.scheduleDate }); if (sequence !== this.sequence) return;
        const index = Math.min(this.data.scheduleTechnicianIndex, Math.max(0, schedule.technicians.length - 1));
        this.setData({ schedule, scheduleTechnicianIndex: index, plan: schedule.technicians[index] ? clone(schedule.technicians[index].plan) : null });
      }
    } catch (err) { if (sequence === this.sequence) this.handleError(err); }
    finally { if (sequence === this.sequence) this.setData({ loading: false }); }
  },
  async loadCatalog(sequence) {
    const catalog = await admin.request('adminCatalog'); if (sequence !== this.sequence) return;
    const categories = catalog.categories.map(item => ({ ...item, name: item.name || '' }));
    const categoryOptions = [{ id: '', name: '全部大项' }, ...categories];
    const serviceOptions = [{ id: '', name: '全部项目' }, ...catalog.services];
    const selected = new Set((catalog.works || []).filter(item => item.featured).map(item => item.id));
    this.setData({ catalog: { ...catalog, categories }, categoryOptions, serviceOptions, workOptions: [{ id: '', title: '全部款式' }, ...catalog.works.filter(item => !this.data.query.serviceId || item.serviceId === this.data.query.serviceId)], technicianOptions: [{ id: '', name: '全部技师' }, ...catalog.technicians],
      featured: catalog.works.filter(item => item.featured).sort((a,b) => a.featuredSort-b.featuredSort), featuredAvailable: catalog.works.filter(item => item.published !== false && !selected.has(item.id)) });
    this.updateCatalogItems();
  },
  toggleCustom(event) { this.setData({ customRange: event.detail.value }); },
  changeRange(event) { this.setData({ rangeIndex: Number(event.detail.value) }); this.loadPage(); },
  filterOrders(event) {
    const type = event.currentTarget.dataset.type; const index = Number(event.detail.value);
    const options = { status: this.data.statuses, technicianId: this.data.technicianOptions, serviceId: this.data.serviceOptions, workId: this.data.workOptions }[type];
    this.setData({ [`query.${type}`]: options[index].id, ...(type === 'status' ? { statusIndex: index } : {}) });
    if (type === 'serviceId') this.setData({ 'query.workId': '', workOptions: [{ id: '', title: '全部款式' }, ...this.data.catalog.works.filter(item => !options[index].id || item.serviceId === options[index].id)] });
  },
  queryOrders() { this.setData({ 'query.page': 1 }); this.loadPage(); },
  resetOrderQuery() { this.setData({ query: { query: '', status: '', technicianId: '', serviceId: '', workId: '', dateFrom: '', dateTo: '', page: 1, limit: 20, sortBy: 'startAt', sortDirection: 'desc' }, statusIndex: 0 }); this.loadPage(); },
  pageOrders(event) { const page = this.data.orderPage + Number(event.currentTarget.dataset.step); if (page >= 1 && page <= this.data.orderPages) { this.setData({ 'query.page': page }); this.loadPage(); } },
  async mutate(action, payload, notice) {
    if (this.data.saving) return false;
    this.setData({ saving: true, error: '', notice: '' });
    try { await admin.request(action, payload); await this.loadPage(); this.setData({ notice: notice || '已保存' }); return true; }
    catch (err) { this.handleError(err); return false; }
    finally { this.setData({ saving: false }); }
  },
  confirm(title, content) { return new Promise(resolve => wx.showModal({ title, content, success: result => resolve(result.confirm), fail: () => resolve(false) })); },
  async transition(event) {
    const { id, action } = event.currentTarget.dataset;
    if (!await this.confirm('更新服务状态', { checkIn: '确认顾客已到店？', start: '确认开始本次服务？', complete: '确认服务已经完成？积分将按服务端规则发放。' }[action])) return;
    await this.mutate('staffTransition', { orderId: id, action }, '服务状态已更新');
  },
  async scanCheckIn() {
    if (this.scanning || this.data.saving) return; this.scanning = true;
    try { const scan = await new Promise((resolve,reject) => wx.scanCode({ scanType: ['qrCode'], success: resolve, fail: reject })); this.setData({ checkCode: scan.result }); await this.redeemCode(); }
    catch (err) { if (!String(err.errMsg || '').includes('cancel')) this.handleError(err); }
    finally { this.scanning = false; }
  },
  async redeemCode() { if (this.data.checkCode.trim() && await this.mutate('redeemCheckInCode', { code: this.data.checkCode.trim() }, '核销成功')) this.setData({ checkCode: '' }); },
  callCustomer(event) { wx.makePhoneCall({ phoneNumber: event.currentTarget.dataset.phone }); },
  openRefund(event) {
    const order = this.data.orders.find(item => item.id === event.currentTarget.dataset.id); if (!order?.canRefund) return;
    const retry = RETRY_REFUNDS.includes(order.refundStatus) && Number(order.lastRefundRequestedFen) > 0;
    this.setData({ refund: { ...order, retry }, refundYuan: String((retry ? order.lastRefundRequestedFen : order.remainingRefundableFen) / 100), refundReason: '', error: '' });
  },
  closeRefund() { if (!this.data.saving) this.setData({ refund: null }); },
  async submitRefund() {
    const order = this.data.refund; if (!order || this.data.saving) return;
    const amountFen = order.retry ? Number(order.lastRefundRequestedFen) : Math.round(Number(this.data.refundYuan) * 100);
    if (!Number.isSafeInteger(amountFen) || amountFen <= 0 || amountFen > Number(order.remainingRefundableFen)) { this.setData({ error: '退款金额须大于 0 且不超过剩余可退金额' }); return; }
    if (!await this.confirm('确认退款', `向该订单提交 ${money(amountFen)} ${order.retry ? '退款重试' : '退款'}？`)) return;
    if (await this.mutate('adminRefund', { orderId: order.id, amountFen, reason: this.data.refundReason.trim() || (order.retry ? '管理员按原金额重试退款' : '管理员退款') }, '退款已提交，请以到账状态为准')) this.setData({ refund: null });
  },
  chooseCatalogKind(event) { this.setData({ catalogKind: event.currentTarget.dataset.kind }); this.updateCatalogItems(); },
  filterCatalog(event) { this.setData({ [event.currentTarget.dataset.type === 'category' ? 'categoryIndex' : 'serviceIndex']: Number(event.detail.value) }); this.updateCatalogItems(); },
  updateCatalogItems() {
    const { catalog, categoryIndex, serviceIndex, catalogKind } = this.data;
    const categoryId = this.data.categoryOptions[categoryIndex]?.id; const serviceId = this.data.serviceOptions[serviceIndex]?.id;
    const source = catalogKind === 'category' ? catalog.categories : catalogKind === 'service' ? catalog.services.filter(item => !categoryId || item.categoryId === categoryId) : catalog.works.filter(item => (!categoryId || item.categoryId === categoryId) && (!serviceId || item.serviceId === serviceId));
    this.setData({ catalogItems: source.map(item => ({ ...item, displayName: item.name || item.title, previewUrl: item.imageUrl || item.coverUrl || '', priceLabel: item.priceFen !== undefined ? money(item.priceFen) : '', enabled: catalogKind === 'work' ? item.published !== false : item.enabled !== false })) });
  },
  openEditor(event) {
    const kind = event.currentTarget.dataset.kind || this.data.catalogKind; const id = event.currentTarget.dataset.id;
    const list = { category: 'categories', service: 'services', work: 'works', technician: 'technicians' }[kind];
    const existing = this.data.catalog[list].find(item => item.id === id);
    const categories = this.data.catalog.categories.map(item => ({ ...item, checked: !!existing?.categoryIds?.includes(item.id) }));
    const draft = existing ? clone(existing) : { name: '', title: '', enabled: true, published: true, sort: 1, categoryId: this.data.categoryOptions[this.data.categoryIndex]?.id || categories[0]?.id || '', serviceId: this.data.serviceOptions[this.data.serviceIndex]?.id || this.data.catalog.services[0]?.id || '', categoryIds: [], icon: '✦', color: '#f1ded8', durationMinutes: 60, priceFen: 10000, description: '', bio: '' };
    draft.priceYuan = String(Number(draft.priceFen || 0) / 100);
    draft.categoryName = categories.find(item => item.id === draft.categoryId)?.name || '';
    draft.serviceName = this.data.catalog.services.find(item => item.id === draft.serviceId)?.name || '';
    this.setData({ editor: kind, editorTitle: `${id ? '编辑' : '新增'}${({category:'大项', service:'项目', work:'款式', technician:'技师'})[kind]}`, draft, editorCategories: categories, editorServices: this.data.catalog.services.filter(item => item.enabled !== false || item.id === draft.serviceId), addonIndex: ['', 'REMOVAL', 'BUILDER'].indexOf(draft.addonType || ''), error: '' });
  },
  closeEditor() { if (!this.data.saving) this.setData({ editor: '', draft: {} }); },
  editorPick(event) {
    const kind = event.currentTarget.dataset.kind; const index = Number(event.detail.value);
    if (kind === 'addon') this.setData({ addonIndex: index, 'draft.addonType': ['', 'REMOVAL', 'BUILDER'][index] });
    else {
      const selected = (kind === 'category' ? this.data.editorCategories : this.data.editorServices)[index];
      if (selected) this.setData({ [`draft.${kind}Id`]: selected.id, [`draft.${kind}Name`]: selected.name });
    }
  },
  async saveEditor() {
    const kind = this.data.editor; const draft = clone(this.data.draft);
    draft.sort = Number(draft.sort); draft.priceFen = Math.round(Number(draft.priceYuan) * 100); draft.durationMinutes = Number(draft.durationMinutes);
    if (await this.mutate(({category:'adminSaveCategory',service:'adminSaveService',work:'adminSaveWork',technician:'adminSaveTechnician'})[kind], draft, '已保存')) this.setData({ editor: '', draft: {} });
  },
  async archiveItem(event) {
    const { id, kind } = event.currentTarget.dataset;
    if (!await this.confirm('确认移除', kind === 'technician' ? '有预约记录的技师由系统保护；可使用停用保留记录。' : '将移除该项及其下属展示内容，历史订单由服务端保留。')) return;
    await this.mutate(({category:'adminDeleteCategory',service:'adminDeleteService',work:'adminDeleteWork',technician:'adminDeleteTechnician'})[kind], { [`${kind}Id`]: id }, '已移除');
  },
  async reorderItem(event) { const { id, sort, kind } = event.currentTarget.dataset; await this.mutate('adminReorderCatalog', { kind, id, sort: Number(sort) }, '顺序已更新'); },
  moveLocal(event) {
    const { list, index, step } = event.currentTarget.dataset; const items = this.data[list].slice(); const to = Number(index) + Number(step);
    if (to < 0 || to >= items.length) return;
    [items[index], items[to]] = [items[to], items[index]]; this.setData({ [list]: items });
  },
  removeLocal(event) { const { list, index } = event.currentTarget.dataset; const items = this.data[list].slice(); const removed = items.splice(Number(index),1)[0]; this.setData({ [list]: items, ...(list === 'featured' ? { featuredAvailable: this.data.featuredAvailable.concat(removed) } : {}) }); },
  addFeatured(event) { const work = this.data.featuredAvailable[Number(event.detail.value)]; if (work) this.setData({ featured: this.data.featured.concat(work), featuredAvailable: this.data.featuredAvailable.filter(item => item.id !== work.id) }); },
  saveFeatured() { return this.mutate('adminSaveFeaturedWorks', { orderedIds: this.data.featured.map(item => item.id) }, '精选顺序已保存'); },
  addBanner() { if (this.data.banners.length < 20) this.setData({ banners: this.data.banners.concat({ id: `banner-${Date.now()}`, imageUrl: '', previewUrl: '' }) }); },
  async saveHome() { if (this.data.banners.some(item => !item.imageUrl)) { this.setData({ error: '请上传所有宣传图，或移除空白项' }); return; } await this.mutate('adminSaveSettings', { version: this.data.settings.version, home: { banners: this.data.banners.map(({ id,imageUrl }) => ({ id,imageUrl })) } }, '宣传图已保存'); },
  saveQr() { return this.mutate('adminSaveSettings', { version: this.data.settings.version, store: { ...this.data.settings.store, wechatQrUrl: this.data.qrRef, wechatQrFileID: this.data.qrRef.startsWith('cloud://') ? this.data.qrRef : '' } }, '二维码已保存'); },
  async chooseImage(event) {
    if (this.data.saving) return;
    const target = event.currentTarget.dataset.target;
    try {
      const result = await new Promise((resolve,reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], success: resolve, fail: reject }));
      const path = result.tempFiles[0].tempFilePath;
      if (target === 'banner' || target.startsWith('banners[')) {
        const info = await new Promise((resolve,reject) => wx.getImageInfo({ src: path, success: resolve, fail: reject }));
        const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const width = windowInfo.windowWidth - 48; const height = width / 2; const scale = Math.max(width/info.width,height/info.height);
        this.setData({ cropper: { target, path, width, height, originalWidth: info.width, originalHeight: info.height, baseScale: scale, scale, imageWidth: info.width*scale, imageHeight: info.height*scale, x: (width-info.width*scale)/2, y: (height-info.height*scale)/2 } });
      } else await this.uploadImage(path,target);
    } catch (err) { if (!String(err.errMsg || '').includes('cancel')) this.handleError(err); }
  },
  async uploadImage(path,target) {
    this.setData({ saving: true, error: '' });
    try {
      const base64 = await new Promise((resolve,reject) => wx.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: result => resolve(result.data), fail: reject }));
      if (base64.length > 2800000) throw new Error('图片超过 2 MB，请压缩后重试');
      const uploaded = await admin.request('adminUploadImage', { base64 });
      if (target === 'qr') this.setData({ qrRef: uploaded.fileID, qrPreview: uploaded.url });
      else if (target.startsWith('banners[')) this.setData({ [`${target}.imageUrl`]: uploaded.fileID, [`${target}.previewUrl`]: uploaded.url });
      else { const field = this.data.editor === 'technician' ? 'avatar' : this.data.editor === 'work' ? 'image' : 'cover'; this.setData({ [`draft.${field}FileID`]: uploaded.fileID, [`draft.${field}Url`]: uploaded.url }); }
    } catch (err) { this.handleError(err); }
    finally { this.setData({ saving: false }); }
  },
  cropTouchStart(event) { const touch = event.touches[0]; this.cropTouch = { x: touch.clientX, y: touch.clientY, left: this.data.cropper.x, top: this.data.cropper.y }; },
  cropTouchMove(event) { if (!this.cropTouch || !this.data.cropper) return; const c=this.data.cropper,t=event.touches[0]; this.setData({ 'cropper.x': Math.max(c.width-c.imageWidth,Math.min(0,this.cropTouch.left+t.clientX-this.cropTouch.x)), 'cropper.y': Math.max(c.height-c.imageHeight,Math.min(0,this.cropTouch.top+t.clientY-this.cropTouch.y)) }); },
  cropZoom(event) { const c=this.data.cropper,scale=c.baseScale*Number(event.detail.value)/100,w=c.originalWidth*scale,h=c.originalHeight*scale; this.setData({ 'cropper.scale':scale,'cropper.imageWidth':w,'cropper.imageHeight':h,'cropper.x':(c.width-w)/2,'cropper.y':(c.height-h)/2 }); },
  closeCropper() { if (!this.data.saving) this.setData({ cropper: null }); },
  async confirmCrop() {
    if (this.data.saving) return; const c=this.data.cropper; this.setData({ saving:true,error:'' });
    try {
      const canvas = await new Promise(resolve => wx.createSelectorQuery().select('#adminCropCanvas').fields({node:true,size:true}).exec(result => resolve(result[0]?.node)));
      if (!canvas) throw new Error('图片裁切不可用，请重试'); canvas.width=1200;canvas.height=600;
      const image=canvas.createImage(); await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=c.path;});
      canvas.getContext('2d').drawImage(image,-c.x/c.scale,-c.y/c.scale,c.width/c.scale,c.height/c.scale,0,0,1200,600);
      const path=await new Promise((resolve,reject)=>wx.canvasToTempFilePath({canvas,fileType:'jpg',quality:.86,success:r=>resolve(r.tempFilePath),fail:reject}));
      this.setData({cropper:null});await this.uploadImage(path,c.target);
    } catch(err){this.handleError(err);} finally {this.setData({saving:false});}
  },
  async saveSettings() {
    const { version,store,booking,points,notifications } = clone(this.data.settings);
    booking.noShowPenaltyFen = Math.round(Number(this.data.penaltyYuan)*100);
    await this.mutate('adminSaveSettings', { version,store,booking,points,notifications,reason:'小程序管理后台更新设置' }, '门店设置已保存');
  },
  async changeScheduleDate(event) { this.setData({ scheduleDate:event.detail.value }); await this.loadPage(); },
  selectScheduleTechnician(event) { const index=Number(event.detail.value); this.setData({scheduleTechnicianIndex:index,plan:clone(this.data.schedule.technicians[index].plan)}); },
  addShift(event) { const base=event.currentTarget.dataset.base, item=base==='plan'?this.data.plan:this.data.schedule.weekly[Number(event.currentTarget.dataset.index)]; this.setData({[`${base}.shifts`]:item.shifts.concat({start:'09:00',end:'18:00',breaks:[]})}); },
  removeShift(event) { const {base,index,day}=event.currentTarget.dataset;const item=base==='plan'?this.data.plan:this.data.schedule.weekly[Number(day)]; this.setData({[`${base}.shifts`]:item.shifts.filter((_,i)=>i!==Number(index))}); },
  changeBreak(event) { const {base,day,shift,index,action}=event.currentTarget.dataset; const item=base==='plan'?this.data.plan:this.data.schedule.weekly[Number(day)];const breaks=item.shifts[Number(shift)].breaks.slice(); if(action==='add')breaks.push({start:'12:00',end:'13:00'});else breaks.splice(Number(index),1);this.setData({[`${base}.shifts[${shift}].breaks`]:breaks}); },
  saveDay() { if (this.data.plan) return this.mutate(this.data.technician?'saveMySchedule':'adminSaveScheduleDay',clone(this.data.plan),'当天排班已保存'); },
  saveWeekly() { return this.mutate('adminSaveWeeklySchedule',{weekly:this.data.schedule.weekly,version:this.data.schedule.scheduleVersion,reason:'小程序管理后台更新每周排班'},'每周排班已保存'); },
  openAccount(event) { const technician=this.data.catalog.technicians.find(item=>item.id===event.currentTarget.dataset.id); this.setData({accountTechnician:technician,accountUsername:'',accountPassword:'',error:''}); },
  closeAccount() { if (!this.data.saving)this.setData({accountTechnician:null,accountPassword:''}); },
  async createAccount() { const payload={technicianId:this.data.accountTechnician.id,username:this.data.accountUsername.trim(),password:this.data.accountPassword};this.setData({accountPassword:''});if(await this.mutate('adminCreateTechnicianLogin',payload,'技师账号已开通'))this.setData({accountTechnician:null}); }
});
