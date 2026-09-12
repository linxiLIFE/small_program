const { dateToTimestamp, addMinutes, overlaps } = require('./time');

const DEFAULT_ACTIVE_STATUSES = new Set(['PENDING_PAYMENT', 'RESERVED', 'ARRIVED', 'IN_SERVICE']);

function clockMinutes(value) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function clock(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function interval(date, startMinutes, endMinutes) {
  return {
    startAt: dateToTimestamp(date, clock(startMinutes)),
    endAt: dateToTimestamp(date, clock(endMinutes))
  };
}

function pushBoundary(boundaries, value, startAt, endAt) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > startAt && numeric < endAt) boundaries.add(numeric);
}

function mergeSegments(segments) {
  return segments.reduce((result, segment) => {
    const previous = result[result.length - 1];
    if (previous && previous.kind === segment.kind && previous.endAt === segment.startAt) {
      previous.endAt = segment.endAt;
    } else {
      result.push({ ...segment });
    }
    return result;
  }, []);
}

/**
 * Build the read-only timeline shown to customers. Booking validation still
 * happens in validateBookingSlot/createOrder; this helper only describes the
 * current day plan and never exposes customer or order identifiers.
 */
function buildBookingTimeline({
  date,
  plan = {},
  now = Date.now(),
  minAdvanceMinutes = 0,
  serviceDurationMinutes = 60,
  stepMinutes = 15,
  isActive = item => !item.status || DEFAULT_ACTIVE_STATUSES.has(item.status)
}) {
  const shifts = Array.isArray(plan.shifts) ? plan.shifts : [];
  const parsedShifts = shifts.map((shift) => ({
    ...shift,
    startMinutes: clockMinutes(shift.start),
    endMinutes: clockMinutes(shift.end),
    breaks: Array.isArray(shift.breaks) ? shift.breaks : []
  })).filter((shift) => shift.endMinutes > shift.startMinutes);

  const startMinutes = parsedShifts.length ? Math.min(...parsedShifts.map(item => item.startMinutes)) : 0;
  const endMinutes = parsedShifts.length ? Math.max(...parsedShifts.map(item => item.endMinutes)) : 0;
  const startAt = parsedShifts.length ? dateToTimestamp(date, clock(startMinutes)) : null;
  const endAt = parsedShifts.length ? dateToTimestamp(date, clock(endMinutes)) : null;
  const base = {
    date,
    startAt,
    endAt,
    totalMinutes: Math.max(0, endMinutes - startMinutes),
    durationMinutes: Math.max(1, Number(serviceDurationMinutes) || 60),
    stepMinutes: Math.max(1, Number(stepMinutes) || 15),
    segments: []
  };
  if (!parsedShifts.length || !startAt || !endAt) return base;

  const boundaries = new Set([startAt, endAt]);
  const allowedAt = addMinutes(now, Number(minAdvanceMinutes) || 0);
  pushBoundary(boundaries, allowedAt, startAt, endAt);
  for (const shift of parsedShifts) {
    pushBoundary(boundaries, dateToTimestamp(date, clock(shift.startMinutes)), startAt, endAt);
    pushBoundary(boundaries, dateToTimestamp(date, clock(shift.endMinutes)), startAt, endAt);
    for (const item of shift.breaks) {
      if (!/^\d{2}:\d{2}$/.test(item.start) || !/^\d{2}:\d{2}$/.test(item.end)) continue;
      const breakRange = interval(date, clockMinutes(item.start), clockMinutes(item.end));
      pushBoundary(boundaries, breakRange.startAt, startAt, endAt);
      pushBoundary(boundaries, breakRange.endAt, startAt, endAt);
    }
  }
  for (const item of Array.isArray(plan.occupancies) ? plan.occupancies : []) {
    if (!isActive(item)) continue;
    pushBoundary(boundaries, item.startAt, startAt, endAt);
    pushBoundary(boundaries, item.endAt, startAt, endAt);
  }

  const points = [...boundaries].sort((left, right) => left - right);
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentStart = points[index];
    const segmentEnd = points[index + 1];
    const startMinute = startMinutes + Math.round((segmentStart - startAt) / 60000);
    const endMinute = startMinutes + Math.round((segmentEnd - startAt) / 60000);
    const shift = parsedShifts.find(item => startMinute >= item.startMinutes && endMinute <= item.endMinutes);
    let kind = 'closed';
    if (plan.leave) {
      kind = 'leave';
    } else if (shift) {
      const occupied = (plan.occupancies || []).some(item => isActive(item) && overlaps(segmentStart, segmentEnd, item.startAt, item.endAt));
      const onBreak = shift.breaks.some(item => {
        if (!/^\d{2}:\d{2}$/.test(item.start) || !/^\d{2}:\d{2}$/.test(item.end)) return false;
        const breakRange = interval(date, clockMinutes(item.start), clockMinutes(item.end));
        return overlaps(segmentStart, segmentEnd, breakRange.startAt, breakRange.endAt);
      });
      if (occupied) kind = 'occupied';
      else if (onBreak) kind = 'break';
      else if (segmentStart < allowedAt) kind = 'unavailable';
      else kind = 'available';
    }
    segments.push({ kind, startAt: segmentStart, endAt: segmentEnd });
  }
  return { ...base, segments: mergeSegments(segments) };
}

module.exports = { buildBookingTimeline };
