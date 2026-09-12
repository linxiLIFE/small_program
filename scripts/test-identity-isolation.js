const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const users = {};
const db = {
  collection: name => ({
    doc: id => ({ set: async ({ data }) => { users[`${name}:${id}`] = data; } })
  })
};
const errors = {
  AppError: class AppError extends Error {},
  assert(condition, code, message) { if (!condition) throw new Error(`${code}:${message}`); }
};
const constants = { COLLECTIONS: { users: 'users', staff: 'staff_accounts' }, ROLE_LABELS: {} };
const authModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/auth.js'), 'utf8'), {
  module: authModule,
  exports: authModule.exports,
  require: name => name === './constants' ? constants : name === './db' ? { db, getContext: () => ({}) , getOptional: async (collection, id) => users[`${collection}:${id}`] || null, find: async () => [] } : errors
});

(async () => {
  const auth = authModule.exports;
  const first = await auth.ensureUser('openid-first', { appid: 'wx-app' });
  const second = await auth.ensureUser('openid-second', { appid: 'wx-app' });
  assert.notEqual(first._id, second._id);
  assert.equal(first.openid, 'openid-first');
  assert.equal(second.openid, 'openid-second');
  assert.equal(Object.keys(users).length, 2);

  const bookingSource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/api/lib/booking.js'), 'utf8');
  assert.match(bookingSource, /userId: context\.openid/);
  assert.match(bookingSource, /find\(COLLECTIONS\.orders, where/);
  assert.doesNotMatch(bookingSource, /find\(COLLECTIONS\.users,\s*\{\s*phone/);
  console.log('identity isolation passed: separate WeChat identities keep separate user and order keys; phone is not a merge key');
})().catch(error => { console.error(error); process.exitCode = 1; });
