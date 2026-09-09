const fs = require('fs');
const path = require('path');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const apiFile = fs.existsSync(path.join(__dirname, 'api.js')) ? './api' : '../api';
const api = require(apiFile);

function parseBody(event) {
  if (!event || !event.body) return event || {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try { return JSON.parse(raw); } catch (error) { return {}; }
}

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.ADMIN_CORS_ORIGIN || 'null', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: JSON.stringify(body) };
}

exports.main = async (event = {}) => {
  if (event.httpMethod === 'OPTIONS') return response(204, {});
  const result = await api.main(parseBody(event));
  return response(200, result);
};
