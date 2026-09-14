export type PageKey = 'home' | 'team' | 'my-schedule' | 'dashboard' | 'orders' | 'services' | 'technicians' | 'settings' | 'payment';

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
  startAtLabel: string;
  paidFen: number;
  refundStatus?: string;
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
  booking: { openDays: number; minAdvanceMinutes: number; slotStepMinutes: number; unpaidHoldMinutes: number; noShowGraceMinutes: number; noShowPolicy: 'MANUAL_REVIEW' };
  points: { pointRateFen: number; unit: number; discountFen: number; maxPercent: number };
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

export interface AnalyticsResponse {date:string;days:number;rangeStart:string;metrics:MetricSummary;trend:Array<{date:string;paidFen:number;completedCount:number;customerCount:number}>;works:RankingItem[];services:RankingItem[];technicians:RankingItem[];}
export interface RankingItem {id:string;name:string;count:number;paidFen:number;}
