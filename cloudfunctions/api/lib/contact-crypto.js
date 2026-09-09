const crypto = require('crypto');
const { AppError } = require('./errors');

function getKey() {
  const raw = process.env.CONTACT_ENCRYPTION_KEY || '';
  if (!raw) throw new AppError('CONTACT_ENCRYPTION_NOT_CONFIGURED', '服务端尚未配置联系方式加密密钥', 503);
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new AppError('CONTACT_ENCRYPTION_INVALID', '服务端联系方式加密密钥长度不正确', 503);
  return key;
}

function encryptPhone(phone) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(phone), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptPhone(payload) {
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new AppError('CONTACT_CIPHER_INVALID', '联系方式密文格式不正确');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
}

function maskPhone(phone) {
  const value = String(phone || '');
  return value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : '';
}

module.exports = { encryptPhone, decryptPhone, maskPhone };
