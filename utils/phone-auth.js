function normalizedErrorMessage(detail = {}) {
  return String(detail.errMsg || '').replace(/^getPhoneNumber:fail\s*/i, '').trim();
}

function phoneAuthFailureMessage(detail = {}) {
  const message = normalizedErrorMessage(detail);
  const lower = message.toLowerCase();
  const errno = Number(detail.errno);

  if (errno === 1400001) {
    return '手机号快速验证体验次数已用完，请在微信公众平台购买资源包后再试。';
  }
  if (errno === 102 || lower.includes('jsapi has no permission') || lower.includes('no permission')) {
    return '当前小程序暂未开通手机号授权，请完成小程序认证，并确认不是个人主体。';
  }
  if (errno === 112 || lower.includes('scope is not declared') || lower.includes('privacy api banned')) {
    return '小程序隐私保护指引尚未声明手机号，请在微信公众平台补充后再试。';
  }
  if (errno === 103 || lower.includes('user deny') || lower.includes('cancel')) {
    return '你取消了手机号授权，需要预约时请再次点击授权手机号。';
  }
  if (errno === 104 || lower.includes('privacy permission') || lower.includes('privacy')) {
    return '请先同意小程序隐私保护指引，再授权手机号。';
  }
  if (!message) {
    return '微信没有返回手机号授权凭证，请重新点击授权手机号。';
  }
  return `手机号授权失败：${message}`;
}

function isUserCancellation(detail = {}) {
  const message = normalizedErrorMessage(detail).toLowerCase();
  const errno = Number(detail.errno);
  return errno === 103 || message.includes('user deny') || message.includes('cancel');
}

function showPhoneAuthFailure(detail = {}) {
  const message = phoneAuthFailureMessage(detail);
  if (isUserCancellation(detail)) {
    wx.showToast({ title: '你取消了手机号授权', icon: 'none' });
    return;
  }
  wx.showModal({ title: '手机号授权失败', content: message, showCancel: false });
}

function phoneBindFailureMessage(error = {}) {
  switch (error.code) {
    case 'UNAUTHENTICATED':
      return '微信登录状态已失效，请重新进入小程序后再试。';
    case 'PHONE_EXCHANGE_FAILED':
      return '微信手机号授权凭证无效或已过期，请重新点击授权手机号。';
    case 'CONTACT_ENCRYPTION_NOT_CONFIGURED':
      return '服务端尚未配置联系方式加密密钥，请联系管理员。';
    case 'CONTACT_ENCRYPTION_INVALID':
      return '服务端联系方式加密配置不正确，请联系管理员。';
    default:
      return error.message || '手机号绑定失败，请稍后重试。';
  }
}

module.exports = { phoneAuthFailureMessage, showPhoneAuthFailure, phoneBindFailureMessage };
