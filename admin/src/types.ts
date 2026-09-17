export type PageKey = 'home' | 'team' | 'my-schedule' | 'dashboard' | 'orders' | 'services' | 'featured' | 'technicians' | 'settings';

export interface MetricSummary {
  paidFen: number;
  refundFen: number;
  netFen: number;
  completedFen: number;
  orderCount: number;
  completedCount: number;
  customerCount: number;
  noShowCount: number;
  newCustomerCount: number; returningCustomerCount:number; repeatRate:number; averageOrderFen:number;
  cancelledCount: number; arrivedCount: number; refundCount: number; completionRate: number; noShowRate: number;
}

export interface AdminOrder {
  id: string;
  status: string;
  statusLabel: string;
  serviceName: string;
  work?: { id: string; title: string; imageUrl: string } | null;
  technicianName: string;
  customerName?: string;
  phoneMasked?: string;
  phone?: string;
  startAtLabel: string;
  paidFen: number;
  refundStatus?: string;
  technicianId?: string;
  categoryName?: string;
  date?: string;
  startAt?: number;
  endAt?: number;
  createdAt?: number;
  paidAt?: number;
  totalFen?: number;
  refundAmountFen?: number;
  refundedFen?: number;
  pendingRefundFen?: number;
  lastRefundRequestedFen?: number;
  remainingRefundableFen?: number;
  refundInProgress?: boolean;
  partiallyRefunded?: boolean;
  addons?: Array<{ id:string; name:string; type:'REMOVAL'|'BUILDER'|'TIP'; priceFen:number; durationMinutes:number; quantity?:number; unitPriceFen?:number }>;
}

export interface Service {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string;
  priceFen: number;
  durationMinutes: number;
  coverUrl: string;
  styleCount?: number;
  enabled: boolean;
  sort: number;
  isAddon?: boolean;
  addonType?: ''|'REMOVAL'|'BUILDER'|'TIP';
  freeAsAddon?: boolean;
  bookableStandalone?: boolean;
}

export interface Technician {
  id: string;
  name: string;
  title: string;
  bio: string;
  avatarUrl?: string;
  avatarFileID?: string;
  categoryIds: string[];
  categoryNames?: string[];
  skills?: string[];
  bound?: boolean;
  loginName?: string;
  enabled: boolean;
  sort?: number;
}

export interface BreakWindow {
  start: string;
  end: string;
}

export interface Shift {
  start: string;
  end: string;
  breaks: BreakWindow[];
}

export interface WeeklySchedule {
  weekday: number;
  enabled: boolean;
  shifts: Shift[];
}

export interface TechnicianDayPlan {
  id: string;
  technicianId: string;
  date: string;
  weekday: number;
  leave: boolean;
  shifts: Shift[];
  source: 'weekly' | 'override';
  version: number;
  occupancyCount: number;
  occupiedIntervals: Array<{ startAt: number; endAt: number; status: string }>;
}

export interface ScheduledTechnician extends Technician {
  plan: TechnicianDayPlan;
}

export interface ScheduleResponse {
  date: string;
  scheduleVersion: number;
  weekly: WeeklySchedule[];
  technicians: ScheduledTechnician[];
}

export interface Settings {
  version: number;
  store: { storeName: string; address: string; phone: string; notice: string; latitude?:number|null; longitude?:number|null };
  home?: {banners:Array<{id:string;imageUrl:string;imageFileID?:string}>};
  booking: { openDays: number; minAdvanceMinutes: number; slotStepMinutes: number; unpaidHoldMinutes: number; refundCutoffMinutes: number; noShowGraceMinutes: number; noShowPenaltyFen: number; noShowPolicy: 'AUTO_PARTIAL_REFUND' };
  points: { pointRateFen: number; unit: number; discountFen: number; maxPercent: number; inviteRewardPoints: number };
  notifications: {
    enabled: boolean;
    arrivalLeadMinutes: number;
    templates: Record<'appointmentSuccess'|'arrivalReminder'|'checkInSuccess'|'noShowRefund', { templateId:string; page:string; serviceKey:string; timeKey?:string; technicianKey?:string; addressKey?:string; storeKey?:string; amountKey?:string; statusKey?:string }>;
  };
}

export interface Category { id:string; name:string; icon:string; color:string; coverUrl?:string; coverFileID?:string; enabled:boolean; sort:number; serviceCount?:number; styleCount?:number; }

export interface CatalogResponse {
  categories: Category[];
  services: Service[];
  works: Work[];
  technicians: Technician[];
}

export interface Work { id: string; title: string; imageUrl: string; serviceId: string; serviceName?: string; durationMinutes?: number; categoryId?: string; categoryName?: string; published: boolean; sort: number; featured?: boolean; featuredSort?: number; imageFileID?:string; bookingCount?:number; }

export interface MySchedule { technician:Technician; days:TechnicianDayPlan[]; plan:TechnicianDayPlan; orders:AdminOrder[]; }
export interface SessionInfo { role:'OWNER'|'STAFF'|'TECHNICIAN'|'UNASSIGNED'; name:string; technicianId?:string; }

export interface AnalyticsResponse {date:string;days:number;rangeStart:string;metrics:MetricSummary;trend:Array<{date:string;paidFen:number;refundFen:number;netFen:number;completedCount:number;customerCount:number}>;works:RankingItem[];services:RankingItem[];technicians:RankingItem[];categories:RankingItem[];timeSlots:Array<{weekday:number;hour:number;count:number}>;}
export interface RankingItem {id:string;name:string;count:number;paidFen:number;}

export interface AdminOrderQuery { status?:string; technicianId?:string; serviceId?:string; workId?:string; dateFrom?:string; dateTo?:string; query?:string; page?:number; limit?:number; sortBy?:'startAt'|'createdAt'|'paidFen'; sortDirection?:'asc'|'desc'; }
export interface AdminOrderPage { orders:AdminOrder[]; canRefund:boolean; page:number; limit:number; total:number; pages:number; }
