const { find } = require('./db');
const { COLLECTIONS } = require('./constants');
const { toDateString, dateToTimestamp } = require('./time');
const validBooking = order => !order.archived && ['RESERVED','ARRIVED','IN_SERVICE','COMPLETED'].includes(order.status) && order.refundStatus !== 'SUCCESS';
const workId = order => order.workSnapshot?.id || order.workId || '';
async function bookingCounts() {
  const orders = await find(COLLECTIONS.orders, {});
  const counts = {};
  for (const order of orders.filter(validBooking)) { const id = workId(order); if(id) counts[id] = (counts[id] || 0) + 1; }
  return counts;
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
  const trend=Array.from({length:days},(_,i)=>{const date=toDateString(start+i*86400000); const visits=completed.filter(o=>toDateString(o.completedAt)===date);return {date,paidFen:sum(paid.filter(o=>toDateString(o.paidAt)===date),'paidFen'),completedCount:visits.length,customerCount:new Set(visits.map(o=>o.userId).filter(Boolean)).size};});
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
module.exports={bookingCounts,byPopularity,analyze,validBooking};
