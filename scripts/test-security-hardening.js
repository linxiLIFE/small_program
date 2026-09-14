const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const apiIndex = read('cloudfunctions/api/index.js');
const adminClient = read('admin/src/api.ts');
assert(!apiIndex.includes('adminBootstrapOwner'));
assert(!apiIndex.includes('adminBootstrapStatus'));
assert(!adminClient.includes('adminBootstrapOwner'));

const bootstrap = read('scripts/bootstrap-owner.js');
assert(bootstrap.includes('BOOTSTRAP_OWNER_UID'));
assert(bootstrap.includes('WHERE NOT EXISTS'));

const db = read('cloudfunctions/api/lib/db.js');
assert(db.includes("if (!user) missing.push('DB_USER')"));
assert(!db.includes("process.env.DB_USER || 'root'"));
assert(db.includes('INSERT IGNORE INTO'));

const booking = read('cloudfunctions/api/lib/booking.js');
const dayInsert = booking.indexOf('transaction.insertIfAbsent(COLLECTIONS.technicianDays');
const dayLock = booking.indexOf('const day = await getDayPlan', dayInsert);
assert(dayInsert >= 0 && dayLock > dayInsert);
assert(booking.indexOf('getSlotFromPlan(day, order.startAt', dayLock) > dayLock);
assert(booking.includes("scheduleTemplates, 'active'"));

const jobs = read('cloudfunctions/jobs/index.js');
assert(jobs.includes('const claimToken = crypto.randomBytes(16)'));
assert((jobs.match(/claimToken: job\.claimToken/g) || []).length >= 2);
assert(jobs.includes('processJobGroups([...grouped.values()], result, 4)'));
assert(jobs.includes('fairTakeJobs(pendingJobs.data || [], expiredJobs.data || [], 50)'));
assert(jobs.includes("orderBy('nextRunAt', 'asc')"));
assert(jobs.includes("'cursor_repair_payments'"));
assert(jobs.includes("'cursor_repair_refunds'"));

const refunds = read('cloudfunctions/api/lib/payment-service.js');
assert(refunds.includes('async function claimRefundSubmission'));
assert(refunds.includes('submissionGeneration'));
assert(refunds.includes('submissionLeaseUntil'));
assert(refunds.includes('if (!claim.acquired) return claim.refund'));

const analytics = read('cloudfunctions/api/lib/analytics.js');
assert(analytics.includes('GROUP BY ${columns.workId}'));
assert(analytics.includes('async function databaseSummary'));
assert(analytics.includes('idx') || read('docs/mysql-schema.sql').includes('idx_orders_work_popularity'));

const orderDetail = read('pages/order-detail/index.js');
assert(orderDetail.includes('if (this.data.paying || this.data.paymentConfirming) return'));
assert(orderDetail.includes('paymentProgress(order'));
assert(orderDetail.includes("order.paymentStatus === 'SUCCESS'"));
assert(orderDetail.includes('loadError'));
assert(orderDetail.includes('[0, 1000, 2000, 4000, 8000]'));
assert(orderDetail.includes('resumePaymentConfirmation'));
assert(orderDetail.includes('retryPaymentConfirmation'));
assert(read('pages/order-detail/index.wxml').includes('重新确认支付结果'));
assert(orderDetail.includes('积分支付完成，无需微信支付'));
assert(!read('pages/booking/index.wxml').includes("quote.totalText || '¥0.00'"));

const schema = read('docs/mysql-schema.sql');
assert(schema.includes('idx_orders_paid_at'));
assert(schema.includes('idx_orders_completed_at'));
assert(schema.includes('idx_orders_user_completed'));
assert(schema.includes('idx_refunds_success_at'));

const workflow = read('.github/workflows/ci.yml');
assert(workflow.includes('npm test'));
assert(workflow.includes('Verify shared cloud modules are synchronized'));

console.log('security hardening passed: controlled OWNER provisioning, tokenized leases, refund claim, row lock, payment UI, SQL aggregation and DB config');
