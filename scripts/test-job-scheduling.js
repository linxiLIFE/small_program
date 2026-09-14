const assert = require('assert');
const { fairTakeJobs, nextRepairCursor } = require('../cloudfunctions/api/lib/job-scheduling');

const pending = Array.from({ length: 50 }, (_, index) => ({ id: `pending-${index}` }));
const expired = Array.from({ length: 50 }, (_, index) => ({ id: `expired-${index}` }));
const fair = fairTakeJobs(pending, expired, 50);
assert.strictEqual(fair.length, 50);
assert.strictEqual(fair.filter(item => item.id.startsWith('pending-')).length, 25);
assert.strictEqual(fair.filter(item => item.id.startsWith('expired-')).length, 25);
assert.strictEqual(fair[0].id, 'expired-0');

const filled = fairTakeJobs(pending, expired.slice(0, 2), 50);
assert.strictEqual(filled.length, 50);
assert.strictEqual(filled.filter(item => item.id.startsWith('expired-')).length, 2);
assert.strictEqual(filled.filter(item => item.id.startsWith('pending-')).length, 48);

assert.strictEqual(nextRepairCursor([{ id: 'a' }, { id: 'b' }], 2), 'b');
assert.strictEqual(nextRepairCursor([{ id: 'a' }], 2), '');

console.log('job scheduling tests passed: expired leases are fair and reconciliation scans advance');
