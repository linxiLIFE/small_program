const cloudConfig = require('./cloud-config');

App({
  globalData: {
    user: null,
    isDemo: false,
    catalogSelection: {
      categoryId: '',
      serviceId: '',
      workId: ''
    }
  },

  onLaunch() {
    if (!wx.cloud) {
      this.globalData.isDemo = true;
      console.warn('当前基础库不支持微信云开发，页面将使用演示数据');
      return;
    }

    if (!cloudConfig.env) {
      this.globalData.isDemo = true;
      console.warn('尚未配置 CloudBase 环境 ID，页面将使用演示数据');
      return;
    }

    wx.cloud.init({
      env: cloudConfig.env,
      traceUser: true
    });
  },

  setUser(user) {
    this.globalData.user = user;
  }
});
