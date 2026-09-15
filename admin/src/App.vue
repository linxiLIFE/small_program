<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import DashboardPanel from './components/DashboardPanel.vue';
import HomeManager from './components/HomeManager.vue';
import CatalogManager from './components/CatalogManager.vue';
import FeaturedManager from './components/FeaturedManager.vue';
import TeamManager from './components/TeamManager.vue';
import MySchedulePanel from './components/MySchedulePanel.vue';
import AdminOrdersPanel from './components/AdminOrdersPanel.vue';
import type { SessionInfo } from './types';
import { adminApi, isDemoMode } from './api';
import { getCurrentUser, signIn as cloudSignIn, signOut as cloudSignOut, type AuthUser } from './cloudbase';
import type { Work, BreakWindow, CatalogResponse, PageKey, ScheduleResponse, Service, Settings, Shift, TechnicianDayPlan, WeeklySchedule } from './types';

const authReady = ref(false);
const authenticated = ref(false);
const authBusy = ref(false);
const authError = ref('');
const loginUsername = ref('');
const loginPassword = ref('');
const currentUser = ref<AuthUser | null>(null);
const page = ref<PageKey>('dashboard');
const previewTechnicianId=ref('');
const sessionInfo=ref<SessionInfo>({role:'UNASSIGNED',name:''});
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const demo = isDemoMode();
const catalog = ref<CatalogResponse>({ categories: [], services: [], works: [], technicians: [] });
const settings = reactive<Settings>({ version: 1, store: { storeName: '四个小姐姐的店', address: '', phone: '', notice: '', latitude: null, longitude: null }, booking: { openDays: 14, minAdvanceMinutes: 60, slotStepMinutes: 15, unpaidHoldMinutes: 5, refundCutoffMinutes: 120, noShowGraceMinutes: 15, noShowPenaltyFen: 3000, noShowPolicy: 'AUTO_PARTIAL_REFUND' }, points: { pointRateFen: 100, unit: 20, discountFen: 100, maxPercent: 10, inviteRewardPoints: 10 }, notifications: { enabled:false, arrivalLeadMinutes:120, templates:{ appointmentSuccess:{templateId:'',page:'pages/order-detail/index',serviceKey:'thing1',timeKey:'time2',technicianKey:'thing3'}, arrivalReminder:{templateId:'',page:'pages/order-detail/index',serviceKey:'thing1',timeKey:'time2',addressKey:'thing3'}, checkInSuccess:{templateId:'',page:'pages/order-detail/index',serviceKey:'thing1',timeKey:'time2',technicianKey:'thing3'}, noShowRefund:{templateId:'',page:'pages/order-detail/index',serviceKey:'thing1',amountKey:'amount2',statusKey:'phrase3'} } } });
const editingService = ref<Service | null>(null);
const serviceDraft = reactive<Partial<Service>>({});
const scheduleDate = ref(todayDate());
const scheduleLoading = ref(false);
const scheduleSaving = ref(false);
const schedule = ref<ScheduleResponse>({ date: scheduleDate.value, scheduleVersion: 1, weekly: [], technicians: [] });
const selectedTechnicianId = ref('');
const weeklyDraft = ref<WeeklySchedule[]>([]);
const dayDraft = reactive<TechnicianDayPlan>({ id: '', technicianId: '', date: scheduleDate.value, weekday: 1, leave: false, shifts: [], source: 'weekly', version: 1, occupancyCount: 0, occupiedIntervals: [] });
const currentUserLabel = computed(() => sessionInfo.value.name || currentUser.value?.username || currentUser.value?.email || currentUser.value?.uid || '管理员');
const mapPickerKey = String(import.meta.env.VITE_TENCENT_MAP_KEY || '').trim();
const mapPickerOpen = ref(false);
const mapPickerUrl = computed(() => mapPickerKey
  ? `https://apis.map.qq.com/tools/locpicker?search=1&type=1&key=${encodeURIComponent(mapPickerKey)}&referer=shiguang-admin`
  : '');
const noShowPenaltyYuan = computed({ get:()=>Number(settings.booking.noShowPenaltyFen||0)/100, set:(value:number)=>{settings.booking.noShowPenaltyFen=Math.max(0,Math.round(Number(value||0)*100));} });

