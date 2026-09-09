<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { adminApi, isDemoMode, money } from './api';
import { getCurrentUser, signIn as cloudSignIn, signOut as cloudSignOut, type AuthUser } from './cloudbase';
import type { AdminOrder, BreakWindow, CatalogResponse, PageKey, ScheduleResponse, Service, Settings, Shift, TechnicianDayPlan, WeeklySchedule } from './types';

const authReady = ref(false);
const authenticated = ref(false);
const authBusy = ref(false);
const authError = ref('');
const loginUsername = ref('');
const loginPassword = ref('');
const currentUser = ref<AuthUser | null>(null);
const page = ref<PageKey>('dashboard');
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const demo = isDemoMode();
const bootstrapAvailable = ref(false);
const bootstrapBusy = ref(false);
const metrics = ref({ paidFen: 0, refundFen: 0, netFen: 0, completedFen: 0, orderCount: 0, completedCount: 0, customerCount: 0, noShowCount: 0 });
const orders = ref<AdminOrder[]>([]);
const catalog = ref<CatalogResponse>({ services: [], works: [], technicians: [] });
const settings = reactive<Settings>({ version: 1, store: { storeName: '', address: '', phone: '', notice: '' }, booking: { openDays: 14, minAdvanceMinutes: 60, slotStepMinutes: 15, unpaidHoldMinutes: 5, noShowGraceMinutes: 30 }, points: { pointRateFen: 100, unit: 20, discountFen: 100, maxPercent: 10 } });
const paymentStatus = ref<{ configured: boolean; missing: string[]; callbackCertificateConfigured: boolean; note: string }>({ configured: false, missing: [], callbackCertificateConfigured: false, note: '' });
const orderFilter = ref('');
const editingService = ref<Service | null>(null);
const serviceDraft = reactive<Partial<Service>>({});
const scheduleDate = ref(todayDate());
const scheduleLoading = ref(false);
const scheduleSaving = ref(false);
const schedule = ref<ScheduleResponse>({ date: scheduleDate.value, weekly: [], technicians: [] });
const selectedTechnicianId = ref('');
const weeklyDraft = ref<WeeklySchedule[]>([]);
const dayDraft = reactive<TechnicianDayPlan>({ id: '', technicianId: '', date: scheduleDate.value, weekday: 1, leave: false, shifts: [], source: 'weekly', version: 1, occupancyCount: 0, occupiedIntervals: [] });
const currentUserLabel = computed(() => currentUser.value?.username || currentUser.value?.email || currentUser.value?.uid || '管理员');

const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function todayDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function weekdayLabel(value: number): string {
  return weekdayLabels[Math.max(0, Number(value) - 1)] || '—';
}

function timeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
}

const selectedScheduleTechnician = computed(() => schedule.value.technicians.find((item) => item.id === selectedTechnicianId.value) || schedule.value.technicians[0]);

function syncDayDraft() {
  const technician = selectedScheduleTechnician.value;
  if (!technician) return;
  selectedTechnicianId.value = technician.id;
  Object.assign(dayDraft, clone(technician.plan));
  dayDraft.shifts = clone(technician.plan.shifts);
  dayDraft.occupiedIntervals = clone(technician.plan.occupiedIntervals);
}

function selectTechnician(technicianId: string) {
  selectedTechnicianId.value = technicianId;
  syncDayDraft();
}

const navItems: Array<{ id: PageKey; label: string; icon: string }> = [
  { id: 'dashboard', label: '经营概览', icon: '◒' },
  { id: 'orders', label: '预约订单', icon: '◷' },
  { id: 'services', label: '项目与作品', icon: '✦' },
  { id: 'technicians', label: '技师排班', icon: '♧' },
  { id: 'settings', label: '预约与积分规则', icon: '⚙' },
  { id: 'payment', label: '微信支付接入', icon: '¥' }
];

const pageTitle = computed(() => navItems.find((item) => item.id === page.value)?.label || '经营概览');

function formatDate(date: string): string { return date ? date.replace(/-/g, '.') : '—'; }

async function restoreSession() {
  try {
    currentUser.value = await getCurrentUser();
    authenticated.value = !!currentUser.value;
  } catch (err) {
    currentUser.value = null;
    authenticated.value = false;
    authError.value = err instanceof Error ? err.message : '无法读取登录会话';
  } finally {
    authReady.value = true;
  }
  if (authenticated.value) await loadAll();
}

