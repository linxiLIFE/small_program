const crypto = require('crypto');
const https = require('https');
const { COLLECTIONS } = require('./constants');
const { db, getContext, getOptional, withRequestContext } = require('./db');
const { requireOpenId, getStaffAccountForContext, requireRole } = require('./auth');
const { assert, AppError } = require('./errors');
const { enforceActionRateLimit } = require('./rate-limit');

const SESSION_MS = 30 * 86400000;
// Keep the native management identity out of customer and payment entry points.
const ACTIONS = new Set([
  'staffSession', 'adminSummary', 'adminListOrders', 'adminCatalog', 'getSettings',
  'adminSchedule', 'adminSaveScheduleDay', 'adminSaveWeeklySchedule',
  'adminSaveCategory', 'adminSaveService', 'adminSaveWork', 'adminReorderCatalog',
  'adminDeleteCategory', 'adminDeleteService', 'adminDeleteWork', 'adminSaveFeaturedWorks',
  'adminSaveTechnician', 'adminDeleteTechnician', 'adminCreateTechnicianLogin',
  'adminPreviewTechnicianSchedule', 'mySchedule', 'saveMySchedule', 'adminSaveSettings',
  'adminUploadImage', 'adminRefund', 'redeemCheckInCode', 'staffTransition', 'staffListOrders'
]);

function sessionId(token) {
  assert(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'UNAUTHENTICATED', '请登录管理账号', 401);
  return `native_admin_${crypto.createHash('sha256').update(token).digest('hex')}`;
}

// Authenticate with the same provider as the web admin. No shared SDK login state
// is used in a warm cloud-function instance, and no provider tokens are persisted.
function verifyPassword(username, password, context) {
  const env = String(process.env.TCB_ENV || process.env.SCF_NAMESPACE || '').trim();
  assert(/^[a-zA-Z0-9-]+$/.test(env), 'ACCOUNT_PROVIDER_CONFIG', '管理账号服务未配置', 503);
  const body = JSON.stringify({ username, password });
  const device = crypto.createHash('sha256').update(`${context.appid}:${context.openid}`).digest('hex').slice(0, 40);
  return new Promise((resolve, reject) => {
    const req = https.request(`https://${env}.api.tcloudbasegateway.com/auth/v1/signin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-device-id': device }, timeout: 12000
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; if (raw.length > 65536) req.destroy(); });
      response.on('error', () => reject(new AppError('ACCOUNT_PROVIDER_UNAVAILABLE', '账号服务暂不可用，请稍后重试', 503)));
      response.on('end', () => {
        let result;
        try { result = JSON.parse(raw); } catch (_) { return reject(new AppError('ACCOUNT_PROVIDER_UNAVAILABLE', '账号服务暂不可用，请稍后重试', 503)); }
        if (response.statusCode >= 200 && response.statusCode < 300 && typeof result.sub === 'string' && result.access_token) return resolve(result.sub);
        const code = String(result.error || '');
        if (code === 'captcha_required' || code === 'invalid_status') return reject(new AppError('RATE_LIMITED', '登录尝试过多，请稍后重试', 429));
        if (response.statusCode >= 500 || code === 'unimplemented') return reject(new AppError('ACCOUNT_PROVIDER_UNAVAILABLE', '账号登录服务暂不可用，请稍后重试', 503));
        reject(new AppError('INVALID_CREDENTIALS', '账号或密码错误', 401));
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => reject(new AppError('ACCOUNT_PROVIDER_UNAVAILABLE', '账号服务连接失败，请稍后重试', 503)));
    req.end(body);
  });
}

async function login(payload) {
  const context = requireOpenId();
  await enforceActionRateLimit('nativeAdminLogin');
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  assert(username.length >= 2 && username.length <= 64 && password.length > 0 && password.length <= 128, 'INVALID_CREDENTIALS', '请输入正确的账号和密码', 401);
  const uid = await verifyPassword(username, password, context);
  // Do not fall back to the WeChat account when the supplied login is unassigned.
  const account = await getStaffAccountForContext({ uid });
  assert(account && ['OWNER', 'STAFF', 'TECHNICIAN'].includes(account.role), 'FORBIDDEN', '此账号没有后台管理权限', 403);
  const session = await withRequestContext({ ...context, uid }, () => requireRole(['OWNER', 'STAFF', 'TECHNICIAN']));
  const token = crypto.randomBytes(32).toString('hex');
  const id = sessionId(token);
  const expiresAt = Date.now() + SESSION_MS;
  await db.collection(COLLECTIONS.idempotency).doc(id).set({ data: {
    id, type: 'NATIVE_ADMIN_SESSION', uid, accountId: account.id || account._id,
    openid: context.openid, appid: context.appid, expiresAt, createdAt: Date.now(), revoked: false
  } });
  return { token, expiresAt, session: publicSession(session.account) };
}

function publicSession(account) {
  return { role: account.role, name: account.name || '', technicianId: account.technicianId || '' };
}

async function dispatch(payload = {}, route) {
  const context = requireOpenId();
  if (payload.action === 'login') return login(payload);
  const id = sessionId(payload.token);
  const record = await getOptional(COLLECTIONS.idempotency, id);
  assert(record && record.type === 'NATIVE_ADMIN_SESSION' && !record.revoked && record.expiresAt > Date.now() && record.openid === context.openid && record.appid === context.appid, 'UNAUTHENTICATED', '登录已过期，请重新登录', 401);
  if (payload.action === 'logout') {
    await db.collection(COLLECTIONS.idempotency).doc(id).update({ data: { revoked: true, expiresAt: Date.now() } });
    return { loggedOut: true };
  }
  assert(ACTIONS.has(payload.action), 'FORBIDDEN', '不支持的管理操作', 403);
  const account = await getStaffAccountForContext({ uid: record.uid });
  assert(account && (account.id || account._id) === record.accountId, 'FORBIDDEN', '管理账号已停用，请重新登录', 403);
  return withRequestContext({ ...context, uid: record.uid }, async () => {
    await requireRole(['OWNER', 'STAFF', 'TECHNICIAN']);
    return route(payload.action, payload.payload || {});
  });
}

module.exports = { dispatch, login, verifyPassword, ACTIONS, sessionId };
