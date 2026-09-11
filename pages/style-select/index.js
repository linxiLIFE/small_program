const api = require('../../utils/api');
const { formatMoney, formatDuration } = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: '',
    service: {},
    works: []
  },

  onLoad(options = {}) {
    this.categoryId = options.categoryId || '';
    this.serviceId = options.serviceId || '';
    return this.loadStyles();
  },

  async loadStyles() {
    if (!this.serviceId) {
      this.setData({ loading: false, error: '小项目不存在' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.listServices(this.categoryId);
      const service = (result.services || []).find((item) => item.id === this.serviceId);
      if (!service) throw new Error('小项目不存在或已下架');
      const works = (result.works || [])
        .filter((item) => item.serviceId === service.id && item.published !== false)
        .map((item) => ({ ...item, serviceName: '' }));
      this.setData({
        loading: false,
        service: {
          ...service,
          priceText: formatMoney(service.priceFen, false),
          durationText: formatDuration(service.durationMinutes)
        },
        works
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '加载失败' });
    }
  },

  handleWorkTap(event) {
    const workId = event.detail?.work?.id;
    if (workId) wx.navigateTo({ url: `/pages/work-detail/index?workId=${encodeURIComponent(workId)}` });
  }
});
