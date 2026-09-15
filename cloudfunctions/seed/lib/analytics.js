const { db, find } = require('./db');
const { COLLECTIONS } = require('./constants');
const { toDateString, dateToTimestamp } = require('./time');
const validBooking = order => !order.archived && ['RESERVED','ARRIVED','IN_SERVICE','COMPLETED'].includes(order.status);
const workId = order => order.workSnapshot?.id || order.workId || '';
async function bookingCounts() {
  if (db && typeof db.query === 'function') {
    const indexed = await hasAnalyticsColumns();
    const columns = analyticsExpressions(indexed);
    const [rows] = await db.query(`
      SELECT ${columns.workId} AS work_id, COUNT(*) AS booking_count
      FROM orders
      WHERE status IN ('RESERVED', 'ARRIVED', 'IN_SERVICE', 'COMPLETED')
        AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.archived')), 'false') <> 'true'
        AND ${columns.workId} IS NOT NULL
        AND ${columns.workId} <> ''
      GROUP BY ${columns.workId}
    `);
    return Object.fromEntries((rows || []).map((row) => [String(row.work_id), Number(row.booking_count || 0)]));
  }
  // Lightweight unit-test adapters may only provide find(). Production always
  // uses the SQL aggregation above and never transfers the full order table.
  const orders = await find(COLLECTIONS.orders, {});
  const counts = {};
  for (const order of orders.filter(validBooking)) { const id = workId(order); if(id) counts[id] = (counts[id] || 0) + 1; }
  return counts;
}

let analyticsColumnsAvailable;
async function hasAnalyticsColumns() {
  if (analyticsColumnsAvailable !== undefined) return analyticsColumnsAvailable;
  try {
    await db.query('SELECT work_id, paid_at, completed_at, paid_fen FROM orders LIMIT 0');
    await db.query('SELECT success_at, amount_fen FROM refunds LIMIT 0');
    analyticsColumnsAvailable = true;
  } catch (error) {
    if (error && error.code === 'ER_BAD_FIELD_ERROR') analyticsColumnsAvailable = false;
    else throw error;
  }
  return analyticsColumnsAvailable;
}

