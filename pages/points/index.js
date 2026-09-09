const api = require('../../utils/api');
const { formatDateTime } = require('../../utils/format');

Page({
  data: { loading: true, account: {}, ledger: [] },

  onLoad() {
    this.loadPoints();
  },

  async loadPoints() {
    try {
      const result = await api.listPoints();
      const ledger = (result.ledger || []).map((item) => ({
        ...item,
        amountLabel: `${item.amount > 0 ? '+' : ''}${item.amount}`,
        timeLabel: formatDateTime(item.createdAt),
        positive: item.amount > 0
      }));
      this.setData({ loading: false, account: result.account || {}, ledger });
    } catch (error) {
      this.setData({ loading: false, account: {}, ledger: [] });
      wx.showToast({ title: error.message || '积分加载失败', icon: 'none' });
    }
  }
});
