const ORDER_STATUS = {
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
};

const ORDER_STATUS_LABELS = {
  PENDING_PAYMENT: '待付款',
  RESERVED: '待到店',
  ARRIVED: '已到店',
  IN_SERVICE: '服务中',
  COMPLETED: '已完成',
  CANCEL_PENDING_REFUND: '退款待处理',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
  CANCELLED_BY_USER: '已取消',
  CANCELLED_NO_SHOW: '未到店已取消'
};

const ROLE_LABELS = {
  OWNER: '店主',
  STAFF: '店员',
  TECHNICIAN: '技师'
};

module.exports = {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  ROLE_LABELS,
  TAB_PATHS: {
    home: '/pages/index/index',
    services: '/pages/services/index',
    booking: '/pages/booking/index',
    profile: '/pages/profile/index'
  }
};
