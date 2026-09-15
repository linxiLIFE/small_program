import type { AnalyticsResponse, AdminOrderPage, AdminOrderQuery, Category, Technician, MySchedule, SessionInfo, Work, AdminOrder, CatalogResponse, ScheduleResponse, Service, Settings, TechnicianDayPlan, WeeklySchedule } from './types';
import { callBusiness } from './cloudbase';

let demoWorks: Work[] = [];
const demo = import.meta.env.VITE_ADMIN_DEMO === 'true';

export function isDemoMode(): boolean {
  return demo;
}

function money(fen: number): string {
  return `¥${(Number(fen || 0) / 100).toFixed(2)}`;
}

const demoServices: Service[] = [
  { id: 'svc-nail-french', categoryId: 'nail', categoryName: '美甲', name: '奶油法式美甲', description: '低饱和奶油色打底，搭配细线法式与手绘小花。', priceFen: 29900, durationMinutes: 90, coverUrl: '', enabled: true, sort: 1 },
  { id: 'svc-nail-jelly', categoryId: 'nail', categoryName: '美甲', name: '玫瑰果冻裸色', description: '透亮果冻感与轻薄加固。', priceFen: 23900, durationMinutes: 75, coverUrl: '', enabled: true, sort: 2 },
  { id: 'svc-brow-natural', categoryId: 'brow', categoryName: '美眉', name: '自然野生眉设计', description: '根据脸型、眉骨和毛流重新设计。', priceFen: 19900, durationMinutes: 60, coverUrl: '', enabled: true, sort: 3 }
];

let demoOrders: AdminOrder[] = [
  { id: 'demo-order-001', status: 'RESERVED', statusLabel: '待到店', serviceName: '奶油法式美甲', technicianName: '林老师', technicianId:'tech-lin', customerName: '演示顾客', phone: '13800138000', phoneMasked: '138****8000', startAtLabel: '9月9日 11:00', startAt:Date.now()+86400000,endAt:Date.now()+91800000,createdAt:Date.now()-86400000,paidAt:Date.now()-85000000,paidFen: 29900, remainingRefundableFen:29900, refundStatus: '' },
  { id: 'demo-order-002', status: 'COMPLETED', statusLabel: '已完成', serviceName: '自然野生眉设计', technicianName: '周老师', technicianId:'tech-zhou', customerName: '另一位顾客', phone: '13900000000', phoneMasked: '139****0000', startAtLabel: '9月7日 15:00', startAt:Date.now()-86400000,endAt:Date.now()-82800000,createdAt:Date.now()-172800000,paidAt:Date.now()-172000000,paidFen: 19900, remainingRefundableFen:19900, refundStatus: '' }
];

const demoSettings: Settings = {
  version: 1,
  store: { storeName: '四个小姐姐的店', address: '预约成功后展示详细地址', phone: '', notice: '每次预约只安排一位顾客和一位技师，请提前 5 分钟到店。' },
  booking: { openDays: 14, minAdvanceMinutes: 60, slotStepMinutes: 15, unpaidHoldMinutes: 5, refundCutoffMinutes: 120, noShowGraceMinutes: 15, noShowPenaltyFen: 3000, noShowPolicy: 'AUTO_PARTIAL_REFUND' },
  points: { pointRateFen: 100, unit: 20, discountFen: 100, maxPercent: 10, inviteRewardPoints: 10 },
  notifications: { enabled:false, arrivalLeadMinutes:120, templates: { appointmentSuccess:{templateId:'mSytTDc_RPzemCXFTmlP6_YfL2AXQmeRqmvfDIQnSiM',page:'pages/order-detail/index',serviceKey:'thing1',timeKey:'date2',technicianKey:'thing19'}, arrivalReminder:{templateId:'tUQNUcVIWkHmsNVtxD9ktPuKCCY7XtUoRFfbForuUoA',page:'pages/order-detail/index',serviceKey:'thing2',timeKey:'time1',addressKey:'thing7'}, checkInSuccess:{templateId:'YIZfXuyNr6qJeIts_ehZo8ivql7wOmx8Y5PDORMuzc4',page:'pages/order-detail/index',serviceKey:'thing1',timeKey:'time5'}, noShowRefund:{templateId:'rZ_ATdWSGPxs2X96QFO7889txX1acN-xQeIkjgZWdgE',page:'pages/order-detail/index',serviceKey:'thing1',amountKey:'amount6',storeKey:'thing3'} } }
};

