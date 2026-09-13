const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const http = require('http');
const fs = require('fs');
const path = require('path');
const sharedRoot = fs.existsSync(path.join(__dirname, 'lib')) ? './lib' : '../api/lib';
const { handleNotify } = require(`${sharedRoot}/payment-service`);

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function main(event = {}) {
  try {
    const result = await handleNotify(event);
    return response(200, { code: 'SUCCESS', message: '成功', data: result });
  } catch (error) {
    console.error('微信支付回调处理失败', error.code || error.message || error);
    const status = error.code === 'PAYMENT_NOTIFY_SIGNATURE_INVALID' ? 401 : 500;
    return response(status, { code: 'FAIL', message: '回调处理失败' });
  }
}

exports.main = main;

if (require.main === module) {
  const port = Number(process.env.PORT || 9000);
  const server = http.createServer((request, res) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', async () => {
      const result = await main({
        httpMethod: request.method,
        path: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        isBase64Encoded: false
      });
      res.statusCode = result.statusCode || 200;
      for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
      res.end(result.body || '');
    });
    request.on('error', (error) => {
      console.error('支付回调 HTTP 请求读取失败', error.message);
      res.statusCode = 400;
      res.end(JSON.stringify({ code: 'FAIL', message: '请求读取失败' }));
    });
  });
  server.listen(port, '0.0.0.0', () => console.log(`payment-callback listening on ${port}`));
}
