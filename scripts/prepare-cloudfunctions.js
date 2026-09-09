const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'cloudfunctions', 'api', 'lib');
const targets = [
  path.join(root, 'cloudfunctions', 'jobs', 'lib'),
  path.join(root, 'cloudfunctions', 'payment-callback', 'lib'),
  path.join(root, 'cloudfunctions', 'admin-api', 'lib'),
  path.join(root, 'cloudfunctions', 'seed', 'lib')
];

for (const target of targets) {
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

fs.copyFileSync(path.join(root, 'cloudfunctions', 'api', 'index.js'), path.join(root, 'cloudfunctions', 'admin-api', 'api.js'));

console.log('cloud function shared modules prepared for jobs, payment-callback and admin-api');
