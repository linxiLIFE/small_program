const mysql = require('mysql2/promise');
const cloud = require('wx-server-sdk');
const { AsyncLocalStorage } = require('async_hooks');

const TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
let pool;
const requestContext = new AsyncLocalStorage();

function getPool() {
  if (pool) return pool;
  const host = String(process.env.DB_HOST || '').trim();
  const user = String(process.env.DB_USER || '').trim();
  const password = process.env.DB_PASSWORD;
  const missing = [];
  if (!host) missing.push('DB_HOST');
  if (!user) missing.push('DB_USER');
  if (password === undefined || password === '') missing.push('DB_PASSWORD');
  if (missing.length) {
    const error = new Error(`SQL 数据库未配置，请设置 ${missing.join('、')}`);
    error.code = 'SQL_CONFIG_MISSING';
    throw error;
  }
  pool = mysql.createPool({
    host,
    port: Number(process.env.DB_PORT || 3306),
    user,
    password,
    database: process.env.DB_NAME || 'tcb',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 3),
    maxIdle: 1,
    idleTimeout: 30000,
    enableKeepAlive: true,
    queueLimit: 0,
    connectTimeout: 10000,
    charset: 'utf8mb4',
    timezone: '+08:00'
  });
  return pool;
}

function assertTableName(table) {
  const value = String(table || '');
  if (!TABLE_NAME_PATTERN.test(value)) throw new Error(`非法 SQL 表名: ${value}`);
  return value;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isOperator(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.__sqlOperator === 'string';
}

function operator(name, value) {
  return { __sqlOperator: name, value };
}

const command = {
  eq: (value) => operator('eq', value),
  neq: (value) => operator('neq', value),
  gt: (value) => operator('gt', value),
  gte: (value) => operator('gte', value),
  lt: (value) => operator('lt', value),
  lte: (value) => operator('lte', value),
  in: (value) => operator('in', value),
  nin: (value) => operator('nin', value),
  exists: (value) => operator('exists', value),
  and: (...conditions) => operator('and', conditions),
  or: (...conditions) => operator('or', conditions),
  inc: (value) => operator('inc', value),
  set: (value) => operator('set', value),
  remove: () => operator('remove'),
  push: (value) => operator('push', value),
  pull: (value) => operator('pull', value)
};

function getPath(data, path, rowId) {
  if (path === '_id') return data && data._id !== undefined ? data._id : rowId;
  if (path === 'id') return data && data.id !== undefined ? data.id : rowId;
  return String(path).split('.').reduce((current, key) => (
    current === null || current === undefined ? undefined : current[key]
  ), data);
}

function setPath(data, path, value) {
  const keys = String(path).split('.');
  let target = data;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
    target = target[key];
  }
  target[keys[keys.length - 1]] = clone(value);
}

function deletePath(data, path) {
  const keys = String(path).split('.');
  let target = data;
  for (let index = 0; index < keys.length - 1; index += 1) {
    if (!target || typeof target !== 'object') return;
    target = target[keys[index]];
  }
  if (target && typeof target === 'object') delete target[keys[keys.length - 1]];
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch (error) { return false; }
}

function matchesCondition(value, condition, exists) {
  if (!isOperator(condition)) return deepEqual(value, condition);
  const operand = condition.value;
  switch (condition.__sqlOperator) {
    case 'eq': return deepEqual(value, operand);
    case 'neq': return !deepEqual(value, operand);
    case 'gt': return exists && value > operand;
    case 'gte': return exists && value >= operand;
    case 'lt': return exists && value < operand;
    case 'lte': return exists && value <= operand;
    case 'in': return Array.isArray(operand) && operand.some((item) => deepEqual(value, item));
    case 'nin': return Array.isArray(operand) && !operand.some((item) => deepEqual(value, item));
    case 'exists': return Boolean(operand) === exists;
    case 'and': return Array.isArray(operand) && operand.every((item) => matchesCondition(value, item, exists));
    case 'or': return Array.isArray(operand) && operand.some((item) => matchesCondition(value, item, exists));
    default: return false;
  }
}

function matchesWhere(data, rowId, where) {
  return Object.entries(where || {}).every(([field, condition]) => {
    const value = getPath(data, field, rowId);
    return matchesCondition(value, condition, value !== undefined);
  });
}

