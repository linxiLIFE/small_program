const COLLECTIONS = {
  users: 'users',
  staff: 'staff_accounts',
  categories: 'categories',
  services: 'services',
  works: 'works',
  technicians: 'technicians',
  scheduleTemplates: 'schedule_templates',
  technicianDays: 'technician_days',
  orders: 'orders',
  payments: 'payments',
  refunds: 'refunds',
  pointsAccounts: 'points_accounts',
  pointsLedger: 'points_ledger',
  jobs: 'jobs',
  notifications: 'notification_records',
  auditLogs: 'audit_logs',
  dailyMetrics: 'daily_metrics',
  settings: 'settings_versions',
  idempotency: 'idempotency_keys'
};

const ORDER_STATUS = Object.freeze({
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  RESERVED: 'RESERVED',
  ARRIVED: 'ARRIVED',
  IN_SERVICE: 'IN_SERVICE',
  COMPLETED: 'COMPLETED',
  CANCEL_PENDING_REFUND: 'CANCEL_PENDING_REFUND',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
  CANCELLED_BY_USER: 'CANCELLED_BY_USER',
  CANCELLED_NO_SHOW: 'CANCELLED_NO_SHOW'
});

const PAYMENT_STATUS = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  PREPAY_SUBMITTING: 'PREPAY_SUBMITTING',
  PREPAY_CREATED: 'PREPAY_CREATED',
  SUCCESS: 'SUCCESS',
  CLOSED: 'CLOSED',
  UNKNOWN: 'UNKNOWN'
});

const REFUND_STATUS = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING_CONFIG: 'PENDING_CONFIG',
  INIT: 'INIT',
  SUBMITTING: 'SUBMITTING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  RETRY_REQUIRED: 'RETRY_REQUIRED',
  MANUAL_ACTION: 'MANUAL_ACTION',
  CLOSED: 'CLOSED',
  ABNORMAL: 'ABNORMAL'
});

const ACTIVE_ORDER_STATUSES = [
  ORDER_STATUS.PENDING_PAYMENT,
  ORDER_STATUS.RESERVED,
  ORDER_STATUS.ARRIVED,
  ORDER_STATUS.IN_SERVICE
];

const DEFAULT_SETTINGS = {
  version: 1,
  published: true,
  timezone: 'Asia/Shanghai',
  store: {
    storeName: '四个小姐姐的店',
    address: '哈尔滨市南岗区底下商店美甲店',
    phone: '',
    notice: '每次预约只安排一位顾客和一位技师，请提前 5 分钟到店。'
  },
  booking: {
    openDays: 14,
    minAdvanceMinutes: 60,
    slotStepMinutes: 15,
    unpaidHoldMinutes: 5,
    noShowGraceMinutes: 30
  },
  points: {
    pointRateFen: 100,
    unit: 20,
    discountFen: 100,
    maxPercent: 10
  },
  schedule: {
    weekly: [
      { weekday: 1, enabled: true, shifts: [{ start: '10:00', end: '20:00', breaks: [] }] },
      { weekday: 2, enabled: true, shifts: [{ start: '10:00', end: '20:00', breaks: [] }] },
      { weekday: 3, enabled: true, shifts: [{ start: '10:00', end: '20:00', breaks: [] }] },
      { weekday: 4, enabled: true, shifts: [{ start: '10:00', end: '20:00', breaks: [] }] },
      { weekday: 5, enabled: true, shifts: [{ start: '10:00', end: '20:00', breaks: [] }] },
      { weekday: 6, enabled: true, shifts: [{ start: '10:00', end: '20:00', breaks: [] }] },
      { weekday: 7, enabled: true, shifts: [{ start: '10:00', end: '20:00', breaks: [] }] }
    ]
  }
};

const ROLE_LABELS = { OWNER: '店主', STAFF: '店员', TECHNICIAN: '技师' };

module.exports = {
  COLLECTIONS,
  ORDER_STATUS,
  PAYMENT_STATUS,
  REFUND_STATUS,
  ACTIVE_ORDER_STATUSES,
  DEFAULT_SETTINGS,
  ROLE_LABELS
};
