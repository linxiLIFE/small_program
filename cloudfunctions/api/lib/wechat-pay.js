const crypto = require('crypto');
const https = require('https');
const { AppError, assert } = require('./errors');

const HOSTNAME = 'api.mch.weixin.qq.com';

function normalizePem(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

function normalizeSerial(value) {
  return String(value || '').replace(/:/g, '').trim().toUpperCase();
}

function parseVerifierList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => ({
      serialNo: normalizeSerial(item.serialNo || item.id),
      key: normalizePem(item.publicKeyPem || item.certificatePem || item.key)
    })).filter((item) => item.serialNo && item.key) : [];
  } catch (error) {
    return [];
  }
}

function config() {
  return {
    mchid: process.env.WX_MCH_ID || '',
    serialNo: normalizeSerial(process.env.WX_MCH_SERIAL_NO),
    apiV3Key: process.env.WX_API_V3_KEY || '',
    privateKey: normalizePem(process.env.WX_PRIVATE_KEY),
    notifyUrl: process.env.WX_NOTIFY_URL || '',
    appid: process.env.WX_APPID || '',
    platformCertificate: normalizePem(process.env.WX_PLATFORM_CERT_PEM),
    platformPublicKey: normalizePem(process.env.WX_PLATFORM_PUBLIC_KEY_PEM),
    platformSerialNo: normalizeSerial(process.env.WX_PLATFORM_SERIAL_NO || process.env.WX_PLATFORM_PUBLIC_KEY_ID),
    platformVerifiers: parseVerifierList(process.env.WX_PLATFORM_VERIFIERS_JSON)
  };
}

function getMissingConfig() {
  const current = config();
  const missing = Object.entries({
    WX_MCH_ID: current.mchid,
    WX_MCH_SERIAL_NO: current.serialNo,
    WX_API_V3_KEY: current.apiV3Key,
    WX_PRIVATE_KEY: current.privateKey,
    WX_NOTIFY_URL: current.notifyUrl,
    WX_APPID: current.appid
  }).filter(([, value]) => !value).map(([key]) => key);
  if (!current.platformCertificate && !current.platformPublicKey && !current.platformVerifiers.length) missing.push('WX_PLATFORM_PUBLIC_KEY_PEM_OR_WX_PLATFORM_CERT_PEM');
  if (current.platformPublicKey && !current.platformSerialNo) missing.push('WX_PLATFORM_SERIAL_NO');
  return missing;
}

function getConfigIssues() {
  const current = config();
  const issues = getMissingConfig();
  if (current.apiV3Key && Buffer.byteLength(current.apiV3Key, 'utf8') !== 32) issues.push('WX_API_V3_KEY_MUST_BE_32_BYTES');
  if (current.notifyUrl && !/^https:\/\//i.test(current.notifyUrl)) issues.push('WX_NOTIFY_URL_MUST_BE_HTTPS');
  if (current.privateKey) {
    try { crypto.createPrivateKey(current.privateKey); } catch (error) { issues.push('WX_PRIVATE_KEY_INVALID'); }
  }
  for (const verifier of getNotificationVerifiers(current)) {
    try { crypto.createPublicKey(verifier.key); } catch (error) { issues.push(`WX_PLATFORM_VERIFIER_INVALID:${verifier.serialNo || 'UNKNOWN'}`); }
  }
  if (process.env.WX_PLATFORM_VERIFIERS_JSON && !current.platformVerifiers.length) issues.push('WX_PLATFORM_VERIFIERS_JSON_INVALID');
  return [...new Set(issues)];
}

function isConfigured() {
  return getConfigIssues().length === 0;
}

function getNotificationVerifiers(current = config()) {
  const verifiers = [...(current.platformVerifiers || [])];
  if (current.platformPublicKey && current.platformSerialNo) {
    verifiers.push({ key: current.platformPublicKey, serialNo: current.platformSerialNo, mode: 'public-key' });
  }
  if (current.platformCertificate) {
    let serialNo = '';
    try {
      serialNo = normalizeSerial(new crypto.X509Certificate(current.platformCertificate).serialNumber);
    } catch (error) {
      console.warn('微信支付平台证书无法读取序列号', { message: error.message });
    }
    verifiers.push({ key: current.platformCertificate, serialNo, mode: 'platform-certificate' });
  }
  return verifiers;
}

function getNotificationVerifier(current = config(), serialNo = '') {
  const normalized = normalizeSerial(serialNo);
  const verifiers = getNotificationVerifiers(current);
  return normalized ? verifiers.find((item) => item.serialNo === normalized) || null : verifiers[0] || null;
}

function hasNotificationVerifier() {
  return getNotificationVerifiers().length > 0;
}

function getHeader(headers, name) {
  const target = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === target) return Array.isArray(value) ? value[0] : value;
  }
  return '';
}

function verifySignedMessage({ timestamp, nonce, signature, body, serialNo, verifier = getNotificationVerifier(config(), serialNo) }) {
  if (!verifier || !timestamp || !nonce || !signature) return false;
  if (verifier.serialNo && normalizeSerial(serialNo) !== verifier.serialNo) return false;
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  return crypto.createVerify('RSA-SHA256').update(message).verify(verifier.key, signature, 'base64');
}

function requireConfigured() {
  const missing = getConfigIssues();
  if (missing.length) throw new AppError('PAYMENT_NOT_CONFIGURED', '微信支付资质尚未配置或配置无效，请检查服务端商户参数', 503, { missing });
  return config();
}