function applyValue(current, update) {
  if (!isOperator(update)) return clone(update);
  switch (update.__sqlOperator) {
    case 'inc': return Number(current || 0) + Number(update.value || 0);
    case 'set': return clone(update.value);
    case 'push': return [...(Array.isArray(current) ? current : []), ...(
      Array.isArray(update.value) ? clone(update.value) : [clone(update.value)]
    )];
    case 'pull': return (Array.isArray(current) ? current : []).filter((item) => !deepEqual(item, update.value));
    case 'remove': return undefined;
    default: return clone(update.value);
  }
}

function applyUpdate(data, changes) {
  const next = clone(data) || {};
  for (const [path, update] of Object.entries(changes || {})) {
    const value = applyValue(getPath(next, path), update);
    if (value === undefined && isOperator(update) && update.__sqlOperator === 'remove') deletePath(next, path);
    else setPath(next, path, value);
  }
  return next;
}

function parseData(row) {
  if (!row) return null;
  if (row.data && typeof row.data === 'object') return clone(row.data);
  try { return JSON.parse(row.data || '{}'); } catch (error) { return {}; }
}

const GENERATED_FIELDS = {
  users: { inviteCode: 'invite_code' },
  orders: { userId: 'user_id', status: 'status', paymentStatus: 'payment_status', refundStatus: 'refund_status', technicianId: 'technician_id', workId: 'work_id', date: 'booking_date', startAt: 'start_at', paidAt: 'paid_at', completedAt: 'completed_at', paidFen: 'paid_fen' },
  payments: { orderId: 'order_id', merchantOrderNo: 'merchant_order_no', transactionId: 'transaction_id', status: 'status' },
  refunds: { orderId: 'order_id', refundNo: 'refund_no', status: 'status', successAt: 'success_at', amountFen: 'amount_fen' },
  jobs: { type: 'type', status: 'status', nextRunAt: 'next_run_at', leaseUntil: 'lease_until' },
  settings_versions: { version: 'version_num' },
  points_ledger: { userId: 'user_id' },
  idempotency_keys: { expiresAt: 'expires_at' },
  rate_limits: { expiresAt: 'expires_at' }
};

const NUMERIC_JSON_FIELDS = new Set(['sort', 'version', 'createdAt', 'updatedAt', 'startAt', 'endAt', 'completedAt', 'paidAt', 'successAt', 'nextRunAt', 'leaseUntil', 'expiresAt']);

function sqlField(field, table = '') {
  const value = String(field || '');
  if (value === '_id' || value === 'id') return '`id`';
  const generated = GENERATED_FIELDS[table] && GENERATED_FIELDS[table][value];
  if (generated) return `\`${generated}\``;
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)) return '';
  const path = value.split('.').map((part) => `.${part}`).join('');
  const extracted = `JSON_UNQUOTE(JSON_EXTRACT(data, '$${path}'))`;
  return NUMERIC_JSON_FIELDS.has(value) ? `CAST(COALESCE(${extracted}, '0') AS SIGNED)` : extracted;
}

function scalarParameter(value) {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return undefined;
}

function compileFieldCondition(field, condition, params, table) {
  const expression = sqlField(field, table);
  if (!expression) return '';
  if (!isOperator(condition)) {
    if (condition === null) return `${expression} IS NULL`;
    const parameter = scalarParameter(condition);
    if (parameter === undefined) return '';
    params.push(parameter);
    return `${expression} = ?`;
  }
  const name = condition.__sqlOperator;
  if (name === 'and' || name === 'or') {
    if (!Array.isArray(condition.value) || !condition.value.length) return '';
    const parts = condition.value.map((item) => compileFieldCondition(field, item, params, table));
    if (parts.some((item) => !item)) return '';
    return `(${parts.join(name === 'and' ? ' AND ' : ' OR ')})`;
  }
  if (name === 'exists') return condition.value ? `${expression} IS NOT NULL` : `${expression} IS NULL`;
  if (name === 'in' || name === 'nin') {
    if (!Array.isArray(condition.value) || !condition.value.length) return name === 'in' ? '0 = 1' : '1 = 1';
    const values = condition.value.map(scalarParameter);
    if (values.some((item) => item === undefined)) return '';
    params.push(...values);
    return `${expression} ${name === 'nin' ? 'NOT IN' : 'IN'} (${values.map(() => '?').join(', ')})`;
  }
  const operators = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
  if (!operators[name]) return '';
  const parameter = scalarParameter(condition.value);
  if (parameter === undefined) return '';
  params.push(parameter);
  return `${expression} ${operators[name]} ?`;
}