const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const storeDateFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' });
const todayLabel = computed(() => storeDateFormatter.format(new Date()));

function todayDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function weekdayLabel(value: number): string {
  return weekdayLabels[Math.max(0, Number(value) - 1)] || '—';
}

function timeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
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
  { id: 'home', label: '首页宣传', icon: '▧' },
  { id: 'services', label: '项目与款式', icon: '✦' },
  { id: 'featured', label: '精选管理', icon: '★' },
  { id: 'team', label: '技师管理', icon: '♧' },
  { id: 'technicians', label: '技师排班', icon: '♧' },
  { id: 'settings', label: '门店与预约设置', icon: '⚙' }
];

const visibleNav=computed(()=>sessionInfo.value.role==='TECHNICIAN'?[{id:'my-schedule' as PageKey,label:'我的排班',icon:'◷'}]:navItems);
const pageTitle = computed(() => visibleNav.value.find((item) => item.id === page.value)?.label || (page.value === 'my-schedule' ? '我的排班' : '经营概览'));

function formatDate(date: string): string { return date ? date.replace(/-/g, '.') : '—'; }

async function restoreSession() {
  if (demo) {
    currentUser.value = { uid: 'demo-owner', username: '演示管理员' };
    authenticated.value = true;
    authReady.value = true;
    await loadAll();
    return;
  }
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
    loading.value = false;
    page.value = 'dashboard';
    catalog.value = { categories: [], services: [], works: [], technicians: [] };
  }
}

async function loadAll() {
  loading.value = true;
  error.value = '';
  try {
    sessionInfo.value=await adminApi.session();
    if(sessionInfo.value.role==='UNASSIGNED')throw new Error('当前账号未被授权。首个店主必须通过受控部署脚本或数据库控制台预先配置。');
    if(sessionInfo.value.role==='TECHNICIAN'){previewTechnicianId.value='';page.value='my-schedule';return;}
    const tasks = [
      async()=>{catalog.value=await adminApi.catalog();},
      async()=>{Object.assign(settings,await adminApi.settings());},
      async()=>{const result=await adminApi.schedule(scheduleDate.value);schedule.value=result;weeklyDraft.value=clone(result.weekly);syncDayDraft();}
    ];
    const failures:string[]=[];
    for(let i=0;i<tasks.length;i+=2){const results=await Promise.allSettled(tasks.slice(i,i+2).map(task=>task()));for(const result of results)if(result.status==='rejected')failures.push(result.reason instanceof Error?result.reason.message:'加载失败');}
    if(failures.length)error.value=Array.from(new Set(failures)).join('；');
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败';
  } finally {
    loading.value = false;
  }
}

function openTechnicianWorkspace(id:string){previewTechnicianId.value=id;page.value='my-schedule';}
async function refreshCatalog() { try { catalog.value=await adminApi.catalog(); } catch(err){error.value=err instanceof Error?err.message:'刷新失败';} }
async function openTechnicianSchedule(id:string){selectedTechnicianId.value=id;page.value='technicians';await loadSchedule();}

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
  error.value='';notice.value='';
  saving.value = true;
  try {
    const saved = await adminApi.saveSettings({ ...settings, reason: '管理后台发布门店与预约设置' });
    Object.assign(settings, saved);
    notice.value = '设置已保存';
  } catch (err) { error.value = err instanceof Error ? err.message : '规则保存失败'; } finally { saving.value = false; }
}

function openMapPicker() {
  if (!mapPickerKey) {
    window.open('https://lbs.qq.com/getPoint/', '_blank', 'noopener,noreferrer');
    notice.value = '地图选点页已打开；复制经纬度后分别填入经度和纬度。配置 VITE_TENCENT_MAP_KEY 后可直接回填。';
    return;
  }
  mapPickerOpen.value = true;
}