const demoTechnicians = [
  { id: 'tech-lin', name: '林老师', title: '主理人 · 美甲师', bio: '擅长低饱和、法式与手绘细节。', categoryIds: ['nail'], enabled: true },
  { id: 'tech-zhou', name: '周老师', title: '高级眉形设计师', bio: '以自然毛流和面部比例为优先。', categoryIds: ['brow'], enabled: true }
];

const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const demoWeekly: WeeklySchedule[] = weekdayLabels.map((_, index) => ({ weekday: index + 1, enabled: true, shifts: [{ start: '10:00', end: '20:00', breaks: [] }] }));

function today() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function demoSchedule(date = today()): ScheduleResponse {
  return {
    date,
    scheduleVersion: demoSettings.version,
    weekly: JSON.parse(JSON.stringify(demoWeekly)) as WeeklySchedule[],
    technicians: demoTechnicians.map((technician) => ({
      ...technician,
      plan: {
        id: `${technician.id}_${date}`,
        technicianId: technician.id,
        date,
        weekday: ((new Date(`${date}T00:00:00`).getDay() + 6) % 7) + 1,
        leave: false,
        shifts: [{ start: '10:00', end: '20:00', breaks: [] }],
        source: 'weekly',
        version: 1,
        occupancyCount: 0,
        occupiedIntervals: []
      } as TechnicianDayPlan
    }))
  };
}

async function request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (demo) return demoRequest<T>(action, payload);
  return callBusiness<T>(action, payload);
}