function compileWhere(where = {}, table = '') {
  const params = [];
  const clauses = Object.entries(where).map(([field, condition]) => compileFieldCondition(field, condition, params, table));
  if (clauses.some((item) => !item)) return null;
  return { sql: clauses.length ? clauses.join(' AND ') : '1 = 1', params };
}

function missingDocument(table, id) {
  const error = new Error(`document ${table}/${id} does not exist`);
  error.errCode = -1;
  error.code = 'DOCUMENT_NOT_FOUND';
  return error;
}

class SQLReader {
  constructor(connection = null, inTransaction = false) {
    this.connection = connection;
    this.inTransaction = inTransaction;
  }

  async query(sql, params = []) {
    if (this.connection) return this.connection.query(sql, params);
    try { return await getPool().query(sql, params); }
    catch(error) {
      // Only retry reads. A disconnected write may already have committed.
      if (/^SELECT\b/i.test(sql) && ['ECONNRESET','EPIPE','PROTOCOL_CONNECTION_LOST'].includes(error.code)) return getPool().query(sql, params);
      throw error;
    }
  }

  async rows(table, lock = false) {
    const name = assertTableName(table);
    const suffix = lock && this.inTransaction ? ' FOR UPDATE' : '';
    const [rows] = await this.query(`SELECT id, data, created_at, updated_at FROM \`${name}\`${suffix}`);
    return rows;
  }

  async selectRows(table, where = {}, options = {}, lock = false) {
    const name = assertTableName(table);
    let compiled = compileWhere(where, name);
    if (!compiled) {
      const rows = await this.rows(table, lock);
      rows.sqlOptionsApplied = false;
      return rows;
    }
    const execute = async (useGeneratedColumns) => {
      const current = useGeneratedColumns ? compiled : compileWhere(where);
      const params = [...current.params];
      let sql = `SELECT id, data, created_at, updated_at FROM \`${name}\` WHERE ${current.sql}`;
      if (options.orderBy) {
        const expression = sqlField(options.orderBy.field, useGeneratedColumns ? name : '');
        if (expression) sql += ` ORDER BY ${expression} ${String(options.orderBy.direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC'}`;
      }
      if (options.limit !== null && options.limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(Math.max(0, Number(options.limit)));
        if (options.offset) {
          sql += ' OFFSET ?';
          params.push(Math.max(0, Number(options.offset)));
        }
      }
      if (lock && this.inTransaction) sql += ' FOR UPDATE';
      const [rows] = await this.query(sql, params);
      rows.sqlOptionsApplied = true;
      return rows;
    };
    try { return await execute(true); }
    catch (error) {
      if (error && error.code === 'ER_BAD_FIELD_ERROR' && GENERATED_FIELDS[name]) return execute(false);
      throw error;
    }
  }

  async row(table, id, lock = false) {
    const name = assertTableName(table);
    const lockClause = lock && this.inTransaction ? ' FOR UPDATE' : '';
    const [rows] = await this.query(
      `SELECT id, data, created_at, updated_at FROM \`${name}\` WHERE id = ? LIMIT 1${lockClause}`,
      [String(id)]
    );
    return rows[0] || null;
  }

  collection(table) {
    return new SQLCollection(assertTableName(table), this);
  }

  async insertIfAbsent(table, id, data) {
    const name = assertTableName(table);
    const payload = clone(data) || {};
    const now = Date.now();
    const createdAt = Number(payload.createdAt || now);
    const updatedAt = Number(payload.updatedAt || now);
    const [result] = await this.query(
      `INSERT IGNORE INTO \`${name}\` (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [String(id), JSON.stringify(payload), createdAt, updatedAt]
    );
    return { inserted: Number(result.affectedRows || 0) === 1 };
  }
}

class SQLDocumentReference {
  constructor(table, id, reader) {
    this.table = table;
    this.id = String(id);
    this.reader = reader;
  }

  async get() {
    const row = await this.reader.row(this.table, this.id, this.reader.inTransaction);
    if (!row) throw missingDocument(this.table, this.id);
    return { data: parseData(row), _id: this.id };
  }

  async write(data, existing = null) {
    const payload = clone(data) || {};
    const serialized = JSON.stringify(payload);
    const now = Date.now();
    const createdAt = existing
      ? Number(existing.created_at || payload.createdAt || now)
      : Number(payload.createdAt || now);
    const updatedAt = Number(payload.updatedAt || now);
    await this.reader.query(
      `INSERT INTO \`${this.table}\` (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), created_at = VALUES(created_at), updated_at = VALUES(updated_at)`,
      [this.id, serialized, createdAt, updatedAt]
    );
    return { id: this.id, _id: this.id, stats: { updated: 1 } };
  }