function analyticsExpressions(indexed) {
  const jsonText = (path) => `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$.${path}')), '')`;
  const jsonInteger = (path) => `CAST(COALESCE(${jsonText(path)}, '0') AS SIGNED)`;
  return indexed ? {
    workId: 'work_id', paidAt: 'paid_at', completedAt: 'completed_at', paidFen: 'paid_fen',
    refundSuccessAt: 'success_at', refundAmountFen: 'amount_fen'
  } : {
    workId: jsonText('workSnapshot.id'), paidAt: jsonInteger('paidAt'), completedAt: jsonInteger('completedAt'), paidFen: jsonInteger('paidFen'),
    refundSuccessAt: jsonInteger('successAt'), refundAmountFen: jsonInteger('amountFen')
  };
}
function byPopularity(a,b) { return (b.bookingCount || 0)-(a.bookingCount || 0) || String(a.id).localeCompare(String(b.id)); }
function analyze(orders, refunds, days = 30, now = Date.now()) {
  const today = toDateString(now); const start = dateToTimestamp(today) - (days-1)*86400000; const end = dateToTimestamp(today)+86400000;
  const inRange = timestamp => Number(timestamp) >= start && Number(timestamp) < end;
  const clean = orders.filter(o => !o.archived);
  const firstVisit = new Map();
  for(const order of clean.filter(o=>o.userId && Number(o.completedAt)>0)) firstVisit.set(order.userId,Math.min(firstVisit.get(order.userId)||Infinity,order.completedAt));
  const paid = clean.filter(o=>o.paymentStatus==='SUCCESS' && inRange(o.paidAt));
  // 履约事实由 completedAt 表示；后续退款只改变资金状态，不能抹掉已完成服务。
  const completed = clean.filter(o=>Number(o.completedAt)>0 && inRange(o.completedAt));
  const customers = [...new Set(completed.map(o=>o.userId).filter(Boolean))];
  const newCustomerCount = customers.filter(id=>firstVisit.get(id)>=start).length;
  const refundRecords = refunds.filter(r=>!r.archived && r.status==='SUCCESS' && inRange(r.successAt));
  const sum=(items,field)=>items.reduce((total,item)=>total+Number(item[field]||0),0);
  const trend=Array.from({length:days},(_,i)=>{const date=toDateString(start+i*86400000); const visits=completed.filter(o=>toDateString(o.completedAt)===date);const dailyPaid=sum(paid.filter(o=>toDateString(o.paidAt)===date),'paidFen');const dailyRefund=sum(refundRecords.filter(r=>toDateString(r.successAt)===date),'amountFen');return {date,paidFen:dailyPaid,refundFen:dailyRefund,netFen:dailyPaid-dailyRefund,completedCount:visits.length,customerCount:new Set(visits.map(o=>o.userId).filter(Boolean)).size};});
  const rank = (key,name) => {
    const groups={};
    for(const o of clean.filter(o=>validBooking(o)&&inRange(o.createdAt))) {
      const id=key(o); if(!id)continue;
      const item=groups[id] ||= {id,name:name(o),count:0,paidFen:0};item.count++;item.paidFen+=Number(o.paidFen||0);
    }
    return Object.values(groups).sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id)).slice(0,8);
  };
  const paidFen=sum(paid,'paidFen'), refundFen=sum(refundRecords,'amountFen');
  return {date:today,days,rangeStart:toDateString(start),metrics:{paidFen,refundFen,netFen:paidFen-refundFen,completedFen:sum(completed,'paidFen'),orderCount:clean.filter(o=>inRange(o.createdAt)).length,completedCount:completed.length,customerCount:customers.length,noShowCount:clean.filter(o=>o.status==='CANCELLED_NO_SHOW'&&inRange(o.updatedAt)).length,newCustomerCount,returningCustomerCount:customers.length-newCustomerCount,repeatRate:customers.length?Math.round((customers.length-newCustomerCount)/customers.length*100):0,averageOrderFen:paid.length?Math.round(paidFen/paid.length):0},trend,works:rank(workId,o=>o.workSnapshot?.title||'款式'),services:rank(o=>o.serviceId,o=>o.serviceSnapshot?.name||o.serviceName||'项目'),technicians:rank(o=>o.technicianId,o=>o.technicianSnapshot?.name||o.technicianName||'技师')};
}

function number(value) { return Number(value || 0); }

