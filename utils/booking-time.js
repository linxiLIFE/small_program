const PARTS = [
  { id: 'morning', label: '上午', end: 12 * 60 },
  { id: 'afternoon', label: '下午', end: 18 * 60 },
  { id: 'evening', label: '晚上', end: 24 * 60 }
];

function minutesOf(timestamp) {
  const date = new Date(Number(timestamp));
  return date.getHours() * 60 + date.getMinutes();
}

function timeLabel(timestamp) {
  const date = new Date(Number(timestamp));
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function partFor(timestamp) {
  const minutes = minutesOf(timestamp);
  return PARTS.find((part) => minutes < part.end) || PARTS[PARTS.length - 1];
}

function buildTimePeriods(slots, stepMinutes = 15, defaultDurationMinutes = 60) {
  const step = Math.max(1, Number(stepMinutes) || 15) * 60 * 1000;
  const duration = Math.max(1, Number(defaultDurationMinutes) || 60) * 60 * 1000;
  const available = (Array.isArray(slots) ? slots : [])
    .filter((slot) => slot && slot.available !== false && Number.isFinite(Number(slot.startAt)))
    .sort((left, right) => Number(left.startAt) - Number(right.startAt));
  const periods = [];
  let current = null;

  for (const rawSlot of available) {
    const startAt = Number(rawSlot.startAt);
    const endAt = Number(rawSlot.endAt) > startAt
      ? Number(rawSlot.endAt)
      : startAt + (Number(rawSlot.durationMinutes) > 0 ? Number(rawSlot.durationMinutes) * 60 * 1000 : duration);
    const slot = { ...rawSlot, startAt, endAt, rangeLabel: `${timeLabel(startAt)}—${timeLabel(endAt)}` };
    const previous = current && current.slots[current.slots.length - 1];
    const part = partFor(startAt);
    if (!current || !previous || current.partId !== part.id || startAt - previous.startAt !== step) {
      current = {
        id: `${slot.id || startAt}-period`,
        partId: part.id,
        label: part.label,
        startAt,
        endAt,
        slots: []
      };
      periods.push(current);
    }
    current.slots.push(slot);
    current.endAt = Math.max(current.endAt, endAt);
  }

  return periods.map((period) => ({
    ...period,
    rangeLabel: `${timeLabel(period.startAt)}—${timeLabel(period.endAt)}`,
    slotCount: period.slots.length
  }));
}

module.exports = { buildTimePeriods, timeLabel };
