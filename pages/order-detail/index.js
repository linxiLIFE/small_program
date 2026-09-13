const api = require('../../utils/api');
const { ORDER_STATUS_LABELS } = require('../../utils/constants');
const { formatMoney, formatDateTimeRange, formatCountdown, formatDuration } = require('../../utils/format');

function getPaymentDeadline(order) {
  if (!order || order.status !== 'PENDING_PAYMENT') return 0;
  const deadline = Number(order.deadline || order.paymentDeadline || 0);
  if (Number.isFinite(deadline) && deadline > 0) return deadline;
  return 0;
}

Page({
  data: { loading: true, order: {}, actions: [], canCancel: false },

  onLoad(options) {
    this.orderId = options.orderId || '';
    this.loadOrder();
  },

  onShow() {
    if (this.hasLoaded) this.loadOrder();
  },

  onHide() {
    this.stopCountdown();
  },

  onUnload() {
    this.destroyed = true;
    this.stopCountdown();
  },

  async loadOrder() {
    const order = await api.getOrder(this.orderId);
    if (!order) {
      this.setData({ loading: false, order: {} });
      return;
    }
    const refundStatus = order.refundStatus || '';
    const visibleRefundStatuses = ['INIT', 'PENDING_CONFIG', 'SUBMITTING', 'PROCESSING', 'SUCCESS', 'RETRY_REQUIRED', 'MANUAL_ACTION', 'CLOSED', 'ABNORMAL'];
    const displayTitle = order.work && order.work.title ? order.work.title : order.serviceName || '预约服务';
    const canCancel = ['PENDING_PAYMENT', 'RESERVED'].includes(order.status);
    const paymentDeadline = getPaymentDeadline(order);
    const remaining = paymentDeadline ? paymentDeadline - Date.now() : 0;
    this.hasLoaded = true;
    this.setData({
      loading: false,
      order: {
        ...order,
        displayTitle,
        showServiceSubtitle: !!order.serviceName && displayTitle !== order.serviceName,
        statusLabel: order.statusLabel || ORDER_STATUS_LABELS[order.status] || '处理中',
        timeLabel: order.startAt ? formatDateTimeRange(order.startAt, order.endAt, order.durationMinutes) : order.startAtLabel || '待确定',
        totalText: formatMoney(order.totalFen),
        discountText: formatMoney(order.discountFen || 0),
        paidText: formatMoney(order.paidFen),
        paidLabel: order.status === 'PENDING_PAYMENT' ? '待支付金额' : order.refundStatus === 'SUCCESS' ? '退款金额' : '实付金额',
        refundStatus: visibleRefundStatuses.includes(refundStatus) ? refundStatus : '',
        refundStatusLabel: {
          INIT: '退款待提交',
          PENDING_CONFIG: '退款待配置',
          SUBMITTING: '退款提交中',
          PROCESSING: '退款处理中',
          SUCCESS: '已到账',
          RETRY_REQUIRED: '退款需重新发起',
          MANUAL_ACTION: '退款需人工处理',
          CLOSED: '退款已关闭',
          ABNORMAL: '退款异常'
        }[refundStatus] || '',
        durationText: formatDuration(order.durationMinutes),
        paymentDeadline,
        countdownText: paymentDeadline ? formatCountdown(remaining) : '',
        countdownUrgent: paymentDeadline && remaining <= 60 * 1000
      },
      canCancel,
      actions: this.getActions(order.status)
    });
    this.startCountdown();
  },

  getActions(status) {
    if (status === 'PENDING_PAYMENT') return [{ id: 'pay', text: '继续支付', type: 'primary' }, { id: 'cancel', text: '取消订单', type: 'ghost' }];
    if (status === 'RESERVED') return [{ id: 'cancel', text: '取消并退款', type: 'danger' }];
    if (['CANCELLED', 'CANCELLED_BY_USER', 'CANCELLED_NO_SHOW', 'REFUNDED'].includes(status)) return [{ id: 'delete', text: '删除订单', type: 'danger' }];
    return [];
  },

  async handleAction(event) {
    const action = event.currentTarget.dataset.action;
    if (action === 'pay') return this.payOrder();
    if (action === 'cancel') return this.confirmCancel();
    if (action === 'delete') return this.confirmDelete();
  },

  async payOrder() {
    if (this.data.order.paymentDeadline && Number(this.data.order.paymentDeadline) <= Date.now()) {
      await this.reconcileExpiredOrder();
      wx.showToast({ title: '支付时间已结束，订单已自动取消', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '准备支付' });
    try {
      const payment = await api.preparePayment(this.data.order.id);
      wx.hideLoading();
      if (!payment || !payment.configured || !payment.timeStamp) {
        wx.showModal({ title: '微信支付待配置', content: (payment && payment.message) || '请先在服务端完成商户资质配置。', showCancel: false });
        return;
      }
      wx.requestPayment({
        timeStamp: String(payment.timeStamp), nonceStr: payment.nonceStr, package: payment.package,
        signType: payment.signType || 'RSA', paySign: payment.paySign,
        success: async () => {
          try { await api.queryPayment(this.data.order.id); } catch (error) { wx.showToast({ title: '支付结果确认中', icon: 'none' }); }
          this.loadOrder();
        },
        fail: async () => {
          try { await api.queryPayment(this.data.order.id); } catch (error) { /* 后台任务会继续查单。 */ }
          wx.showToast({ title: '请查看订单支付状态', icon: 'none' });
          this.loadOrder();
        }
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || '支付准备失败', icon: 'none' });
    }
  },

  confirmCancel() {
    const paid = Number(this.data.order.paidFen || 0) > 0 && this.data.order.status !== 'PENDING_PAYMENT';
    wx.showModal({
      title: paid ? '确认取消并退款？' : '确认取消订单？',
      content: paid ? '到店核销前可全额退款，退款结果以微信回调为准。' : '取消后，当前预约占位会释放。',
      confirmText: '确认取消',
      success: async (result) => {
        if (!result.confirm) return;
        wx.showLoading({ title: '处理中' });
        try {
          await api.cancelOrder(this.data.order.id);
          wx.showToast({ title: paid ? '已提交退款' : '订单已取消', icon: 'success' });
          this.loadOrder();
        } catch (error) {
          wx.showModal({ title: '取消失败', content: error.message || '请稍后重试', showCancel: false });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  confirmDelete() {
    wx.showModal({
      title: '删除这条订单？',
      content: '删除后只会从订单记录中移除，不影响退款记录和服务凭证。',
      confirmText: '删除',
      confirmColor: '#c2675f',
      success: async (result) => {
        if (!result.confirm) return;
        wx.showLoading({ title: '删除中' });
        try {
          await api.deleteOrder(this.data.order.id);
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack({ delta: 1 }), 450);
        } catch (error) {
          wx.hideLoading();
          wx.showModal({ title: '删除失败', content: error.message || '请稍后重试', showCancel: false });
        }
      }
    });
  },

  showRefundStatus() {
    wx.showModal({ title: '退款进度', content: '退款申请、处理中和到账是不同状态。请以订单中的退款状态及微信账单为准。', showCancel: false });
  },

  startCountdown() {
    this.stopCountdown();
    if (this.destroyed || this.data.order.status !== 'PENDING_PAYMENT' || !this.data.order.paymentDeadline) return;
    this.refreshCountdown();
    this.countdownTimer = setInterval(() => this.refreshCountdown(), 1000);
  },

  stopCountdown() {
    if (!this.countdownTimer) return;
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  },

  refreshCountdown() {
    if (this.destroyed || this.data.order.status !== 'PENDING_PAYMENT' || !this.data.order.paymentDeadline) return;
    const remaining = Number(this.data.order.paymentDeadline) - Date.now();
    this.setData({
      'order.countdownText': formatCountdown(remaining),
      'order.countdownUrgent': remaining <= 60 * 1000
    });
    if (remaining <= 0) this.reconcileExpiredOrder();
  },

  async reconcileExpiredOrder() {
    if (this.reconcilingExpired || Date.now() < (this.nextExpireCheckAt || 0)) return;
    this.reconcilingExpired = true;
    try {
      await api.queryPayment(this.data.order.id);
      if (this.destroyed) return;
      api.clearCache('getOrder');
      await this.loadOrder();
    } catch (error) {
      console.warn('订单超时状态刷新失败', { orderId: this.data.order.id, message: error.message });
    } finally {
      this.nextExpireCheckAt = Date.now() + 5000;
      this.reconcilingExpired = false;
    }
  }
});