async function demoRequest<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  if (action === 'adminSummary') {
    const days = Math.max(1, Number(payload.days) || 30);
    const end = new Date();
    const trend = Array.from({ length: days }, (_, index) => {
      const date = new Date(end);
      date.setDate(end.getDate() - (days - index - 1));
      return { date: date.toISOString().slice(0, 10), paidFen: 0, refundFen:0, netFen:0, completedCount: 0, customerCount: 0 };
    });
    return { date: trend[trend.length - 1].date, days, rangeStart: trend[0].date, metrics: { paidFen: 49800, refundFen: 0, netFen: 49800, completedFen: 19900, orderCount: 2, completedCount: 1, customerCount: 2, noShowCount: 0, newCustomerCount: 2, returningCustomerCount: 0, repeatRate: 0, averageOrderFen: 24900, cancelledCount:0, arrivedCount:1, refundCount:0, completionRate:50, noShowRate:0 }, trend, works: [], services: [], technicians: [], categories:[], timeSlots:[] } as T;
  }
  if (action === 'adminListOrders') {
    const keyword = String(payload.query || '').trim().toLowerCase();
    const rows = demoOrders.filter((item) => (!payload.status || item.status === payload.status)
      && (!keyword || [item.id, item.customerName, item.phone, item.phoneMasked, item.serviceName].some((value) => String(value || '').toLowerCase().includes(keyword))));
    return { orders:rows, canRefund:true, page:1, limit:30, total:rows.length, pages:1 } as T;
  }
  if (action === 'redeemCheckInCode') return { order:{...demoOrders[0],status:'ARRIVED',statusLabel:'已到店'},duplicate:false } as T;
  if (action === 'adminDeleteTechnician') {
    const id = String(payload.technicianId || '');
    if (demoOrders.some((item) => item.technicianId === id)) throw new Error('该技师已有预约订单，不能删除，请保留该技师或先处理订单');
    const index = demoTechnicians.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('技师不存在');
    demoTechnicians.splice(index, 1);
    return { id, deleted: true } as T;
  }
  if (action === 'staffSession') return {role:'OWNER',name:'店主'} as T;
  if (action === 'adminCatalog') return { categories: [{id:'nail',name:'美甲',enabled:true,icon:'✦',color:'#f1ded8',sort:0},{id:'brow',name:'美眉',enabled:true,icon:'⌁',color:'#eee6d9',sort:1}], services: demoServices, works: demoWorks, technicians: demoTechnicians } as T;
  if (action === 'adminSchedule') return demoSchedule(String(payload.date || today())) as T;
  if (action === 'adminPreviewTechnicianSchedule') {
    const current = demoSchedule(String(payload.date || today()));
    const technician = current.technicians.find((item) => item.id === payload.technicianId) || current.technicians[0];
    const plan = technician?.plan || demoSchedule(String(payload.date || today())).technicians[0]?.plan;
    if (!technician || !plan) throw new Error('演示技师不存在');
    return { technician: { ...technician, plan: undefined }, days: [plan], plan, orders: [] } as T;
  }
  if (action === 'adminSaveScheduleDay') {
    const current = demoSchedule(String(payload.date || today()));
    const technician = current.technicians.find((item) => item.id === payload.technicianId);
    if (!technician) throw new Error('演示技师不存在');
    technician.plan = { ...technician.plan, leave: payload.leave === true, shifts: (payload.shifts || []) as TechnicianDayPlan['shifts'], source: 'override', version: technician.plan.version + 1 };
    return technician.plan as T;
  }
  if (action === 'adminSaveWeeklySchedule') return { version: demoSettings.version + 1, weekly: payload.weekly as WeeklySchedule[] } as T;
  if (action === 'adminPaymentStatus') return { configured: false, missing: ['WX_MCH_ID', 'WX_MCH_SERIAL_NO', 'WX_API_V3_KEY', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL', 'WX_PLATFORM_PUBLIC_KEY_PEM_OR_WX_PLATFORM_CERT_PEM'], callbackCertificateConfigured: false, note: '仅返回状态，不返回密钥。' } as T;
  if (action === 'adminUploadImage') {
    const base64 = typeof payload.base64 === 'string' ? payload.base64 : '';
    return { fileID: `demo-file-${Date.now()}`, url: base64 ? `data:image/jpeg;base64,${base64}` : '' } as T;
  }
  if (action === 'getSettings') return demoSettings as T;
  if (action === 'adminSaveWork') {
    const work = payload as unknown as Work;
    const index = demoWorks.findIndex(item => item.id === work.id);
    if (index >= 0) demoWorks[index] = { ...work }; else demoWorks.push({ ...work });
    return work as T;
  }
  if (action === 'adminSaveFeaturedWorks') {
    const orderedIds = Array.isArray(payload.orderedIds) ? payload.orderedIds.map(String) : [];
    demoWorks = demoWorks.map((work) => ({ ...work, featured: orderedIds.includes(work.id), featuredSort: orderedIds.indexOf(work.id) + 1 }));
    return { orderedIds, updated: demoWorks.length } as T;
  }
  if (action === 'adminSaveService') {
    const next = payload as unknown as Service;
    const index = demoServices.findIndex((item) => item.id === next.id);
    if (index >= 0) demoServices[index] = { ...demoServices[index], ...next };
    else demoServices.push(next);
    return demoServices.find((item) => item.id === next.id) as T;
  }
  if (action === 'adminSaveSettings') {
    Object.assign(demoSettings, payload, { version: demoSettings.version + 1 });
    return demoSettings as T;
  }
  if (action === 'adminRefund') {
    const order = demoOrders.find((item) => item.id === payload.orderId);
    if (order) {
      order.status = 'CANCEL_PENDING_REFUND';
      order.statusLabel = '退款待处理';
      order.refundStatus = 'PROCESSING';
      order.pendingRefundFen = Number(payload.amountFen || 0);
      order.refundInProgress = true;
    }
    return { status: 'PROCESSING' } as T;
  }
  throw new Error(`演示模式不支持 ${action}`);
}

type RedeemCheckInResponse = AdminOrder | { order: AdminOrder; duplicate?: boolean };

function normalizeCheckInResult(result: RedeemCheckInResponse): { order: AdminOrder; duplicate: boolean } {
  if (!result || typeof result !== 'object') throw new Error('核销完成但未返回订单信息');
  if ('order' in result && result.order) return { order: result.order, duplicate: result.duplicate === true };
  return { order: result as AdminOrder, duplicate: false };
}

export const adminApi = {
  summary: (range: number | {dateFrom:string;dateTo:string} = 30) => request<AnalyticsResponse>('adminSummary',typeof range==='number'?{days:range}:range),
  orders: (query: AdminOrderQuery | string = {}) => request<AdminOrderPage>('adminListOrders', typeof query==='string'?{status:query}:query as Record<string,unknown>),
  redeemCheckInCode: async (code:string) => normalizeCheckInResult(await request<RedeemCheckInResponse>('redeemCheckInCode',{code})),
  session: () => request<SessionInfo>('staffSession'),
  uploadImage: (base64:string) => request<{fileID:string;url:string}>('adminUploadImage',{base64}),
  saveCategory: (category:Category) => request<Category>('adminSaveCategory',category as unknown as Record<string,unknown>),
  saveTechnician: (technician:Technician) => request<Technician>('adminSaveTechnician',technician as unknown as Record<string,unknown>),
  deleteTechnician: (technicianId:string) => request<{id:string;deleted:boolean}>('adminDeleteTechnician',{technicianId}),
  createTechnicianLogin: (technicianId:string,username:string,password:string) => request<{username:string}>('adminCreateTechnicianLogin',{technicianId,username,password}),
  previewTechnicianSchedule: (technicianId:string,date:string) => request<MySchedule>('adminPreviewTechnicianSchedule',{technicianId,date}),
  mySchedule: (date:string) => request<MySchedule>('mySchedule',{date}),
  saveMySchedule: (plan:TechnicianDayPlan) => request<TechnicianDayPlan>('saveMySchedule',plan as unknown as Record<string,unknown>),
  catalog: () => request<CatalogResponse>('adminCatalog'),
  schedule: (date: string) => request<ScheduleResponse>('adminSchedule', { date }),
  saveScheduleDay: (plan: Pick<TechnicianDayPlan, 'technicianId' | 'date' | 'leave' | 'shifts' | 'version'> & { reason?: string }) => request<TechnicianDayPlan>('adminSaveScheduleDay', plan as unknown as Record<string, unknown>),
  saveWeeklySchedule: (weekly: WeeklySchedule[], version: number, reason?: string) => request<{ version: number; weekly: WeeklySchedule[] }>('adminSaveWeeklySchedule', { weekly, version, reason }),
  paymentStatus: () => request<{ configured: boolean; missing: string[]; callbackCertificateConfigured: boolean; note: string }>('adminPaymentStatus'),
  settings: () => request<Settings>('getSettings'),
  saveWork: (work: Work) => request<Work>('adminSaveWork', work as unknown as Record<string, unknown>),
  saveService: (service: Service) => request<Service>('adminSaveService', service as unknown as Record<string, unknown>),
  saveSettings: (settings: Partial<Settings> & { reason?: string }) => request<Settings>('adminSaveSettings', settings as unknown as Record<string, unknown>),
  saveFeaturedWorks: (orderedIds:string[]) => request<{orderedIds:string[];updated:number}>('adminSaveFeaturedWorks',{orderedIds}),
  refund: (orderId: string, amountFen:number, reason: string) => request<{ status: string }>('adminRefund', { orderId, amountFen, reason })
};

export { money };
