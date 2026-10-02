// Move existing records without deleting or recreating service/style identities.
// Default is read-only. --apply writes a protected catalog backup first.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const envId = require('../cloud-config').env;
const categoryId = 'nail-care', categoryName = '卸甲 / 建构';
const handCategories = ['nail', '514aa7c9-1cf3-4fe1-ba92-fcc2de47694e'];
const hex = value => `CONVERT(0x${Buffer.from(String(value)).toString('hex')} USING utf8mb4)`;
const json = value => `CAST(${hex(JSON.stringify(value))} AS JSON)`;
function sql(Sql, ReadOnly = true) {
  const raw = execFileSync('tcb', ['api', 'tcb', 'RunSql', '-e', envId, '--body', JSON.stringify({ EnvId: envId, Sql, DbInstance: { EnvId: envId, InstanceId: 'default', Schema: envId }, ReadOnly }), '--json'], { encoding: 'utf8' });
  const result = JSON.parse(raw.slice(raw.indexOf('{')));
  if (result.error || result.data?.Error) throw new Error(JSON.stringify(result.error || result.data.Error));
  return result.data;
}
function rows(table) { return (sql(`SELECT id, data FROM ${table}`).Items || []).map(value => { const row = JSON.parse(value); return { id: row.id, data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data }; }); }
const tables = Object.fromEntries(['categories', 'services', 'works', 'technicians'].map(table => [table, rows(table)]));
const active = data => !data.archived && data.enabled !== false && data.enabled !== 0;
const services = tables.services.filter(row => active(row.data) && row.data.categoryId === 'nail' && ['REMOVAL', 'BUILDER'].includes(row.data.addonType));
assert.equal(services.length, 6, 'Expected the three existing hand removals and three builders; inspect changes before moving');
const ids = new Set(services.map(row => row.id));
const now = Date.now();
const changes = [];
function update(table, row, values) { changes.push({ table, id: row.id, before: row.data, after: { ...row.data, ...values, updatedAt: now, version: Number(row.data.version || 0) + 1 } }); }
const existingCategory = tables.categories.find(row => row.id === categoryId);
if (existingCategory) assert(active(existingCategory.data) && existingCategory.data.name === categoryName, 'Existing nail-care category differs');
else changes.push({ table: 'categories', id: categoryId, before: null, after: { id: categoryId, _id: categoryId, name: categoryName, icon: '◇', color: '#eaded8', subtitle: '独立卸甲与建构', enabled: true, sort: Math.max(0, ...tables.categories.filter(row => !row.data.archived).map(row => Number(row.data.sort || 0))) + 1, createdAt: now, updatedAt: now, version: 1 } });
services.sort((a, b) => (a.data.addonType === 'REMOVAL' ? 0 : 1) - (b.data.addonType === 'REMOVAL' ? 0 : 1) || Number(a.data.sort) - Number(b.data.sort));
services.forEach((row, index) => update('services', row, { categoryId, categoryName, sort: index + 1, bookableStandalone: true }));
const remaining = tables.services.filter(row => !row.data.archived && row.data.categoryId === 'nail' && !ids.has(row.id)).sort((a, b) => Number(a.data.sort) - Number(b.data.sort));
remaining.forEach((row, index) => { if (row.data.sort !== index + 1) update('services', row, { sort: index + 1 }); });
tables.works.filter(row => !row.data.archived && ids.has(row.data.serviceId)).forEach(row => update('works', row, { categoryId, categoryName }));
tables.technicians.filter(row => active(row.data) && (row.data.categoryIds || []).some(id => handCategories.includes(id)) && !(row.data.categoryIds || []).includes(categoryId)).forEach(row => update('technicians', row, { categoryIds: [...row.data.categoryIds, categoryId] }));
console.log(JSON.stringify({ apply: process.argv.includes('--apply'), services: services.map(row => ({ id: row.id, name: row.data.name, priceFen: row.data.priceFen, durationMinutes: row.data.durationMinutes })), counts: Object.fromEntries(['categories', 'services', 'works', 'technicians'].map(table => [table, changes.filter(change => change.table === table).length])) }, null, 2));
if (!process.argv.includes('--apply')) process.exit(0);
const backup = path.resolve('.release', `nail-care-backup-${now}.json`);
fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.writeFileSync(backup, JSON.stringify({ envId, createdAt: now, tables, changes }, null, 2), { mode: 0o600 });
console.log(`Backup: ${backup}`);
for (const change of changes) {
  const record = change.after;
  const query = change.before
    ? `UPDATE ${change.table} SET data=${json(record)}, updated_at=${now} WHERE id=${hex(change.id)} AND COALESCE(JSON_EXTRACT(data,'$.version'),0)=${Number(change.before.version || 0)} AND COALESCE(JSON_EXTRACT(data,'$.updatedAt'),0)=${Number(change.before.updatedAt || 0)}`
    : `INSERT INTO ${change.table} (id,data,created_at,updated_at) VALUES (${hex(change.id)},${json(record)},${now},${now})`;
  const result = sql(query, false);
  assert.equal(Number(result.RowsAffected), 1, `Concurrent change detected: ${change.table}/${change.id}; backup retained`);
  console.log(`Updated ${change.table}/${change.id}`);
}
const audit = { id: `audit-nail-care-${now}`, operatorId: 'authorized-maintenance', action: 'MOVE_NAIL_CARE_CATALOG', objectType: 'categories', objectId: categoryId, summary: { serviceIds: [...ids], backup: path.basename(backup) }, createdAt: now };
sql(`INSERT INTO audit_logs (id,data,created_at,updated_at) VALUES (${hex(audit.id)},${json(audit)},${now},${now})`, false);
console.log('Catalog moved; all original IDs, prices and durations preserved.');
