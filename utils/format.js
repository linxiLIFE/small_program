function pad(value) {
  return String(value).padStart(2, '0');
}
const { storeParts } = require('./store-time');

function formatMoney(fen, withSymbol = true) {
  const value = Number(fen || 0) / 100;
  return `${withSymbol ? '¥' : ''}${value.toFixed(2)}`;
}

function formatPoints(points) {
  return `${Number(points || 0).toLocaleString('zh-CN')} 积分`;
}

function formatDateTime(timestamp) {
  if (!timestamp) return '待确定';
  if (!Number.isFinite(Number(timestamp))) return '待确定';
  const date = storeParts(timestamp);
  return `${date.month}月${date.day}日 ${pad(date.hour)}:${pad(date.minute)}`;
}

function formatDateTimeRange(startAt, endAt, durationMinutes) {
  if (!startAt) return '待确定';
  const startTimestamp = Number(startAt);
  if (!Number.isFinite(startTimestamp)) return '待确定';
  const start = storeParts(startTimestamp);
  let endTimestamp = Number(endAt);
  if (!Number.isFinite(endTimestamp) || endTimestamp <= startTimestamp) {
    const duration = Number(durationMinutes || 0);
    if (duration > 0) endTimestamp = startTimestamp + duration * 60 * 1000;
  }
  if (!Number.isFinite(endTimestamp) || endTimestamp <= startTimestamp) return formatDateTime(startAt);
  const end = storeParts(endTimestamp);
  const startLabel = formatDateTime(startAt);
  const endClock = `${pad(end.hour)}:${pad(end.minute)}`;
  const sameDate = start.year === end.year && start.month === end.month && start.day === end.day;
  const endLabel = sameDate ? endClock : `${end.month}月${end.day}日 ${endClock}`;
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
  const timestamp = Date.parse(`${dateString}T00:00:00+08:00`);
  if (!Number.isFinite(timestamp)) return dateString;
  const date = storeParts(timestamp);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${date.month}月${date.day}日 ${weekdays[date.weekday]}`;
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