function signMessage(message, privateKey) {
  return crypto.createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
}

function authorization(method, path, body, current) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = signMessage(message, current.privateKey);
  return {
    timestamp,
    nonce,
    value: `WECHATPAY2-SHA256-RSA2048 mchid="${current.mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${current.serialNo}",signature="${signature}"`
  };
}

function request(method, path, payload) {
  const current = requireConfigured();
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const auth = authorization(method, path, body, current);
  return new Promise((resolve, reject) => {
    const requestOptions = {
      hostname: HOSTNAME,
      path,
      method,
      headers: {
        Authorization: auth.value,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'shiguang-beauty-mini-program/1.0'
      },
      timeout: 10000
    };
    if (current.platformSerialNo) requestOptions.headers['Wechatpay-Serial'] = current.platformSerialNo;
    const req = https.request(requestOptions, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        const responseSerial = getHeader(response.headers, 'Wechatpay-Serial');
        const verifier = getNotificationVerifier(current, responseSerial);
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (!verifier) return reject(new AppError('PAYMENT_RESPONSE_SERIAL_UNKNOWN', '微信支付应答签名序列号未配置', 502));
          const valid = verifySignedMessage({
            timestamp: getHeader(response.headers, 'Wechatpay-Timestamp'),
            nonce: getHeader(response.headers, 'Wechatpay-Nonce'),
            signature: getHeader(response.headers, 'Wechatpay-Signature'),
            serialNo: responseSerial,
            body: raw,
            verifier
          });
          if (!valid) return reject(new AppError('PAYMENT_RESPONSE_SIGNATURE_INVALID', '微信支付应答验签失败', 502));
        }
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (error) { return reject(new AppError('PAYMENT_BAD_RESPONSE', '微信支付返回内容无法解析', 502)); }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          console.error('微信支付接口异常', { statusCode: response.statusCode, code: data.code, message: data.message });
          return reject(new AppError('PAYMENT_PROVIDER_ERROR', '微信支付服务暂时不可用', 502, { providerCode: data.code || '', providerMessage: data.message || '', statusCode: response.statusCode }));
        }
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new AppError('PAYMENT_TIMEOUT', '微信支付请求超时')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function buildJsapiPayParams(prepayId, current = requireConfigured()) {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const packageValue = `prepay_id=${prepayId}`;
  const message = `${current.appid}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
  const paySign = signMessage(message, current.privateKey);
  return { timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign };
}

async function createJsapiPrepay({ description, outTradeNo, amountFen, openid, timeExpire }) {
  const current = requireConfigured();
  assert(openid, 'OPENID_REQUIRED', '缺少微信用户身份');
  assert(Number.isFinite(Number(timeExpire)) && Number(timeExpire) > Date.now(), 'PAYMENT_DEADLINE_INVALID', '支付截止时间无效');
  const result = await request('POST', '/v3/pay/transactions/jsapi', {
    appid: current.appid,
    mchid: current.mchid,
    description,
    out_trade_no: outTradeNo,
    time_expire: new Date(Number(timeExpire)).toISOString(),
    notify_url: current.notifyUrl,
    amount: { total: Number(amountFen), currency: 'CNY' },
    payer: { openid }
  });
  assert(result.prepay_id, 'PAYMENT_BAD_RESPONSE', '微信支付未返回预支付标识', 502);
  return buildJsapiPayParams(result.prepay_id, current);
}

function queryOrder(outTradeNo) {
  const current = requireConfigured();
  return request('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(current.mchid)}`);
}

function closeOrder(outTradeNo) {
  const current = requireConfigured();
  return request('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`, { mchid: current.mchid });
}

function createRefund({ outTradeNo, outRefundNo, amountFen, totalFen, reason }) {
  return request('POST', '/v3/refund/domestic/refunds', {
    transaction_id: undefined,
    out_trade_no: outTradeNo,
    out_refund_no: outRefundNo,
    reason: reason || '预约取消退款',
    amount: { refund: Number(amountFen), total: Number(totalFen), currency: 'CNY' },
    notify_url: config().notifyUrl
  });
}

function queryRefund(outRefundNo) {
  return request('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`);
}

function verifyNotifySignature({ timestamp, nonce, signature, serialNo, body }) {
  const current = config();
  const verifier = getNotificationVerifier(current, serialNo);
  assert(verifier, 'PAYMENT_CERT_NOT_CONFIGURED', '微信支付公钥或平台证书尚未配置', 503);
  return verifySignedMessage({ timestamp, nonce, signature, serialNo, body, verifier });
}

function decryptNotification(resource) {
  const current = config();
  assert(current.apiV3Key && current.apiV3Key.length === 32, 'PAYMENT_KEY_INVALID', '微信支付 API v3 密钥必须为 32 字节', 503);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(current.apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
  decipher.setAuthTag(Buffer.from(resource.tag, 'base64'));
  decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(resource.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

module.exports = {
  config,
  getMissingConfig,
  getConfigIssues,
  isConfigured,
  requireConfigured,
  hasNotificationVerifier,
  getNotificationVerifier,
  getNotificationVerifiers,
  request,
  createJsapiPrepay,
  queryOrder,
  closeOrder,
  createRefund,
  queryRefund,
  verifyNotifySignature,
  decryptNotification,
  buildJsapiPayParams
};
