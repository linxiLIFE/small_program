function pad(value) {
  return String(value).padStart(2, '0');
}

function formatMoney(fen, withSymbol = true) {
  const value = Number(fen || 0) / 100;
  return `${withSymbol ? '¥' : ''}${value.toFixed(2)}`;
}

function formatPoints(points) {
  return `${Number(points || 0).toLocaleString('zh-CN')} 积分`;
}

function formatDateTime(timestamp) {
  if (!timestamp) return '待确定';
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '待确定';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateLabel(dateString) {
  if (!dateString) return '';
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;
}

function formatDuration(minutes) {
  const value = Number(minutes || 0);
  if (value < 60) return `${value}分钟`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}小时${rest}分` : `${hours}小时`;
}

function maskPhone(phone) {
  if (!phone) return '未绑定手机号';
  const value = String(phone);
  return value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : '已绑定手机号';
}

module.exports = {
  formatMoney,
  formatPoints,
  formatDateTime,
  formatDateLabel,
  formatDuration,
  maskPhone
};
