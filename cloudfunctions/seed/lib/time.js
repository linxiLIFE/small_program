const { AppError, assert } = require('./errors');

const TIMEZONE = 'Asia/Shanghai';

function formatParts(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date(Number(timestamp)));
  const result = parts.reduce((value, item) => {
    if (item.type !== 'literal') value[item.type] = Number(item.value);
    return value;
  }, {});
  if (result.hour === 24) result.hour = 0;
  return result;
}

function toDateString(timestamp = Date.now()) {
  const parts = formatParts(timestamp);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function dateToTimestamp(dateString, timeString = '00:00') {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(dateString), 'INVALID_DATE', '日期格式不正确');
  assert(/^\d{2}:\d{2}$/.test(timeString), 'INVALID_TIME', '时间格式不正确');
  const timestamp = Date.parse(`${dateString}T${timeString}:00+08:00`);
  assert(Number.isFinite(timestamp), 'INVALID_TIME', '预约时间不正确');
  return timestamp;
}

function weekday(dateString) {
  const day = new Date(`${dateString}T00:00:00+08:00`).getUTCDay();
  return day === 0 ? 7 : day;
}

function minutesOfDay(timestamp) {
  const parts = formatParts(timestamp);
  return parts.hour * 60 + parts.minute;
}

function addMinutes(timestamp, minutes) {
  return Number(timestamp) + Number(minutes) * 60 * 1000;
}

function isSameLocalDate(timestamp, dateString) {
  return toDateString(timestamp) === dateString;
}

function parseDateRange(dateString) {
  const start = dateToTimestamp(dateString);
  return { start, end: addMinutes(start, 24 * 60) };
}

function isWithinDateWindow(dateString, openDays, minAdvanceMinutes, now = Date.now()) {
  const today = toDateString(now);
  const dayStart = dateToTimestamp(today);
  const targetStart = dateToTimestamp(dateString);
  const maxStart = addMinutes(dayStart, Math.max(0, Number(openDays) - 1) * 24 * 60);
  const targetEnd = addMinutes(targetStart, 24 * 60);
  return targetStart >= dayStart && targetStart <= maxStart && targetEnd >= addMinutes(now, minAdvanceMinutes);
}

function assertValidStart(dateString, startAt, minAdvanceMinutes, openDays, now = Date.now()) {
  assert(isSameLocalDate(startAt, dateString), 'INVALID_SLOT', '预约日期与时段不一致');
  assert(isWithinDateWindow(dateString, openDays, minAdvanceMinutes, now), 'BOOKING_WINDOW_CLOSED', '该日期暂不在可预约范围内');
  assert(Number(startAt) >= addMinutes(now, minAdvanceMinutes), 'TOO_SOON', `请至少提前 ${minAdvanceMinutes} 分钟预约`);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return Number(aStart) < Number(bEnd) && Number(bStart) < Number(aEnd);
}

function enumerateDates(openDays, now = Date.now()) {
  const result = [];
  for (let offset = 0; offset < Number(openDays); offset += 1) {
    result.push(toDateString(addMinutes(dateToTimestamp(toDateString(now)), offset * 24 * 60)));
  }
  return result;
}

module.exports = {
  TIMEZONE,
  formatParts,
  toDateString,
  dateToTimestamp,
  weekday,
  minutesOfDay,
  addMinutes,
  isSameLocalDate,
  parseDateRange,
  isWithinDateWindow,
  assertValidStart,
  overlaps,
  enumerateDates
};
