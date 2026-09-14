const { execFileSync } = require('child_process');

const envId = process.env.TCB_ENV_ID || require('../cloud-config').env;
const uid = String(process.env.BOOTSTRAP_OWNER_UID || '').trim();
const name = String(process.env.BOOTSTRAP_OWNER_NAME || '店主').trim();

if (!uid || uid.length > 191) throw new Error('请通过 BOOTSTRAP_OWNER_UID 指定 CloudBase 登录账号 UID');
if (!name || name.length > 80) throw new Error('BOOTSTRAP_OWNER_NAME 必须是 1 到 80 个字符');

function sqlString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

const now = Date.now();
const record = {
  _id: 'staff_owner',
  id: 'staff_owner',
  uid,
  openid: '',
  role: 'OWNER',
  active: true,
  name,
  createdAt: now,
  updatedAt: now
};
const sql = `INSERT INTO staff_accounts (id, data, created_at, updated_at)
SELECT 'staff_owner', CAST(${sqlString(JSON.stringify(record))} AS JSON), ${now}, ${now}
WHERE NOT EXISTS (
  SELECT 1 FROM staff_accounts
  WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.active')) = 'true'
  LIMIT 1
)`;
const body = JSON.stringify({
  EnvId: envId,
  Sql: sql,
  DbInstance: { EnvId: envId, InstanceId: 'default', Schema: envId },
  ReadOnly: false
});

execFileSync('tcb', ['api', 'tcb', 'RunSql', '-e', envId, '--body', body, '--json'], { stdio: 'inherit' });
console.log('首个 OWNER 初始化命令已执行；若已有 active staff，数据库不会写入新 OWNER。');