  async set(input) {
    const data = input && input.data !== undefined ? input.data : input;
    const existing = await this.reader.row(this.table, this.id, this.reader.inTransaction);
    return this.write(data, existing);
  }

  async update(input) {
    const row = await this.reader.row(this.table, this.id, this.reader.inTransaction);
    if (!row) throw missingDocument(this.table, this.id);
    const changes = input && input.data !== undefined ? input.data : input;
    return this.write(applyUpdate(parseData(row), changes), row);
  }

  async remove() {
    const [result] = await this.reader.query(`DELETE FROM \`${this.table}\` WHERE id = ?`, [this.id]);
    return { stats: { removed: Number(result.affectedRows || 0) } };
  }
}

class SQLQuery {
  constructor(table, reader, where = {}) {
    this.table = table;
    this.reader = reader;
    this.conditions = where || {};
    this.sort = null;
    this.max = null;
    this.offset = 0;
    this.projection = null;
  }

  orderBy(field, direction = 'desc') {
    this.sort = { field, direction: String(direction).toLowerCase() === 'asc' ? 'asc' : 'desc' };
    return this;
  }

  limit(value) {
    this.max = Math.max(0, Number(value));
    return this;
  }

  skip(value) {
    this.offset = Math.max(0, Number(value));
    return this;
  }

  field(value) {
    this.projection = value || null;
    return this;
  }

  project(data) {
    if (!this.projection) return data;
    const includes = Object.entries(this.projection).filter(([, enabled]) => enabled).map(([key]) => key);
    if (!includes.length) return data;
    const projected = {};
    for (const key of includes) {
      const value = getPath(data, key);
      if (value !== undefined) setPath(projected, key, value);
    }
    return projected;
  }

  async get() {
    const rows = await this.reader.selectRows(this.table, this.conditions, {
      orderBy: this.sort,
      limit: this.max,
      offset: this.offset
    }, this.reader.inTransaction);
    let data = rows
      .map((row) => ({ row, data: parseData(row) }))
      .filter(({ row, data: value }) => matchesWhere(value, row.id, this.conditions));
    if (this.sort) {
      const { field, direction } = this.sort;
      data.sort((left, right) => {
        const a = getPath(left.data, field, left.row.id);
        const b = getPath(right.data, field, right.row.id);
        if (a === b) return 0;
        if (a === undefined) return 1;
        if (b === undefined) return -1;
        const result = a > b ? 1 : -1;
        return direction === 'asc' ? result : -result;
      });
    }
    if (!rows.sqlOptionsApplied) {
      if (this.offset) data = data.slice(this.offset);
      if (this.max !== null) data = data.slice(0, this.max);
    }
    return { data: data.map(({ data: value }) => this.project(value)) };
  }

  async count() {
    const result = await this.get();
    return { total: result.data.length };
  }

  async update(input) {
    if (!this.reader.inTransaction) {
      return runTransaction((transactionReader) => (
        new SQLQuery(this.table, transactionReader, this.conditions)
          .applyOptionsFrom(this)
          .updateInTransaction(input)
      ));
    }
    return this.updateInTransaction(input);
  }

  applyOptionsFrom(source) {
    this.sort = source.sort;
    this.max = source.max;
    this.offset = source.offset;
    return this;
  }

  async updateInTransaction(input) {
    const rows = await this.reader.selectRows(this.table, this.conditions, {
      orderBy: this.sort,
      limit: this.max,
      offset: this.offset
    }, true);
    const changes = input && input.data !== undefined ? input.data : input;
    let updated = 0;
    for (const row of rows) {
      const data = parseData(row);
      if (!matchesWhere(data, row.id, this.conditions)) continue;
      await new SQLDocumentReference(this.table, row.id, this.reader).write(applyUpdate(data, changes), row);
      updated += 1;
    }
    return { stats: { updated } };
  }

  async remove() {
    if (!this.reader.inTransaction) {
      return runTransaction((transactionReader) => (
        new SQLQuery(this.table, transactionReader, this.conditions)
          .applyOptionsFrom(this)
          .remove()
      ));
    }
    const rows = await this.reader.selectRows(this.table, this.conditions, {
      orderBy: this.sort,
      limit: this.max,
      offset: this.offset
    }, true);
    let removed = 0;
    for (const row of rows) {
      if (!matchesWhere(parseData(row), row.id, this.conditions)) continue;
      const [result] = await this.reader.query(`DELETE FROM \`${this.table}\` WHERE id = ?`, [row.id]);
      removed += Number(result.affectedRows || 0);
    }
    return { stats: { removed } };
  }
}

