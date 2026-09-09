const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();

  return {
    message: 'Hello from CloudBase 云函数',
    received: event.message || 'Hello World',
    appid: wxContext.APPID || '',
    openid: wxContext.OPENID || '',
    time: new Date().toISOString()
  };
};