function useBrowserLocation() {
  if (!navigator.geolocation) {
    error.value = '当前浏览器不支持读取位置，请手动选择地图坐标。';
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    settings.store.latitude = Number(position.coords.latitude.toFixed(6));
    settings.store.longitude = Number(position.coords.longitude.toFixed(6));
    notice.value = '已填入当前位置坐标，请确认是否为门店位置后再保存。';
  }, () => {
    error.value = '无法读取当前位置，请允许浏览器定位或使用地图选点。';
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function handleMapMessage(event: MessageEvent) {
  if (!mapPickerOpen.value) return;
  let payload: any = event.data;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return; }
  }
  if (!payload || (payload.module && payload.module !== 'locationPicker')) return;
  const point = payload.latlng || payload.location || payload;
  const latitude = Number(point.lat ?? point.latitude);
  const longitude = Number(point.lng ?? point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  settings.store.latitude = Number(latitude.toFixed(6));
  settings.store.longitude = Number(longitude.toFixed(6));
  if (payload.poiaddress) settings.store.address = String(payload.poiaddress).trim();
  mapPickerOpen.value = false;
  notice.value = '地图位置已回填，请保存设置后在小程序中验证导航。';
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
    const result = await adminApi.saveWeeklySchedule(clone(weeklyDraft.value), schedule.value.scheduleVersion, '管理后台发布每周营业排班模板');
    notice.value = '每周排班已保存';
    await loadSchedule();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '每周模板保存失败';
  } finally {
    scheduleSaving.value = false;
  }
}

watch(scheduleDate, () => {
  if (authenticated.value && page.value === 'technicians') loadSchedule();
});

watch(page, (nextPage) => {
  if (authenticated.value && ['services','featured','team'].includes(nextPage)) refreshCatalog();
  if (authenticated.value && nextPage === 'technicians' && !schedule.value.technicians.length) loadSchedule();
});

onMounted(restoreSession);
onMounted(() => window.addEventListener('message', handleMapMessage));
onBeforeUnmount(() => window.removeEventListener('message', handleMapMessage));
</script>

