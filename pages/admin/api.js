const STORAGE_KEY = 'native-admin-session-v1';
let session;
const pendingReads = new Map();
const READ_ACTIONS = new Set(['bootstrap', 'staffSession', 'adminSummary', 'adminListOrders', 'adminOrderFilters', 'mySchedule', 'adminCatalog', 'getSettings', 'adminSchedule']);
function getSavedSession() {
  if (session === undefined) { try { session = wx.getStorageSync(STORAGE_KEY) || null; } catch (_) { session = null; } }
  if (session && Number(session.expiresAt) <= Date.now()) clearSession();
  return session;
}
function clearSession() {
  session = null;
  try { wx.removeStorageSync(STORAGE_KEY); } catch (_) {}
}
async function performRequest(action, payload, saved) {
  if (!wx.cloud || !wx.cloud.callFunction) throw new Error('请使用支持云开发的微信版本');
  const body = action === 'login' ? { action, ...payload } : { action, token: saved && saved.token || '', payload };
  const response = await wx.cloud.callFunction({ name: 'api', data: { action: 'nativeAdmin', payload: body } });
  const result = response && response.result;
  if (!result || !result.ok) {
    const error = Object.assign(new Error(result && result.error && result.error.message || '后台请求失败'), { code: result && result.error && result.error.code || 'API_ERROR' });
    if (error.code === 'UNAUTHENTICATED' && saved?.token === getSavedSession()?.token) clearSession();
    throw error;
  }
  return result.data;
}
function request(action, payload = {}) {
  const saved = getSavedSession();
  if (!READ_ACTIONS.has(action)) return performRequest(action, payload, saved);
  const key = JSON.stringify([saved?.token || '', action, payload]);
  if (pendingReads.has(key)) return pendingReads.get(key);
  const pending = performRequest(action, payload, saved).finally(() => {
    if (pendingReads.get(key) === pending) pendingReads.delete(key);
  });
  pendingReads.set(key, pending);
  return pending;
}
async function login(username, password) {
  const result = await request('login', { username, password });
  session = { token: result.token, expiresAt: result.expiresAt };
  try { wx.setStorageSync(STORAGE_KEY, session); } catch (_) { /* Keep this visit usable when storage is full. */ }
  return result.session;
}
async function logout() { try { if (getSavedSession()) await request('logout'); } finally { clearSession(); } }
module.exports = { request, login, logout, getSavedSession, clearSession };
