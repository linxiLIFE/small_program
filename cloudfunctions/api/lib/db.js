const mysql = require('mysql2/promise');
const cloud = require('wx-server-sdk');
const { AsyncLocalStorage } = require('async_hooks');

const TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
let pool;
const requestContext = new AsyncLocalStorage();

function getPool() {
  if (pool) return pool;
  const host = String(process.env.DB_HOST || '').trim();
  const password = process.env.DB_PASSWORD;
  const missing = [];
  if (!host) missing.push('DB_HOST');
  if (password === undefined || password === '') missing.push('DB_PASSWORD');
  if (missing.length) {
    const error = new Error(`SQL 数据库未配置，请设置 ${missing.join('、')}`);
    error.code = 'SQL_CONFIG_MISSING';
    throw error;
  }
  pool = mysql.createPool({
    host,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
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
    const rows = await this.reader.rows(this.table, this.reader.inTransaction);
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
    if (this.offset) data = data.slice(this.offset);
    if (this.max !== null) data = data.slice(0, this.max);
    return { data: data.map(({ data: value }) => this.project(value)) };
  }

  async count() {
    const result = await this.get();
    return { total: result.data.length };
  }

  async update(input) {
    if (!this.reader.inTransaction) {
      const connection = await getPool().getConnection();
      const transactionReader = new SQLReader(connection, true);
      try {
        await connection.beginTransaction();
        const result = await new SQLQuery(this.table, transactionReader, this.conditions)
          .applyOptionsFrom(this)
          .updateInTransaction(input);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
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
    const rows = await this.reader.rows(this.table, true);
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
      const connection = await getPool().getConnection();
      const transactionReader = new SQLReader(connection, true);
      try {
        await connection.beginTransaction();
        const result = await new SQLQuery(this.table, transactionReader, this.conditions).remove();
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    const rows = await this.reader.rows(this.table, true);
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

function cleanId(data, fallback = '') {
  if (!data) return fallback;
  return data.id || data._id || fallback;
}

async function runTransaction(callback) {
  const connection = await getPool().getConnection();
  const transaction = new SQLReader(connection, true);
  try {
    await connection.beginTransaction();
    const result = await callback(transaction);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

db.runTransaction = runTransaction;

module.exports = { cloud, db, command, getContext, withRequestContext, getOptional, getRequired, find, cleanId };
