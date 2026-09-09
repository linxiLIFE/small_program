const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const envId = process.env.TCB_ENV_ID || require('../cloud-config').env;
const schemaPath = path.join(__dirname, '..', 'docs', 'mysql-schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8').replace(/^\s*--.*$/gm, '');
const statements = schema.split(';').map((statement) => statement.trim()).filter(Boolean);

for (const statement of statements) {
  execFileSync('tcb', ['db', 'execute', '-e', envId, '--sql', statement, '--json'], { stdio: 'inherit' });
}

console.log(`MySQL schema applied: ${statements.length} statements`);
