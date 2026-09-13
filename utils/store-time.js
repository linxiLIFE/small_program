const STORE_UTC_OFFSET_MINUTES = 8 * 60;
const STORE_UTC_OFFSET_MS = STORE_UTC_OFFSET_MINUTES * 60 * 1000;

function shiftedDate(timestamp = Date.now()) {
  return new Date(Number(timestamp) + STORE_UTC_OFFSET_MS);
}

function storeParts(timestamp = Date.now()) {
  const date = shiftedDate(timestamp);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes()
  };
}

function storeDateString(timestamp = Date.now()) {
  const parts = storeParts(timestamp);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addStoreDays(dateString, days) {
  const timestamp = Date.parse(`${dateString}T00:00:00Z`) + Number(days) * 24 * 60 * 60 * 1000;
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function storeClock(timestamp) {
  const parts = storeParts(timestamp);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function storeTimestamp(dateString, timeString = '00:00') {
  return Date.parse(`${dateString}T${timeString}:00+08:00`);
}

module.exports = { STORE_UTC_OFFSET_MINUTES, storeParts, storeDateString, addStoreDays, storeClock, storeTimestamp };
