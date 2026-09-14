function fairTakeJobs(pendingJobs = [], expiredJobs = [], limit = 50) {
  const pending = Array.isArray(pendingJobs) ? pendingJobs : [];
  const expired = Array.isArray(expiredJobs) ? expiredJobs : [];
  const max = Math.max(0, Number(limit) || 0);
  const result = [];
  let pendingIndex = 0;
  let expiredIndex = 0;
  let preferExpired = true;

  while (result.length < max && (pendingIndex < pending.length || expiredIndex < expired.length)) {
    if (preferExpired && expiredIndex < expired.length) result.push(expired[expiredIndex++]);
    else if (!preferExpired && pendingIndex < pending.length) result.push(pending[pendingIndex++]);
    else if (expiredIndex < expired.length) result.push(expired[expiredIndex++]);
    else result.push(pending[pendingIndex++]);
    preferExpired = !preferExpired;
  }
  return result;
}

function nextRepairCursor(records = [], pageSize = 100) {
  if (!Array.isArray(records) || records.length < Math.max(1, Number(pageSize) || 1)) return '';
  const last = records[records.length - 1] || {};
  return String(last._id || last.id || '');
}

module.exports = { fairTakeJobs, nextRepairCursor };
