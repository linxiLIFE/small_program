export type PageKey = 'dashboard' | 'orders' | 'services' | 'technicians' | 'settings' | 'payment';

export interface MetricSummary {
  paidFen: number;
  refundFen: number;
  netFen: number;
  completedFen: number;
  orderCount: number;
  completedCount: number;
  customerCount: number;
  noShowCount: number;
}

export interface AdminOrder {
  id: string;
  status: string;
  statusLabel: string;
  serviceName: string;
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
  bufferMinutes: number;
  coverUrl: string;
  enabled: boolean;
  sort: number;
}

export interface Technician {
  id: string;
  name: string;
  title: string;
  bio: string;
  skills: string[];
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
  weekly: WeeklySchedule[];
  technicians: ScheduledTechnician[];
}

export interface Settings {
  version: number;
  store: { storeName: string; address: string; phone: string; notice: string };
  booking: { openDays: number; minAdvanceMinutes: number; slotStepMinutes: number; unpaidHoldMinutes: number; noShowGraceMinutes: number };
  points: { pointRateFen: number; unit: number; discountFen: number; maxPercent: number };
}

export interface CatalogResponse {
  services: Service[];
  works: unknown[];
  technicians: Technician[];
}
