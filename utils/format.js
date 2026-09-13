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

function formatDateTimeRange(startAt, endAt, durationMinutes) {
  if (!startAt) return '待确定';
  const start = new Date(Number(startAt));
  if (Number.isNaN(start.getTime())) return '待确定';
  let endTimestamp = Number(endAt);
  if (!Number.isFinite(endTimestamp) || endTimestamp <= start.getTime()) {
    const duration = Number(durationMinutes || 0);
    if (duration > 0) endTimestamp = start.getTime() + duration * 60 * 1000;
  }
  if (!Number.isFinite(endTimestamp) || endTimestamp <= start.getTime()) return formatDateTime(startAt);
  const end = new Date(endTimestamp);
  if (Number.isNaN(end.getTime())) return formatDateTime(startAt);
  const startLabel = formatDateTime(startAt);
  const endClock = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  const sameDate = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate();
  const endLabel = sameDate ? endClock : `${end.getMonth() + 1}月${end.getDate()}日 ${endClock}`;
  return `${startLabel}—${endLabel}`;
}

function formatCountdown(milliseconds) {
  const value = Number(milliseconds);
  const totalSeconds = Number.isFinite(value) ? Math.max(0, Math.ceil(value / 1000)) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${pad(minutes)}:${pad(seconds)}`;
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
  formatDateTimeRange,
  formatCountdown,
  formatDateLabel,
  formatDuration,
  maskPhone
};