async function databaseSummary(range = 30, now = Date.now()) {
  const custom = range && typeof range === 'object';
  const days = custom ? Math.max(1, Math.round((Number(range.end) - Number(range.start)) / 86400000)) : Number(range || 30);
  const today = custom ? String(range.dateTo) : toDateString(now);
  const start = custom ? Number(range.start) : dateToTimestamp(today) - (days - 1) * 86400000;
  const end = custom ? Number(range.end) : dateToTimestamp(today) + 86400000;
  const indexed = await hasAnalyticsColumns();
  const columns = analyticsExpressions(indexed);
  const activeStatuses = "'RESERVED', 'ARRIVED', 'IN_SERVICE', 'COMPLETED'";
  const clean = "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.archived')), 'false') <> 'true'";
  const dimensionQuery = (idExpression, nameExpression) => db.query(`
    SELECT ${idExpression} AS id, MAX(${nameExpression}) AS name, COUNT(*) AS count, COALESCE(SUM(${columns.paidFen}), 0) AS paid_fen
    FROM orders
    WHERE ${clean}
      AND status IN (${activeStatuses})
      AND created_at >= ? AND created_at < ?
      AND ${idExpression} IS NOT NULL AND ${idExpression} <> ''
    GROUP BY ${idExpression}
    ORDER BY count DESC, id ASC
    LIMIT 8
  `, [start, end]);
  const [orderResult, refundResult, customerResult, paidTrendResult, refundTrendResult, completedTrendResult, worksResult, servicesResult, techniciansResult, categoriesResult, slotResult] = await Promise.all([
    db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN payment_status = 'SUCCESS' AND ${columns.paidAt} >= ? AND ${columns.paidAt} < ? THEN ${columns.paidFen} ELSE 0 END), 0) AS paid_fen,
        COALESCE(SUM(CASE WHEN ${columns.completedAt} >= ? AND ${columns.completedAt} < ? THEN ${columns.paidFen} ELSE 0 END), 0) AS completed_fen,
        SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS order_count,
        SUM(CASE WHEN ${columns.completedAt} >= ? AND ${columns.completedAt} < ? THEN 1 ELSE 0 END) AS completed_count,
        COUNT(DISTINCT CASE WHEN ${columns.completedAt} >= ? AND ${columns.completedAt} < ? THEN user_id END) AS customer_count,
        SUM(CASE WHEN status = 'CANCELLED_NO_SHOW' AND updated_at >= ? AND updated_at < ? THEN 1 ELSE 0 END) AS no_show_count,
        SUM(CASE WHEN status IN ('CANCELLED', 'CANCELLED_BY_USER', 'CANCELLED_NO_SHOW', 'CANCEL_PENDING_REFUND', 'REFUNDED') AND updated_at >= ? AND updated_at < ? THEN 1 ELSE 0 END) AS cancelled_count,
        SUM(CASE WHEN CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.arrivedAt')), '0') AS SIGNED) >= ? AND CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.arrivedAt')), '0') AS SIGNED) < ? THEN 1 ELSE 0 END) AS arrived_count,
        SUM(CASE WHEN payment_status = 'SUCCESS' AND ${columns.paidAt} >= ? AND ${columns.paidAt} < ? THEN 1 ELSE 0 END) AS paid_count
      FROM orders
      WHERE ${clean}
        AND ((created_at >= ? AND created_at < ?)
          OR (${columns.paidAt} >= ? AND ${columns.paidAt} < ?)
          OR (${columns.completedAt} >= ? AND ${columns.completedAt} < ?)
          OR (updated_at >= ? AND updated_at < ?))
    `, [start,end,start,end,start,end,start,end,start,end,start,end,start,end,start,end,start,end,start,end,start,end,start,end,start,end]),
    db.query(`SELECT COALESCE(SUM(${columns.refundAmountFen}), 0) AS refund_fen, COUNT(*) AS refund_count FROM refunds WHERE status = 'SUCCESS' AND ${columns.refundSuccessAt} >= ? AND ${columns.refundSuccessAt} < ? AND ${clean}`, [start,end]),
    db.query(`
      SELECT COUNT(*) AS customer_count, COALESCE(SUM(first_visit >= ?), 0) AS new_customer_count
      FROM (
        SELECT user_id, MIN(${columns.completedAt}) AS first_visit,
          MAX(CASE WHEN ${columns.completedAt} >= ? AND ${columns.completedAt} < ? THEN 1 ELSE 0 END) AS visited_in_range
        FROM orders
        WHERE ${clean} AND user_id IS NOT NULL AND user_id <> '' AND ${columns.completedAt} > 0
        GROUP BY user_id
      ) customer_visits
      WHERE visited_in_range = 1
    `, [start,start,end]),
    db.query(`SELECT DATE_FORMAT(FROM_UNIXTIME(${columns.paidAt} / 1000), '%Y-%m-%d') AS date, COALESCE(SUM(${columns.paidFen}), 0) AS paid_fen FROM orders WHERE ${clean} AND payment_status = 'SUCCESS' AND ${columns.paidAt} >= ? AND ${columns.paidAt} < ? GROUP BY date`, [start,end]),
    db.query(`SELECT DATE_FORMAT(FROM_UNIXTIME(${columns.refundSuccessAt} / 1000), '%Y-%m-%d') AS date, COALESCE(SUM(${columns.refundAmountFen}), 0) AS refund_fen FROM refunds WHERE ${clean} AND status = 'SUCCESS' AND ${columns.refundSuccessAt} >= ? AND ${columns.refundSuccessAt} < ? GROUP BY date`, [start,end]),
    db.query(`SELECT DATE_FORMAT(FROM_UNIXTIME(${columns.completedAt} / 1000), '%Y-%m-%d') AS date, COUNT(*) AS completed_count, COUNT(DISTINCT user_id) AS customer_count FROM orders WHERE ${clean} AND ${columns.completedAt} >= ? AND ${columns.completedAt} < ? GROUP BY date`, [start,end]),
    dimensionQuery(columns.workId, "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.workSnapshot.title')), '款式')"),
    dimensionQuery("NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$.serviceId')), '')", "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.serviceSnapshot.name')), JSON_UNQUOTE(JSON_EXTRACT(data, '$.serviceName')), '项目')"),
    dimensionQuery('technician_id', "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.technicianSnapshot.name')), JSON_UNQUOTE(JSON_EXTRACT(data, '$.technicianName')), '技师')"),
    dimensionQuery("NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$.serviceSnapshot.categoryId')), '')", "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.serviceSnapshot.categoryName')), '大项')"),
    db.query(`SELECT WEEKDAY(FROM_UNIXTIME(start_at / 1000)) + 1 AS weekday, HOUR(FROM_UNIXTIME(start_at / 1000)) AS hour, COUNT(*) AS count FROM orders WHERE ${clean} AND start_at >= ? AND start_at < ? AND status IN (${activeStatuses}) GROUP BY weekday, hour ORDER BY weekday, hour`, [start,end])
  ]);
  const orderMetrics = orderResult[0][0] || {};
  const refundMetrics = refundResult[0][0] || {};
  const customerMetrics = customerResult[0][0] || {};
  const paidByDate = new Map((paidTrendResult[0] || []).map((row) => [String(row.date), number(row.paid_fen)]));
  const refundByDate = new Map((refundTrendResult[0] || []).map((row) => [String(row.date), number(row.refund_fen)]));
  const completedByDate = new Map((completedTrendResult[0] || []).map((row) => [String(row.date), row]));
  const trend = Array.from({ length: days }, (_, index) => {
    const date = toDateString(start + index * 86400000);
    const completed = completedByDate.get(date) || {};
    const paidFen = paidByDate.get(date) || 0;
    const refundFen = refundByDate.get(date) || 0;
    return { date, paidFen, refundFen, netFen: paidFen - refundFen, completedCount: number(completed.completed_count), customerCount: number(completed.customer_count) };
  });
  const customerCount = number(customerMetrics.customer_count || orderMetrics.customer_count);
  const newCustomerCount = number(customerMetrics.new_customer_count);
  const paidFen = number(orderMetrics.paid_fen);
  const refundFen = number(refundMetrics.refund_fen);
  const paidCount = number(orderMetrics.paid_count);
  const completedCount = number(orderMetrics.completed_count);
  const cancelledCount = number(orderMetrics.cancelled_count);
  const arrivedCount = number(orderMetrics.arrived_count);
  const rank = (result) => (result[0] || []).map((row) => ({ id: String(row.id), name: String(row.name || ''), count: number(row.count), paidFen: number(row.paid_fen) }));
  return {
    date: today,
    days,
    rangeStart: toDateString(start),
    metrics: {
      paidFen,
      refundFen,
      netFen: paidFen - refundFen,
      completedFen: number(orderMetrics.completed_fen),
      orderCount: number(orderMetrics.order_count),
      completedCount,
      customerCount,
      noShowCount: number(orderMetrics.no_show_count),
      cancelledCount,
      arrivedCount,
      refundCount: number(refundMetrics.refund_count),
      completionRate: paidCount ? Math.round(completedCount / paidCount * 100) : 0,
      noShowRate: paidCount ? Math.round(number(orderMetrics.no_show_count) / paidCount * 100) : 0,
      newCustomerCount,
      returningCustomerCount: Math.max(0, customerCount - newCustomerCount),
      repeatRate: customerCount ? Math.round((customerCount - newCustomerCount) / customerCount * 100) : 0,
      averageOrderFen: paidCount ? Math.round(paidFen / paidCount) : 0
    },
    trend,
    works: rank(worksResult),
    services: rank(servicesResult),
    technicians: rank(techniciansResult),
    categories: rank(categoriesResult),
    timeSlots: (slotResult[0] || []).map((row) => ({ weekday: number(row.weekday), hour: number(row.hour), count: number(row.count) }))
  };
}

module.exports={bookingCounts,byPopularity,analyze,databaseSummary,validBooking};
