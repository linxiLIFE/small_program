const { assert } = require('./errors');

function integer(value, name) {
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number >= 0, 'INVALID_AMOUNT', `${name}必须是安全范围内的非负整数`);
  return number;
}

function calculatePointsDiscount({ totalFen, availablePoints, requestedPoints, rule }) {
  const total = integer(totalFen, '项目金额');
  const available = integer(availablePoints || 0, '积分余额');
  const requested = integer(requestedPoints || 0, '使用积分');
  const unit = integer(rule.unit, '积分单位');
  const discountFen = integer(rule.discountFen, '积分抵扣金额');
  const maxPercent = Number(rule.maxPercent);
  const maxDiscountFen = Math.floor(total * maxPercent / 100);
  const usableUnits = Math.min(
    Math.floor(available / unit),
    Math.floor(requested / unit),
    Math.floor(maxDiscountFen / discountFen)
  );
  const pointsToUse = usableUnits * unit;
  const actualDiscountFen = usableUnits * discountFen;
  return {
    totalFen: total,
    discountFen: actualDiscountFen,
    paidFen: total - actualDiscountFen,
    pointsToUse,
    maxDiscountFen
  };
}

function earnPoints(paidFen, pointRateFen = 100) {
  const paid = integer(paidFen, '实付金额');
  const rate = integer(pointRateFen, '积分比例');
  assert(rate > 0, 'INVALID_POINT_RULE', '积分比例必须大于零');
  return Math.floor(paid / rate);
}

function rebalancePoints({ availablePoints = 0, debtPoints = 0, returnedPoints = 0, earnedPoints = 0 }) {
  const available = integer(availablePoints, '可用积分');
  const debt = integer(debtPoints, '积分欠额');
  const returned = integer(returnedPoints, '退回积分');
  const earned = integer(earnedPoints, '奖励积分');
  const net = available - debt + returned - earned;
  return { available: Math.max(0, net), debt: Math.max(0, -net) };
}

function awardPoints({ availablePoints = 0, debtPoints = 0, earnedPoints = 0 }) {
  const available = integer(availablePoints, '可用积分');
  const debt = integer(debtPoints, '积分欠额');
  const earned = integer(earnedPoints, '奖励积分');
  const net = available - debt + earned;
  return { available: Math.max(0, net), debt: Math.max(0, -net) };
}

module.exports = { integer, calculatePointsDiscount, earnPoints, rebalancePoints, awardPoints };