async function submitLogin() {
  if (!loginUsername.value.trim() || !loginPassword.value) {
    authError.value = '请输入 CloudBase 用户名和密码';
    return;
  }
  authBusy.value = true;
  authError.value = '';
  try {
    currentUser.value = await cloudSignIn(loginUsername.value.trim(), loginPassword.value);
    authenticated.value = true;
    loginPassword.value = '';
    await loadAll();
  } catch (err) {
    authenticated.value = false;
    currentUser.value = null;
    authError.value = err instanceof Error ? err.message : '登录失败，请检查账号和密码';
  } finally {
    authBusy.value = false;
  }
}

async function logout() {
  try {
    await cloudSignOut();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '退出登录失败';
  } finally {
    authenticated.value = false;
    currentUser.value = null;
    bootstrapAvailable.value = false;
    loading.value = false;
    page.value = 'dashboard';
    orders.value = [];
    catalog.value = { services: [], works: [], technicians: [] };
  }
}

async function loadAll() {
  loading.value = true;
  error.value = '';
  try {
    const bootstrap = await adminApi.bootstrapStatus();
    bootstrapAvailable.value = bootstrap.available;
    if (bootstrap.available) return;
    const [summary, orderResult, catalogResult, settingsResult, paymentResult, scheduleResult] = await Promise.all([adminApi.summary(), adminApi.orders(), adminApi.catalog(), adminApi.settings(), adminApi.paymentStatus(), adminApi.schedule(scheduleDate.value)]);
    metrics.value = summary.metrics;
    orders.value = orderResult.orders;
    catalog.value = catalogResult;
    Object.assign(settings, settingsResult);
    paymentStatus.value = paymentResult;
    schedule.value = scheduleResult;
    weeklyDraft.value = clone(scheduleResult.weekly);
    if (!scheduleResult.technicians.some((item) => item.id === selectedTechnicianId.value)) selectedTechnicianId.value = scheduleResult.technicians[0]?.id || '';
    syncDayDraft();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

async function loadSchedule() {
  scheduleLoading.value = true;
  error.value = '';
  try {
    const result = await adminApi.schedule(scheduleDate.value);
    schedule.value = result;
    weeklyDraft.value = clone(result.weekly);
    if (!result.technicians.some((item) => item.id === selectedTechnicianId.value)) selectedTechnicianId.value = result.technicians[0]?.id || '';
    syncDayDraft();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '排班加载失败';
  } finally {
    scheduleLoading.value = false;
  }
}

async function bootstrapOwner() {
  if (!window.confirm('确认把当前 CloudBase 登录账号设为唯一首个店主？之后其他账号必须由店主授权。')) return;
  bootstrapBusy.value = true;
  error.value = '';
  try {
    await adminApi.bootstrapOwner();
    bootstrapAvailable.value = false;
    notice.value = '店主账号已配置，正在加载真实门店数据。';
    await loadAll();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '店主账号配置失败';
  } finally {
    bootstrapBusy.value = false;
  }
}

async function loadOrders() {
  try { orders.value = (await adminApi.orders(orderFilter.value)).orders; } catch (err) { error.value = err instanceof Error ? err.message : '订单加载失败'; }
}

function beginEdit(service: Service) {
  editingService.value = service;
  Object.assign(serviceDraft, service, { priceFen: service.priceFen / 100 });
}

function cancelEdit() { editingService.value = null; Object.keys(serviceDraft).forEach((key) => delete (serviceDraft as Record<string, unknown>)[key]); }

async function saveService() {
  if (!serviceDraft.id || !serviceDraft.name) return;
  saving.value = true;
  try {
    const saved = await adminApi.saveService({ ...editingService.value, ...serviceDraft, priceFen: Math.round(Number(serviceDraft.priceFen || 0) * 100) } as Service);
    const index = catalog.value.services.findIndex((item) => item.id === saved.id);
    if (index >= 0) catalog.value.services[index] = saved; else catalog.value.services.push(saved);
    notice.value = '项目已保存，新订单会使用最新规则。';
    cancelEdit();
  } catch (err) { error.value = err instanceof Error ? err.message : '保存失败'; } finally { saving.value = false; }
}

async function saveSettings() {
  saving.value = true;
  try {
    const saved = await adminApi.saveSettings({ ...settings, reason: '管理后台发布预约与积分规则' });
    Object.assign(settings, saved);
    notice.value = `规则已发布，当前版本 v${saved.version}`;
  } catch (err) { error.value = err instanceof Error ? err.message : '规则保存失败'; } finally { saving.value = false; }
}

function addShift(target: { shifts: Shift[] }) {
  target.shifts.push({ start: '10:00', end: '20:00', breaks: [] });
}

function removeShift(target: { shifts: Shift[] }, index: number) {
  target.shifts.splice(index, 1);
}

function addBreak(shift: Shift) {
  shift.breaks.push({ start: '13:00', end: '14:00' });
}

function removeBreak(shift: Shift, index: number) {
  shift.breaks.splice(index, 1);
}

async function saveDaySchedule() {
  if (!dayDraft.technicianId || !dayDraft.date) return;
  scheduleSaving.value = true;
  error.value = '';
  try {
    const saved = await adminApi.saveScheduleDay({ technicianId: dayDraft.technicianId, date: dayDraft.date, leave: dayDraft.leave, shifts: clone(dayDraft.shifts), version: dayDraft.version, reason: `管理后台维护 ${dayDraft.date} 技师排班` });
    notice.value = `${selectedScheduleTechnician.value?.name || '技师'} ${dayDraft.date} 的排班已保存`;
    const target = schedule.value.technicians.find((item) => item.id === dayDraft.technicianId);
    if (target) target.plan = saved;
    Object.assign(dayDraft, clone(saved));
    dayDraft.shifts = clone(saved.shifts);
    dayDraft.occupiedIntervals = clone(saved.occupiedIntervals);
  } catch (err) {
    error.value = err instanceof Error ? err.message : '排班保存失败';
  } finally {
    scheduleSaving.value = false;
  }
}

async function saveWeekly() {
  scheduleSaving.value = true;
  error.value = '';
  try {
    const result = await adminApi.saveWeeklySchedule(clone(weeklyDraft.value), '管理后台发布每周营业排班模板');
    notice.value = `每周模板已发布，当前版本 v${result.version}`;
    await loadSchedule();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '每周模板保存失败';
  } finally {
    scheduleSaving.value = false;
  }
}

async function refund(order: AdminOrder) {
  if (!window.confirm(`确认对订单 ${order.id} 发起整单退款？`)) return;
  try { await adminApi.refund(order.id, '管理员在后台发起退款'); notice.value = '退款请求已提交，到账状态请以微信回调/查单为准。'; await loadOrders(); } catch (err) { error.value = err instanceof Error ? err.message : '退款失败'; }
}

watch(scheduleDate, () => {
  if (authenticated.value && page.value === 'technicians') loadSchedule();
});

watch(page, (nextPage) => {
  if (authenticated.value && nextPage === 'technicians' && !schedule.value.technicians.length) loadSchedule();
});

onMounted(restoreSession);
</script>

<template>
  <div v-if="!authReady" class="auth-loading"><div class="loader"></div><span>正在检查登录会话…</span></div>

  <section v-else-if="!authenticated" class="login-shell">
    <div class="login-card">
      <div class="login-brand"><span class="brand-mark">✦</span><div><strong>拾光美研</strong><small>OPERATIONS DESK</small></div></div>
      <span class="eyebrow">SECURE OPERATIONS LOGIN</span>
      <h1>登录门店后台</h1>
      <p class="login-lead">使用 CloudBase 身份认证账号进入经营数据、订单和规则管理。</p>
      <div v-if="authError" class="login-error">{{ authError }}</div>
      <form class="login-form" @submit.prevent="submitLogin">
        <label>用户名<input v-model="loginUsername" autocomplete="username" autofocus placeholder="CloudBase 用户名" /></label>
        <label>密码<input v-model="loginPassword" autocomplete="current-password" type="password" placeholder="请输入密码" /></label>
        <button class="primary-button login-button" :disabled="authBusy" type="submit">{{ authBusy ? '登录中…' : '登录后台' }}</button>
      </form>
      <p class="login-footnote">账号由 CloudBase 控制台的“身份认证 → 用户管理”创建。登录态由 CloudBase SDK 持久化和自动续期，页面不会保存密码。</p>
    </div>
  </section>

  <div v-else class="admin-app">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">✦</span><div><strong>拾光美研</strong><small>OPERATIONS DESK</small></div></div>
      <div v-if="demo" class="demo-chip">演示模式</div>
      <nav><button v-for="item in navItems" :key="item.id" :class="['nav-item', { active: page === item.id }]" @click="page = item.id"><span class="nav-icon">{{ item.icon }}</span>{{ item.label }}</button></nav>
      <div class="sidebar-foot"><span class="status-dot"></span><span>CloudBase 业务后台</span><small>密钥只保存在服务端</small></div>
    </aside>

    <main class="main-content">
      <header class="topbar"><div><span class="breadcrumb">拾光美研 / </span><strong>{{ pageTitle }}</strong></div><div class="topbar-right"><span class="date-label">今天 · {{ new Date().toLocaleDateString('zh-CN') }}</span><span class="user-label" :title="currentUser?.uid">{{ currentUserLabel }}</span><button class="logout-button" @click="logout">退出</button><span class="avatar">店</span></div></header>
      <div v-if="demo" class="demo-notice">当前为显式本地演示数据；生产构建使用 CloudBase 身份认证和真实 SQL 业务数据。</div>
      <div v-if="error" class="alert error">{{ error }} <button @click="error = ''">×</button></div>
      <div v-if="notice" class="alert success">{{ notice }} <button @click="notice = ''">×</button></div>

      <section v-if="bootstrapAvailable" class="bootstrap-card panel"><div class="bootstrap-icon">✓</div><span class="eyebrow">FIRST-TIME SETUP</span><h1>配置首个店主账号</h1><p>当前环境还没有任何店员授权。确认后，当前已登录的 CloudBase 账号会写入 SQL 的 <code>staff_accounts</code>，成为唯一首个店主。</p><button class="primary-button" :disabled="bootstrapBusy" @click="bootstrapOwner">{{ bootstrapBusy ? '配置中…' : '设为首个店主' }}</button><button class="text-button bootstrap-logout" @click="logout">退出当前账号</button></section>

      <div v-else-if="loading" class="loading-state"><div class="loader"></div><span>正在整理门店数据…</span></div>

      <template v-else>
        <section v-if="page === 'dashboard'" class="page-section">
          <div class="page-intro"><div><span class="eyebrow">TODAY AT A GLANCE</span><h1>今天，门店状态不错。</h1><p>只统计小程序订单；退款和完成服务分别按业务发生日记录。</p></div><button class="soft-button" @click="loadAll">刷新数据 ↻</button></div>
          <div class="metric-grid"><article class="metric-card accent"><span>微信收款</span><strong>{{ money(metrics.paidFen) }}</strong><small>今日支付成功</small></article><article class="metric-card"><span>净收款</span><strong>{{ money(metrics.netFen) }}</strong><small>收款 − 退款</small></article><article class="metric-card"><span>完成服务</span><strong>{{ money(metrics.completedFen) }}</strong><small>{{ metrics.completedCount }} 笔完成订单</small></article><article class="metric-card"><span>到店顾客</span><strong>{{ metrics.customerCount }}</strong><small>{{ metrics.noShowCount }} 笔未到店</small></article></div>
          <div class="split-grid"><section class="panel"><div class="panel-heading"><div><span class="eyebrow">UPCOMING</span><h2>接下来要接待</h2></div><button class="text-button" @click="page = 'orders'">查看全部 ›</button></div><div v-if="orders.filter((item) => item.status === 'RESERVED').length" class="mini-order-list"><div v-for="order in orders.filter((item) => item.status === 'RESERVED').slice(0, 4)" :key="order.id" class="mini-order"><div class="mini-time">{{ order.startAtLabel }}</div><div class="mini-main"><strong>{{ order.serviceName }}</strong><span>{{ order.technicianName }} · {{ order.customerName || '预约顾客' }}</span></div><span class="pill rose">{{ order.statusLabel }}</span></div></div><div v-else class="empty-inline">今天暂时没有待到店订单。</div></section><section class="panel quote-panel"><span class="quote-mark">“</span><span class="eyebrow">STORE NOTE</span><h2>把时间安排好，<br />顾客会感受到。</h2><p>确认到店后再开始服务，服务完成后系统会自动发放积分。</p></section></div>
        </section>

        <section v-else-if="page === 'orders'" class="page-section"><div class="page-intro"><div><span class="eyebrow">BOOKING ORDERS</span><h1>预约订单</h1><p>核销、开始服务和整单退款都必须经过有权限的业务操作。</p></div><div class="filter-row"><select v-model="orderFilter" @change="loadOrders"><option value="">全部状态</option><option value="PENDING_PAYMENT">待付款</option><option value="RESERVED">待到店</option><option value="ARRIVED">已到店</option><option value="IN_SERVICE">服务中</option><option value="COMPLETED">已完成</option><option value="CANCELLED_BY_USER">已取消</option></select></div></div><section class="panel table-panel"><table><thead><tr><th>预约时间</th><th>项目 / 技师</th><th>顾客</th><th>状态</th><th>实付</th><th>操作</th></tr></thead><tbody><tr v-for="order in orders" :key="order.id"><td><strong>{{ order.startAtLabel }}</strong><small>{{ order.id }}</small></td><td><strong>{{ order.serviceName }}</strong><small>{{ order.technicianName }}</small></td><td><strong>{{ order.customerName || '—' }}</strong><small>{{ order.phoneMasked || '按权限展示' }}</small></td><td><span :class="['pill', order.status === 'COMPLETED' ? 'green' : order.status === 'RESERVED' ? 'rose' : 'sand']">{{ order.statusLabel }}</span><small v-if="order.refundStatus">{{ order.refundStatus }}</small></td><td class="money-cell">{{ money(order.paidFen) }}</td><td><button v-if="['RESERVED', 'ARRIVED', 'IN_SERVICE'].includes(order.status)" class="link-action" @click="page = 'orders'">工作台处理</button><button v-if="order.status === 'RESERVED' && !order.refundStatus" class="link-action danger-link" @click="refund(order)">整单退款</button><span v-if="!['RESERVED', 'ARRIVED', 'IN_SERVICE'].includes(order.status) && !order.refundStatus" class="muted-cell">—</span></td></tr></tbody></table><div v-if="!orders.length" class="empty-inline">没有符合条件的订单。</div></section></section>

        <section v-else-if="page === 'services'" class="page-section"><div class="page-intro"><div><span class="eyebrow">CATALOG</span><h1>项目与作品</h1><p>项目价格单位是分，发布新规则只影响新订单；历史订单保留快照。</p></div><button class="primary-button" @click="editingService = null; Object.assign(serviceDraft, { id: `svc-new-${Date.now()}`, categoryId: 'nail', categoryName: '美甲', name: '', description: '', priceFen: 0, durationMinutes: 60, bufferMinutes: 15, enabled: true, sort: 99 }); page = 'services'">+ 新建项目</button></div><section class="panel table-panel"><div class="panel-heading"><div><h2>服务项目</h2><span class="panel-subtitle">{{ catalog.services.length }} 个项目</span></div></div><table><thead><tr><th>项目</th><th>类别</th><th>价格</th><th>时长</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="service in catalog.services" :key="service.id"><td><strong>{{ service.name }}</strong><small>{{ service.description }}</small></td><td>{{ service.categoryName }}</td><td class="money-cell">{{ money(service.priceFen) }}</td><td>{{ service.durationMinutes }} 分钟 <small>+ {{ service.bufferMinutes }} 分钟缓冲</small></td><td><span :class="['pill', service.enabled ? 'green' : 'sand']">{{ service.enabled ? '已启用' : '已下架' }}</span></td><td><button class="link-action" @click="beginEdit(service)">编辑</button></td></tr></tbody></table></section><section v-if="editingService || serviceDraft.id" class="editor-panel panel"><div class="panel-heading"><div><span class="eyebrow">SERVICE EDITOR</span><h2>{{ editingService ? '编辑项目' : '新建项目' }}</h2></div><button class="icon-button" @click="cancelEdit">×</button></div><div class="form-grid"><label>项目名称<input v-model="serviceDraft.name" maxlength="80" /></label><label>分类<select v-model="serviceDraft.categoryId"><option value="nail">美甲</option><option value="brow">美眉</option><option value="tattoo">纹绣</option></select></label><label>价格（元）<input v-model.number="serviceDraft.priceFen" type="number" min="0" step="0.01" /></label><label>时长（分钟）<input v-model.number="serviceDraft.durationMinutes" type="number" min="1" /></label><label>缓冲（分钟）<input v-model.number="serviceDraft.bufferMinutes" type="number" min="0" /></label><label>排序<input v-model.number="serviceDraft.sort" type="number" min="0" /></label><label class="full">项目说明<textarea v-model="serviceDraft.description" maxlength="1000"></textarea></label><label class="check-label"><input v-model="serviceDraft.enabled" type="checkbox" /> 对顾客展示</label></div><div class="editor-actions"><button class="soft-button" @click="cancelEdit">取消</button><button class="primary-button" :disabled="saving" @click="saveService">{{ saving ? '保存中…' : '保存项目' }}</button></div></section></section>

        <section v-else-if="page === 'technicians'" class="page-section">
          <div class="page-intro">
            <div><span class="eyebrow">TEAM & SCHEDULE</span><h1>技师排班</h1><p>每周模板作为默认排班，指定日期可以覆盖；已有预约的时段不能被新排班覆盖。</p></div>
            <label class="date-picker">查看日期<input v-model="scheduleDate" type="date" /></label>
          </div>
          <div v-if="scheduleLoading" class="schedule-loading"><div class="loader"></div><span>正在读取排班…</span></div>
          <template v-else>
            <section class="panel schedule-template-panel">
              <div class="panel-heading"><div><span class="eyebrow">WEEKLY TEMPLATE</span><h2>每周营业排班模板</h2><span class="panel-subtitle">未设置指定日期覆盖时，预约会按这里生成可用时段。</span></div><button class="primary-button" :disabled="scheduleSaving" @click="saveWeekly">{{ scheduleSaving ? '发布中…' : '发布每周模板' }}</button></div>
              <div class="weekly-grid">
                <div v-for="day in weeklyDraft" :key="day.weekday" class="weekly-day">
                  <div class="weekly-day-heading"><strong>{{ weekdayLabel(day.weekday) }}</strong><label class="inline-check"><input v-model="day.enabled" type="checkbox" /> 营业</label></div>
                  <div v-for="(shift, shiftIndex) in day.shifts" :key="`${day.weekday}-${shiftIndex}`" class="shift-editor">
                    <div class="schedule-field-row"><label>开始<input v-model="shift.start" type="time" :disabled="!day.enabled" /></label><label>结束<input v-model="shift.end" type="time" :disabled="!day.enabled" /></label><button class="icon-button" type="button" :disabled="!day.enabled" @click="removeShift(day, shiftIndex)">×</button></div>
                    <div v-for="(breakWindow, breakIndex) in shift.breaks" :key="`${day.weekday}-${shiftIndex}-break-${breakIndex}`" class="break-row"><span>休息</span><input v-model="breakWindow.start" type="time" :disabled="!day.enabled" /><span>至</span><input v-model="breakWindow.end" type="time" :disabled="!day.enabled" /><button class="text-button" type="button" :disabled="!day.enabled" @click="removeBreak(shift, breakIndex)">移除</button></div>
                    <button class="text-button add-break-button" type="button" :disabled="!day.enabled" @click="addBreak(shift)">+ 添加休息时间</button>
                  </div>
                  <button class="soft-button add-shift-button" type="button" :disabled="!day.enabled" @click="addShift(day)">+ 添加班次</button>
                </div>
              </div>
            </section>

            <section class="panel schedule-technicians-panel">
              <div class="panel-heading"><div><span class="eyebrow">DAILY OVERRIDES</span><h2>{{ scheduleDate }} 的技师安排</h2><span class="panel-subtitle">点击技师后编辑当天班次或请假状态。</span></div><button class="soft-button" @click="loadSchedule">刷新排班 ↻</button></div>
              <div class="team-grid schedule-team-grid">
                <article v-for="technician in schedule.technicians" :key="technician.id" :class="['team-card', 'panel', { selected: technician.id === selectedTechnicianId }]" @click="selectTechnician(technician.id)">
                  <div class="team-avatar">{{ technician.name.slice(0, 1) }}</div>
                  <div class="team-copy"><h2>{{ technician.name }}</h2><span>{{ technician.title }}</span><p>{{ technician.plan.leave ? '当天休息 / 请假' : technician.plan.shifts.map((shift) => `${shift.start}—${shift.end}`).join(' · ') || '暂无工作班次' }}</p><div class="skill-list"><i v-for="skill in technician.skills" :key="skill">{{ catalog.services.find((item) => item.id === skill)?.name || skill }}</i></div></div>
                  <span :class="['pill', technician.plan.source === 'override' ? 'rose' : 'green']">{{ technician.plan.source === 'override' ? '当日覆盖' : '每周模板' }}</span>
                  <button class="text-button schedule-edit-button" type="button" @click.stop="selectTechnician(technician.id)">编辑当天</button>
                </article>
              </div>
              <div v-if="!schedule.technicians.length" class="empty-inline">还没有可编辑的技师。</div>
            </section>

            <section v-if="selectedScheduleTechnician" class="panel day-editor-panel">
              <div class="panel-heading"><div><span class="eyebrow">DAY EDITOR</span><h2>{{ selectedScheduleTechnician.name }} · {{ scheduleDate }}</h2><span class="panel-subtitle">{{ dayDraft.source === 'override' ? '当前日期使用独立覆盖排班。' : '当前日期继承每周模板，保存后会创建独立覆盖。' }}<template v-if="dayDraft.occupancyCount">已有 {{ dayDraft.occupancyCount }} 个有效预约。</template></span></div><span :class="['pill', dayDraft.leave ? 'sand' : 'green']">{{ dayDraft.leave ? '休息 / 请假' : '可排班' }}</span></div>
              <label class="leave-toggle"><input v-model="dayDraft.leave" type="checkbox" /> 当天休息 / 请假</label>
              <div v-if="!dayDraft.leave" class="day-shifts">
                <div v-for="(shift, shiftIndex) in dayDraft.shifts" :key="`day-${shiftIndex}`" class="day-shift-card">
                  <div class="schedule-field-row"><label>开始<input v-model="shift.start" type="time" /></label><label>结束<input v-model="shift.end" type="time" /></label><button class="icon-button" type="button" @click="removeShift(dayDraft, shiftIndex)">×</button></div>
                  <div v-for="(breakWindow, breakIndex) in shift.breaks" :key="`day-${shiftIndex}-break-${breakIndex}`" class="break-row"><span>休息</span><input v-model="breakWindow.start" type="time" /><span>至</span><input v-model="breakWindow.end" type="time" /><button class="text-button" type="button" @click="removeBreak(shift, breakIndex)">移除</button></div>
                  <button class="text-button add-break-button" type="button" @click="addBreak(shift)">+ 添加休息时间</button>
                </div>
                <button class="soft-button add-shift-button" type="button" @click="addShift(dayDraft)">+ 添加班次</button>
              </div>
              <div v-if="dayDraft.occupancyCount" class="schedule-warning">已有预约的时段会被服务端保护。若保存后的班次覆盖预约，系统会拒绝保存并要求先处理订单。</div>
              <div class="editor-actions"><span class="editor-hint">版本 v{{ dayDraft.version }} · 保存后只影响 {{ scheduleDate }}</span><button class="primary-button" :disabled="scheduleSaving" @click="saveDaySchedule">{{ scheduleSaving ? '保存中…' : '保存当天排班' }}</button></div>
            </section>
          </template>
        </section>

        <section v-else-if="page === 'settings'" class="page-section"><div class="page-intro"><div><span class="eyebrow">RULES & STORE</span><h1>预约与积分规则</h1><p>规则以版本发布，历史订单读取自己的规则快照。</p></div><span class="version-chip">当前版本 v{{ settings.version }}</span></div><section class="panel settings-panel"><div class="settings-block"><div class="settings-block-heading"><h2>门店资料</h2><span>顾客端首页展示</span></div><div class="form-grid"><label>门店名称<input v-model="settings.store.storeName" /></label><label>联系电话<input v-model="settings.store.phone" placeholder="可选" /></label><label class="full">地址<input v-model="settings.store.address" /></label><label class="full">预约须知<textarea v-model="settings.store.notice"></textarea></label></div></div><div class="settings-block"><div class="settings-block-heading"><h2>预约规则</h2><span>影响新报价和占位任务</span></div><div class="form-grid four"><label>开放天数<input v-model.number="settings.booking.openDays" type="number" min="1" max="14" /></label><label>最少提前分钟<input v-model.number="settings.booking.minAdvanceMinutes" type="number" min="1" /></label><label>未支付占位分钟<input v-model.number="settings.booking.unpaidHoldMinutes" type="number" min="1" /></label><label>未核销宽限分钟<input v-model.number="settings.booking.noShowGraceMinutes" type="number" min="1" /></label></div></div><div class="settings-block"><div class="settings-block-heading"><h2>积分规则</h2><span>积分余额只能通过业务流水变更</span></div><div class="form-grid four"><label>每满多少分获 1 积分<input v-model.number="settings.points.pointRateFen" type="number" min="1" /></label><label>抵扣单位积分<input v-model.number="settings.points.unit" type="number" min="1" /></label><label>每单位抵扣分<input v-model.number="settings.points.discountFen" type="number" min="1" /></label><label>单笔最高抵扣 %<input v-model.number="settings.points.maxPercent" type="number" min="0" max="100" /></label></div></div><div class="settings-actions"><span>保存后自动生成新版本，并写入审计日志。</span><button class="primary-button" :disabled="saving" @click="saveSettings">{{ saving ? '发布中…' : '发布新规则' }}</button></div></section></section>

        <section v-else-if="page === 'payment'" class="page-section"><div class="page-intro"><div><span class="eyebrow">WECHAT PAY API V3</span><h1>微信支付接入</h1><p>当前先完成能力和流程预留，资质验证通过后再填写服务端环境变量。</p></div><span :class="['connection-state', paymentStatus.configured ? 'ready' : 'pending']"><i></i>{{ paymentStatus.configured ? '已配置' : '待配置' }}</span></div><section class="payment-grid"><div class="panel payment-status-panel"><div class="status-illustration">¥</div><h2>{{ paymentStatus.configured ? '支付参数已齐备' : '等待个体工商户资质' }}</h2><p>{{ paymentStatus.configured ? '仍需在真机完成支付、回调、查单和真实退款闭环。' : '你拿到商户号和小程序支付权限后，只需在 CloudBase 服务端补齐参数，前端页面无需改动。' }}</p><div v-if="paymentStatus.missing.length" class="missing-list"><div v-for="item in paymentStatus.missing" :key="item"><span>○</span>{{ item }}</div></div><div class="cert-state"><span :class="paymentStatus.callbackCertificateConfigured ? 'ok' : ''">{{ paymentStatus.callbackCertificateConfigured ? '✓' : '○' }}</span>微信支付平台证书（回调验签）</div></div><div class="panel checklist-panel"><span class="eyebrow">ONBOARDING CHECKLIST</span><h2>接入前置项</h2><ol><li><span>01</span><div><strong>小程序主体认证</strong><small>使用营业执照完成主体认证，并申请小程序支付权限。</small></div></li><li><span>02</span><div><strong>普通商户直连</strong><small>申请商户号，完成商户号与 AppID 绑定。</small></div></li><li><span>03</span><div><strong>服务端密钥</strong><small>配置商户私钥、证书序列号、API v3 密钥，不进入小程序和浏览器。</small></div></li><li><span>04</span><div><strong>公网 HTTPS 回调</strong><small>配置 payment-callback 云函数入口，保留原始请求体并完成验签解密。</small></div></li><li><span>05</span><div><strong>真机闭环</strong><small>预约、支付、查单、核销、完成、取消和真实退款全部通过后再上线。</small></div></li></ol></div></section><section class="panel env-panel"><div class="panel-heading"><div><span class="eyebrow">SERVER-ONLY CONFIG</span><h2>需要填写的环境变量</h2></div><span class="security-note">不会在此页面显示值</span></div><div class="env-grid"><code>WX_APPID</code><code>WX_MCH_ID</code><code>WX_MCH_SERIAL_NO</code><code>WX_API_V3_KEY</code><code>WX_PRIVATE_KEY</code><code>WX_NOTIFY_URL</code><code>WX_PLATFORM_CERT_PEM</code><code>CONTACT_ENCRYPTION_KEY</code></div><p class="env-footnote">支付请求和回调均由云函数服务端处理；配置不完整时系统会保留订单并明确提示，不会假报支付成功。</p></section></section>
      </template>
    </main>
  </div>
</template>
