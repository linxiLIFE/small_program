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

function timelineClock(timestamp) {
  return timeLabel(timestamp);
}

function percentage(value, startAt, endAt) {
  const total = Math.max(1, Number(endAt) - Number(startAt));
  return Math.min(100, Math.max(0, ((Number(value) - Number(startAt)) / total) * 100));
}

function buildFallbackTimeline(slots, durationMinutes) {
  const valid = (Array.isArray(slots) ? slots : [])
    .filter((item) => item && Number.isFinite(Number(item.startAt)))
    .map((item) => ({
      ...item,
      startAt: Number(item.startAt),
      endAt: Number(item.endAt) > Number(item.startAt)
        ? Number(item.endAt)
        : Number(item.startAt) + Math.max(1, Number(durationMinutes) || 60) * 60 * 1000
    }))
    .sort((left, right) => left.startAt - right.startAt);
  if (!valid.length) return { startAt: null, endAt: null, totalMinutes: 0, segments: [] };
  const startAt = valid[0].startAt;
  const endAt = valid[valid.length - 1].endAt;
  return {
    startAt,
    endAt,
    totalMinutes: Math.round((endAt - startAt) / 60000),
    segments: [{ kind: 'available', startAt, endAt }]
  };
}

function decorateBookingTimeline(rawTimeline, slots, durationMinutes = 60, stepMinutes = 15) {
  const fallback = buildFallbackTimeline(slots, durationMinutes);
  const source = rawTimeline && Number(rawTimeline.startAt) < Number(rawTimeline.endAt)
    ? rawTimeline
    : fallback;
  const startAt = Number(source.startAt);
  const endAt = Number(source.endAt);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    return { ...source, startAt: null, endAt: null, totalMinutes: 0, segments: [], ticks: [] };
  }
  const segments = (Array.isArray(source.segments) ? source.segments : [])
    .filter((item) => Number(item.endAt) > Number(item.startAt))
    .map((item, index) => ({
      ...item,
      id: item.id || `timeline-segment-${index}`,
      leftStyle: `left:${percentage(item.startAt, startAt, endAt)}%;`,
      widthStyle: `width:${Math.max(.2, percentage(item.endAt, startAt, endAt) - percentage(item.startAt, startAt, endAt))}%;`
    }));
  const totalMinutes = Math.max(1, Math.round((endAt - startAt) / 60000));
  const everyMinutes = totalMinutes > 480 ? 120 : totalMinutes > 240 ? 60 : 30;
  const firstDate = new Date(startAt);
  const firstMinutes = firstDate.getHours() * 60 + firstDate.getMinutes();
  const firstTick = Math.floor(firstMinutes / everyMinutes) * everyMinutes;
  const ticks = [];
  for (let minute = firstTick; minute <= firstMinutes + totalMinutes; minute += everyMinutes) {
    const timestamp = startAt + (minute - firstMinutes) * 60000;
    if (timestamp < startAt || timestamp > endAt) continue;
    ticks.push({ label: timelineClock(timestamp), leftStyle: `left:${percentage(timestamp, startAt, endAt)}%;` });
  }
  if (!ticks.length || ticks[ticks.length - 1].label !== timelineClock(endAt)) {
    ticks.push({ label: timelineClock(endAt), leftStyle: 'left:100%;' });
  }
  const availableSlots = (Array.isArray(slots) ? slots : [])
    .filter((item) => item && item.available !== false && Number.isFinite(Number(item.startAt)))
    .map((item) => ({
      ...item,
      startAt: Number(item.startAt),
      endAt: Number(item.endAt) > Number(item.startAt)
        ? Number(item.endAt)
        : Number(item.startAt) + Math.max(1, Number(durationMinutes) || 60) * 60000,
      rangeLabel: item.rangeLabel || `${timelineClock(item.startAt)}—${timelineClock(Number(item.endAt) > Number(item.startAt) ? item.endAt : Number(item.startAt) + Math.max(1, Number(durationMinutes) || 60) * 60000)}`
    }))
    .sort((left, right) => left.startAt - right.startAt);
  return {
    ...source,
    startAt,
    endAt,
    totalMinutes,
    durationMinutes: Number(source.durationMinutes) || Number(durationMinutes) || 60,
    stepMinutes: Number(source.stepMinutes) || Number(stepMinutes) || 15,
    segments,
    ticks,
    availableSlots
  };
}

module.exports = { buildTimePeriods, decorateBookingTimeline, timeLabel };
