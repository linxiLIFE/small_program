const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const fs = require('fs');
const path = require('path');
const sharedRoot = fs.existsSync(path.join(__dirname, 'lib')) ? './lib' : '../api/lib';
const { handleNotify } = require(`${sharedRoot}/payment-service`);

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.main = async (event = {}) => {
  try {
    const result = await handleNotify(event);
    return response(200, { code: 'SUCCESS', message: '成功', data: result });
  } catch (error) {
    console.error('微信支付回调处理失败', error.code || error.message || error);
    const status = error.code === 'PAYMENT_NOTIFY_SIGNATURE_INVALID' ? 401 : 500;
    return response(status, { code: 'FAIL', message: '回调处理失败' });
  }
};