<template>
  <div v-if="!authReady" class="auth-loading"><div class="loader"></div><span>正在检查登录会话…</span></div>

  <section v-else-if="!authenticated" class="login-shell">
    <div class="login-card">
      <div class="login-brand"><span class="brand-mark">✦</span><div><strong>四个小姐姐的店</strong></div></div>

      <h1>登录门店后台</h1>

      <div v-if="authError" class="login-error">{{ authError }}</div>
      <form class="login-form" @submit.prevent="submitLogin">
        <label>用户名<input v-model="loginUsername" autocomplete="username" autofocus placeholder="请输入用户名" /></label>
        <label>密码<input v-model="loginPassword" autocomplete="current-password" type="password" placeholder="请输入密码" /></label>
        <button class="primary-button login-button" :disabled="authBusy" type="submit">{{ authBusy ? '登录中…' : '登录后台' }}</button>
      </form>

    </div>
  </section>

  <div v-else class="admin-app">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">✦</span><div><strong>四个小姐姐的店</strong></div></div>
      <div v-if="demo" class="demo-chip">演示模式</div>
      <nav><button v-for="item in visibleNav" :key="item.id" :class="['nav-item', { active: page === item.id }]" @click="page = item.id"><span class="nav-icon">{{ item.icon }}</span>{{ item.label }}</button></nav>
      <div class="sidebar-foot"><span class="status-dot"></span><span>{{sessionInfo.role === 'TECHNICIAN' ? '技师工作台' : '门店管理'}}</span></div>
    </aside>

    <main class="main-content">
      <header class="topbar"><div><span class="breadcrumb">四个小姐姐的店 / </span><strong>{{ pageTitle }}</strong></div><div class="topbar-right"><span class="date-label">今天 · {{ todayLabel }}</span><span class="user-label" :title="currentUser?.uid">{{ currentUserLabel }}</span><button class="logout-button" @click="logout">退出</button><span class="avatar">店</span></div></header>

      <div v-if="error" class="alert error">{{ error }} <button @click="error = ''">×</button></div>
      <div v-if="notice" class="alert success">{{ notice }} <button @click="notice = ''">×</button></div>

      <div v-if="loading" class="loading-state"><div class="loader"></div><span>正在整理门店数据…</span></div>

      <template v-else>
        <DashboardPanel v-if="page === 'dashboard'"/>
        <HomeManager v-else-if="page === 'home'" :settings="settings" @saved="Object.assign(settings,$event)"/>

        <AdminOrdersPanel v-else-if="page === 'orders'" :catalog="catalog"/>

        <CatalogManager v-else-if="page === 'services'" :catalog="catalog" @changed="refreshCatalog"/>
        <FeaturedManager v-else-if="page === 'featured'" :catalog="catalog" @changed="refreshCatalog"/>
        <TeamManager v-else-if="page === 'team'" :catalog="catalog" @changed="refreshCatalog" @schedule="openTechnicianSchedule" @workspace="openTechnicianWorkspace"/>
        <MySchedulePanel v-else-if="page === 'my-schedule'" :key="previewTechnicianId" :technician-id="previewTechnicianId"/>

        <section v-else-if="page === 'technicians'" class="page-section">
          <div class="page-intro">
            <div><h1>技师排班</h1></div>
            <label class="date-picker">查看日期<input v-model="scheduleDate" type="date" /></label>
          </div>
          <div v-if="scheduleLoading" class="schedule-loading"><div class="loader"></div><span>正在读取排班…</span></div>
          <template v-else>
            <section class="panel schedule-template-panel">
              <div class="panel-heading"><div><h2>每周营业排班模板</h2><span class="panel-subtitle">未设置指定日期覆盖时，预约会按这里生成可用时段。</span></div><button class="primary-button" :disabled="scheduleSaving" @click="saveWeekly">{{ scheduleSaving ? '保存中…' : '保存每周排班' }}</button></div>
              <div class="weekly-grid">
                <div v-for="day in weeklyDraft" :key="day.weekday" class="weekly-day">
                  <div class="weekly-day-heading"><strong>{{ weekdayLabel(day.weekday) }}</strong><label class="inline-check"><input v-model="day.enabled" type="checkbox" /> 营业</label></div>
                  <div v-for="(shift, shiftIndex) in day.shifts" :key="`${day.weekday}-${shiftIndex}`" class="shift-editor">
                    <div class="schedule-field-row"><label>开始<input v-model="shift.start" type="time" step="900" :disabled="!day.enabled" /></label><label>结束<input v-model="shift.end" type="time" step="900" :disabled="!day.enabled" /></label><button class="icon-button" type="button" :disabled="!day.enabled" @click="removeShift(day, shiftIndex)">×</button></div>
                    <div v-for="(breakWindow, breakIndex) in shift.breaks" :key="`${day.weekday}-${shiftIndex}-break-${breakIndex}`" class="break-row"><span>休息</span><input v-model="breakWindow.start" type="time" step="900" :disabled="!day.enabled" /><span>至</span><input v-model="breakWindow.end" type="time" step="900" :disabled="!day.enabled" /><button class="text-button" type="button" :disabled="!day.enabled" @click="removeBreak(shift, breakIndex)">移除</button></div>
                    <button class="text-button add-break-button" type="button" :disabled="!day.enabled" @click="addBreak(shift)">+ 添加休息时间</button>
                  </div>
                  <button class="soft-button add-shift-button" type="button" :disabled="!day.enabled" @click="addShift(day)">+ 添加班次</button>
                </div>
              </div>
            </section>

            <section class="panel schedule-technicians-panel">
              <div class="panel-heading"><div><h2>{{ scheduleDate }} 的技师安排</h2><span class="panel-subtitle">点击技师后编辑当天班次或请假状态。</span></div><button class="soft-button" @click="loadSchedule">刷新排班 ↻</button></div>
              <div class="team-grid schedule-team-grid">
                <article v-for="technician in schedule.technicians" :key="technician.id" :class="['team-card', 'panel', { selected: technician.id === selectedTechnicianId }]" @click="selectTechnician(technician.id)">
                  <div class="team-avatar">{{ technician.name.slice(0, 1) }}</div>
                  <div class="team-copy"><h2>{{ technician.name }}</h2><span>{{ technician.title }}</span><p>{{ technician.plan.leave ? '当天休息 / 请假' : technician.plan.shifts.map((shift) => `${shift.start}—${shift.end}`).join(' · ') || '暂无工作班次' }}</p><div class="skill-list"><i v-for="categoryId in technician.categoryIds" :key="categoryId">{{ catalog.categories.find((item) => item.id === categoryId)?.name || categoryId }}</i></div></div>
                  <span :class="['pill', technician.plan.source === 'override' ? 'rose' : 'green']">{{ technician.plan.source === 'override' ? '当日覆盖' : '每周模板' }}</span>
                  <button class="text-button schedule-edit-button" type="button" @click.stop="selectTechnician(technician.id)">编辑当天</button>
                </article>
              </div>
              <div v-if="!schedule.technicians.length" class="empty-inline">还没有可编辑的技师。</div>
            </section>

            <section v-if="selectedScheduleTechnician" class="panel day-editor-panel">
              <div class="panel-heading"><div><h2>{{ selectedScheduleTechnician.name }} · {{ scheduleDate }}</h2><span class="panel-subtitle">{{ dayDraft.source === 'override' ? '当前日期使用独立覆盖排班。' : '当前日期继承每周模板，保存后会创建独立覆盖。' }}<template v-if="dayDraft.occupancyCount">已有 {{ dayDraft.occupancyCount }} 个有效预约。</template></span></div><span :class="['pill', dayDraft.leave ? 'sand' : 'green']">{{ dayDraft.leave ? '休息 / 请假' : '可排班' }}</span></div>
              <label class="leave-toggle"><input v-model="dayDraft.leave" type="checkbox" /> 当天休息 / 请假</label>
              <div v-if="!dayDraft.leave" class="day-shifts">
                <div v-for="(shift, shiftIndex) in dayDraft.shifts" :key="`day-${shiftIndex}`" class="day-shift-card">
                  <div class="schedule-field-row"><label>开始<input v-model="shift.start" type="time" step="900" /></label><label>结束<input v-model="shift.end" type="time" step="900" /></label><button class="icon-button" type="button" @click="removeShift(dayDraft, shiftIndex)">×</button></div>
                  <div v-for="(breakWindow, breakIndex) in shift.breaks" :key="`day-${shiftIndex}-break-${breakIndex}`" class="break-row"><span>休息</span><input v-model="breakWindow.start" type="time" step="900" /><span>至</span><input v-model="breakWindow.end" type="time" step="900" /><button class="text-button" type="button" @click="removeBreak(shift, breakIndex)">移除</button></div>
                  <button class="text-button add-break-button" type="button" @click="addBreak(shift)">+ 添加休息时间</button>
                </div>
                <button class="soft-button add-shift-button" type="button" @click="addShift(dayDraft)">+ 添加班次</button>
              </div>
              <div v-if="dayDraft.occupancyCount" class="schedule-warning">已有预约的时段会被服务端保护。若保存后的班次覆盖预约，系统会拒绝保存并要求先处理订单。</div>
              <div class="editor-actions"><button class="primary-button" :disabled="scheduleSaving" @click="saveDaySchedule">{{ scheduleSaving ? '保存中…' : '保存当天排班' }}</button></div>
            </section>
          </template>
        </section>

        <section v-else-if="page === 'settings'" class="page-section">
          <div class="page-intro"><div><h1>门店与预约设置</h1><p>保存后的规则只影响新订单，旧订单继续使用下单时的规则。</p></div></div>
          <section class="panel settings-panel">
            <div class="settings-block"><div class="settings-block-heading"><h2>门店资料</h2></div><div class="form-grid"><label>门店名称<input v-model="settings.store.storeName" /></label><label>联系电话<input v-model="settings.store.phone" placeholder="可选" /></label><label class="full">地址<input v-model="settings.store.address" /></label><label>地图经度<input v-model.number="settings.store.longitude" type="number" step="any" min="-180" max="180"/></label><label>地图纬度<input v-model.number="settings.store.latitude" type="number" step="any" min="-90" max="90"/></label><div class="full map-helper"><button class="soft-button" type="button" @click="openMapPicker">地图选点</button><button class="soft-button" type="button" @click="useBrowserLocation">使用当前位置</button></div><label class="full">预约须知<textarea v-model="settings.store.notice"></textarea></label></div></div>
            <div class="settings-block"><div class="settings-block-heading"><h2>取消与未到店规则</h2><span>小程序预约页会同步展示</span></div><div class="form-grid four"><label>可提前取消（分钟）<input v-model.number="settings.booking.refundCutoffMinutes" type="number" min="0" max="10080"/><small>默认 120 分钟</small></label><label>未核销宽限（分钟）<input v-model.number="settings.booking.noShowGraceMinutes" type="number" min="1" max="1440"/><small>默认开始后 15 分钟</small></label><label>未到店违约金（元）<input v-model.number="noShowPenaltyYuan" type="number" min="0" max="10000" step="0.01"/><small>积分优先承担</small></label><label>未到店处理方式<select v-model="settings.booking.noShowPolicy"><option value="AUTO_PARTIAL_REFUND">自动按规则退款</option></select><small>订单总额不足违约金时不退款</small></label></div></div>
            <div class="settings-block"><div class="settings-block-heading"><h2>预约基础规则</h2></div><div class="form-grid four"><label>开放天数<input v-model.number="settings.booking.openDays" type="number" min="1" max="14" /></label><label>最少提前分钟<input v-model.number="settings.booking.minAdvanceMinutes" type="number" min="1" /></label><label>15 分钟时段<input v-model.number="settings.booking.slotStepMinutes" type="number" min="15" max="15" readonly/></label><label>未支付占位分钟<input v-model.number="settings.booking.unpaidHoldMinutes" type="number" min="1" /></label></div></div>
            <div class="settings-block"><div class="settings-block-heading"><h2>积分与邀请</h2></div><div class="form-grid four"><label>每满多少分获 1 积分<input v-model.number="settings.points.pointRateFen" type="number" min="1" /></label><label>抵扣单位积分<input v-model.number="settings.points.unit" type="number" min="1" /></label><label>每单位抵扣分<input v-model.number="settings.points.discountFen" type="number" min="1" /></label><label>单笔最高抵扣 %<input v-model.number="settings.points.maxPercent" type="number" min="0" max="100" /></label><label>邀请双方各奖积分<input v-model.number="settings.points.inviteRewardPoints" type="number" min="0" max="100000"/><small>每位新用户只能绑定一次</small></label></div></div>
            <div class="settings-block"><div class="settings-block-heading"><h2>微信订阅提醒</h2><span>模板字段名需与公众平台模板一致</span></div><label class="switch-row"><span>启用订阅消息发送</span><input v-model="settings.notifications.enabled" type="checkbox"/></label><div class="form-grid notification-settings"><label>到店提醒提前分钟<input v-model.number="settings.notifications.arrivalLeadMinutes" type="number" min="15" max="10080"/></label><div v-for="(item,key) in settings.notifications.templates" :key="key" class="notification-template-card"><strong>{{({appointmentSuccess:'预约成功',arrivalReminder:'提醒到店',checkInSuccess:'核销成功',noShowRefund:'未到店退款'} as Record<string,string>)[key]}}</strong><label>模板 ID<input v-model.trim="item.templateId" placeholder="公众平台模板 ID"/></label><div class="template-key-grid"><label>项目字段<input v-model.trim="item.serviceKey" placeholder="thing1"/></label><label v-if="item.timeKey">时间字段<input v-model.trim="item.timeKey" placeholder="time2"/></label><label v-if="item.technicianKey">技师字段<input v-model.trim="item.technicianKey" placeholder="thing3"/></label><label v-if="item.addressKey">地址字段<input v-model.trim="item.addressKey" placeholder="thing3"/></label><label v-if="item.amountKey">金额字段<input v-model.trim="item.amountKey" placeholder="amount2"/></label><label v-if="item.statusKey">状态字段<input v-model.trim="item.statusKey" placeholder="phrase3"/></label></div></div></div><p class="form-help">模板 ID 和字段名可在微信公众平台「订阅消息 / 我的模板」复制。由于浏览器安全策略，本次无法代你读取当前 Chrome 登录页中的值。</p></div>
            <div class="settings-actions"><button class="primary-button" :disabled="saving" @click="saveSettings">{{ saving ? '保存中…' : '保存设置' }}</button></div>
          </section>
        </section>

      </template>
    </main>
    <div v-if="mapPickerOpen" class="map-picker-backdrop" @click.self="mapPickerOpen = false"><section class="map-picker-modal" role="dialog" aria-modal="true" aria-label="地图选点"><header><h2>选择门店位置</h2><button class="icon-button" type="button" @click="mapPickerOpen = false">×</button></header><iframe :src="mapPickerUrl" title="腾讯地图选点" allow="geolocation"></iframe><p>点击地图中的位置后，地址和经纬度会自动回填。</p></section></div>
  </div>
</template>
