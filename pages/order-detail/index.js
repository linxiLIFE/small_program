const api = require('../../utils/api');
const { ORDER_STATUS_LABELS } = require('../../utils/constants');
const { formatMoney, formatDateTime, formatDuration } = require('../../utils/format');

Page({
  data: { loading: true, order: {}, actions: [], canCancel: false },

  onLoad(options) {
    this.orderId = options.orderId || '';
    this.loadOrder();
  },

  onShow() {
    if (this.hasLoaded) this.loadOrder();
  },

  async loadOrder() {
    const order = await api.getOrder(this.orderId);
    if (!order) {
      this.setData({ loading: false, order: {} });
      return;
    }
    const canCancel = ['PENDING_PAYMENT', 'RESERVED'].includes(order.status);
    this.hasLoaded = true;
    this.setData({
      loading: false,
      order: {
        ...order,
        statusLabel: order.statusLabel || ORDER_STATUS_LABELS[order.status] || '处理中',
        timeLabel: order.startAtLabel || formatDateTime(order.startAt),
        totalText: formatMoney(order.totalFen),
        discountText: formatMoney(order.discountFen || 0),
        paidText: formatMoney(order.paidFen),
        refundStatusLabel: order.refundStatus === 'SUCCESS' ? '已到账' : order.refundStatus === 'PROCESSING' ? '退款处理中' : order.refundStatus === 'CLOSED' ? '退款已关闭' : '退款异常',
        durationText: formatDuration(order.durationMinutes)
      },
      canCancel,
      actions: this.getActions(order.status)
    });
  },

  getActions(status) {
    if (status === 'PENDING_PAYMENT') return [{ id: 'pay', text: '继续支付', type: 'primary' }, { id: 'cancel', text: '取消订单', type: 'ghost' }];
    if (status === 'RESERVED') return [{ id: 'cancel', text: '取消并退款', type: 'danger' }];
    return [];
  },

  async handleAction(event) {
    const action = event.currentTarget.dataset.action;
    if (action === 'pay') return this.payOrder();
    if (action === 'cancel') return this.confirmCancel();
  },

  async payOrder() {
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
        success: async () => { await api.queryPayment(this.data.order.id); this.loadOrder(); },
        fail: () => wx.showToast({ title: '支付未完成', icon: 'none' })
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

  copyOrderId() {
    wx.setClipboardData({ data: this.data.order.id || '' });
  },

  showRefundStatus() {
    wx.showModal({ title: '退款进度', content: '退款申请、处理中和到账是不同状态。请以订单中的退款状态及微信账单为准。', showCancel: false });
  }
});