class SQLCollection {
  constructor(table, reader) {
    this.table = table;
    this.reader = reader;
  }

  doc(id) {
    if (id === undefined || id === null || id === '') throw new Error(`缺少 ${this.table} 文档 ID`);
    return new SQLDocumentReference(this.table, id, this.reader);
  }

  where(conditions) {
    return new SQLQuery(this.table, this.reader, conditions || {});
  }

  async add(input) {
    const data = input && input.data !== undefined ? input.data : input;
    const id = (data && (data.id || data._id)) || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return this.doc(id).set({ data });
  }
}

const db = new SQLReader();
db.command = command;

function normalizeContext(context = {}) {
  return {
    openid: context.openid || context.openId || context.OPENID || '',
    appid: context.appid || context.appId || context.APPID || '',
    unionid: context.unionid || context.unionId || context.UNIONID || '',
    uid: context.uid || '',
    customUserId: context.customUserId || ''
  };
}

function withRequestContext(context, callback) {
  return requestContext.run(normalizeContext(context), callback);
}

function getContext() {
  return normalizeContext(requestContext.getStore() || {});
}

async function getOptional(collection, id, reader = db) {
  try {
    const result = await reader.collection(collection).doc(id).get();
    return result.data || null;
  } catch (error) {
    if (error && (error.errCode === -1 || error.code === 'DOCUMENT_NOT_FOUND' || /not exist|不存在|document/i.test(error.message || ''))) return null;
    throw error;
  }
}

async function getRequired(collection, id, reader = db) {
  return getOptional(collection, id, reader);
}

async function find(collection, where, options = {}, reader = db) {
  let query = reader.collection(collection).where(where || {});
  if (options.orderBy) query = query.orderBy(options.orderBy.field, options.orderBy.direction || 'desc');
  if (options.limit !== undefined) query = query.limit(options.limit);
  if (options.skip !== undefined) query = query.skip(options.skip);
  const result = await query.get();
  return result.data || [];
}

async function findAll(collection, where, options = {}, reader = db) {
  const pageSize = Math.min(500, Math.max(1, Number(options.pageSize || 500)));
  const maxRecords = Math.min(50000, Math.max(pageSize, Number(options.maxRecords || 10000)));
  const records = [];
  const requestedOrder = options.orderBy;
  const finish = () => {
    if (!requestedOrder) return records;
    const factor = requestedOrder.direction === 'desc' ? -1 : 1;
    return records.sort((left,right) => {
      const a = getPath(left,requestedOrder.field,left.id||left._id);
      const b = getPath(right,requestedOrder.field,right.id||right._id);
      if (a === b) return String(left.id||left._id||'').localeCompare(String(right.id||right._id||''));
      return (a > b ? 1 : -1) * factor;
    });
  };
  while (records.length < maxRecords) {
    const page = await find(collection, where, { ...options, orderBy:{field:'_id',direction:'asc'}, limit:pageSize, skip:records.length }, reader);
    records.push(...page);
    if (page.length < pageSize) return finish();
  }
  const error = new Error(`${collection} 数据量超过单次安全读取上限`);
  error.code = 'COLLECTION_READ_LIMIT';
  throw error;
}

function cleanId(data, fallback = '') {
  if (!data) return fallback;
  return data.id || data._id || fallback;
}

function isRetryableTransactionError(error) {
  return !!error && (
    Number(error.errno) === 1213
    || Number(error.errno) === 1205
    || error.code === 'ER_LOCK_DEADLOCK'
    || error.code === 'ER_LOCK_WAIT_TIMEOUT'
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runTransaction(callback, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const connection = await getPool().getConnection();
    const transaction = new SQLReader(connection, true);
    try {
      await connection.beginTransaction();
      const result = await callback(transaction);
      await connection.commit();
      return result;
    } catch (error) {
      lastError = error;
      try { await connection.rollback(); } catch (rollbackError) { console.error('SQL transaction rollback failed', rollbackError.code || rollbackError.message); }
      if (!isRetryableTransactionError(error) || attempt >= maxAttempts) throw error;
    } finally {
      connection.release();
    }
    await wait(20 * attempt + Math.floor(Math.random() * 30));
  }
  throw lastError;
}

db.runTransaction = runTransaction;

module.exports = { cloud, db, command, getContext, withRequestContext, getOptional, getRequired, find, findAll, cleanId, isRetryableTransactionError, compileWhere };
