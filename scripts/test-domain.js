const assert = require('assert');
const { calculatePointsDiscount, earnPoints, rebalancePoints, awardPoints } = require('../cloudfunctions/api/lib/money');
const { overlaps, dateToTimestamp, isWithinDateWindow, toDateString, addMinutes } = require('../cloudfunctions/api/lib/time');
const { buildTimePeriods } = require('../utils/booking-time');
const { formatCountdown } = require('../utils/format');
const { formatDateTime, formatDateLabel } = require('../utils/format');
const { storeDateString } = require('../utils/store-time');
const { buildBookingTimeline } = require('../cloudfunctions/api/lib/booking-timeline');

const rule = { unit: 20, discountFen: 100, maxPercent: 10 };
assert.throws(() => calculatePointsDiscount({ totalFen: Number.MAX_SAFE_INTEGER + 1, availablePoints: 0, requestedPoints: 0, rule }), /安全范围/);
const fullLimit = calculatePointsDiscount({ totalFen: 20000, availablePoints: 1000, requestedPoints: 1000, rule });
assert.deepStrictEqual(fullLimit, { totalFen: 20000, discountFen: 2000, paidFen: 18000, pointsToUse: 400, maxDiscountFen: 2000 });

const limitedByBalance = calculatePointsDiscount({ totalFen: 29900, availablePoints: 60, requestedPoints: 1000, rule });
assert.strictEqual(limitedByBalance.pointsToUse, 60);
assert.strictEqual(limitedByBalance.discountFen, 300);
assert.strictEqual(earnPoints(18000, 100), 180);
assert.strictEqual(earnPoints(199, 100), 1);
assert.deepStrictEqual(rebalancePoints({ availablePoints: 20, debtPoints: 0, returnedPoints: 40 }), { available: 60, debt: 0 });
assert.deepStrictEqual(rebalancePoints({ availablePoints: 10, debtPoints: 0, earnedPoints: 30 }), { available: 0, debt: 20 });
assert.deepStrictEqual(awardPoints({ availablePoints: 0, debtPoints: 20, earnedPoints: 30 }), { available: 10, debt: 0 });
assert.strictEqual(overlaps(0, 10, 10, 20), false);
assert.strictEqual(overlaps(0, 10, 9, 20), true);
assert.strictEqual(formatCountdown(5 * 60 * 1000 - 1000), '04:59');
assert.strictEqual(formatCountdown(0), '00:00');
assert.strictEqual(formatCountdown(-1000), '00:00');

const periodStart = Date.parse('2026-09-12T10:00:00+08:00');
const groupedPeriods = buildTimePeriods([
  { id: 'slot-1', startAt: periodStart, available: true },
  { id: 'slot-2', startAt: periodStart + 30 * 60 * 1000, available: true },
  { id: 'slot-3', startAt: periodStart + 90 * 60 * 1000, available: true }
], 30, 60);
assert.strictEqual(groupedPeriods.length, 2);
assert.strictEqual(groupedPeriods[0].slotCount, 2);
assert.strictEqual(groupedPeriods[0].rangeLabel, '10:00—11:30');
assert.strictEqual(groupedPeriods[1].rangeLabel, '11:30—12:30');
const dayPartPeriods = buildTimePeriods([
  { id: 'morning-slot', startAt: Date.parse('2026-09-12T11:30:00+08:00'), available: true },
  { id: 'afternoon-slot', startAt: Date.parse('2026-09-12T12:00:00+08:00'), available: true }
], 30, 60);
assert.deepStrictEqual(dayPartPeriods.map((period) => period.label), ['上午', '下午']);

const timelineDate = '2026-09-12';
const bookingTimeline = buildBookingTimeline({
  date: timelineDate,
  now: dateToTimestamp(timelineDate, '09:00'),
  minAdvanceMinutes: 60,
  serviceDurationMinutes: 60,
  stepMinutes: 30,
  plan: {
    leave: false,
    shifts: [
      { start: '10:00', end: '12:00', breaks: [] },
      { start: '13:00', end: '20:00', breaks: [{ start: '17:00', end: '18:00' }] }
    ],
    occupancies: [{ startAt: dateToTimestamp(timelineDate, '14:00'), endAt: dateToTimestamp(timelineDate, '15:00'), status: 'RESERVED' }]
  }
});
assert.deepStrictEqual(bookingTimeline.segments.map(item => item.kind), ['available', 'closed', 'available', 'occupied', 'available', 'break', 'available']);
assert.equal(bookingTimeline.segments.find(item => item.kind === 'occupied').startAt, dateToTimestamp(timelineDate, '14:00'));

const today = toDateString();
const todayAtNoon = dateToTimestamp(today, '12:00');
assert.strictEqual(typeof todayAtNoon, 'number');
assert.strictEqual(isWithinDateWindow(today, 14, 0), true);
const lastOpenDate = toDateString(addMinutes(dateToTimestamp(today), 13 * 24 * 60));
const outsideOpenDate = toDateString(addMinutes(dateToTimestamp(today), 14 * 24 * 60));
assert.strictEqual(isWithinDateWindow(lastOpenDate, 14, 0), true);
assert.strictEqual(isWithinDateWindow(outsideOpenDate, 14, 0), false);
assert.strictEqual(storeDateString(Date.parse('2026-09-13T16:30:00Z')), '2026-09-14');
assert.strictEqual(formatDateTime(Date.parse('2026-09-13T16:30:00Z')), '9月14日 00:30');
assert.strictEqual(formatDateLabel('2026-09-14'), '9月14日 周一');

console.log('domain tests passed: money, points, interval and booking window rules');
