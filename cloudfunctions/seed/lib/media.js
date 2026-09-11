const crypto = require('crypto');
const { cloud } = require('./db');
const { requireRole } = require('./auth');
const { assert } = require('./errors');
const imageCache=new Map();

function decodeImage(payload = {}) {
  const encoded = String(payload.base64 || '');
  assert(encoded.length > 0 && encoded.length <= 2800000 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'INVALID_IMAGE', '图片内容无效或超过 2 MB');
  const buffer = Buffer.from(encoded, 'base64');
  assert(buffer.length <= 2 * 1024 * 1024, 'INVALID_IMAGE', '图片超过 2 MB');
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  assert(jpeg || png || webp, 'INVALID_IMAGE', '请上传照片或 PNG、JPG、WebP 图片');
  return { buffer, extension: jpeg ? 'jpg' : png ? 'png' : 'webp' };
}
async function uploadImage(payload) {
  await requireRole(['OWNER']);
  const { buffer, extension } = decodeImage(payload);
  const result = await cloud.uploadFile({ cloudPath: `catalog/${crypto.randomUUID()}.${extension}`, fileContent: buffer });
  assert(result.fileID, 'UPLOAD_FAILED', '图片上传失败');
  const resolved = await resolveImages({ imageUrl: result.fileID });
  return { fileID: result.fileID, url: resolved.imageUrl };
}
async function resolveImages(value) {
  const refs = new Set();
  const visit = item => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== 'object') return;
    Object.entries(item).forEach(([key, val]) => {
      if (['imageUrl','coverUrl','avatarUrl'].includes(key) && typeof val === 'string' && val.startsWith('cloud://')) refs.add(val);
      else if (typeof val === 'object') visit(val);
    });
  };
  visit(value);
  if (!refs.size) return value;
  const urls = new Map();
  const ids = [...refs].filter(id=>{const cached=imageCache.get(id);if(cached&&cached.expires>Date.now()){urls.set(id,cached.url);return false;}return true;});
  for (let index = 0; index < ids.length; index += 50) {
    try {
      const result = await cloud.getTempFileURL({ fileList: ids.slice(index, index + 50) });
      (result.fileList || []).forEach(item => { if (item.tempFileURL && (!item.status || item.status===0)) { urls.set(item.fileID, item.tempFileURL);imageCache.set(item.fileID,{url:item.tempFileURL,expires:Date.now()+600000}); } });
    } catch(error) { console.warn('media resolution failed', {code:error.code || error.errCode}); }
  }
  if(imageCache.size>500)for(const id of Array.from(imageCache.keys()).slice(0,imageCache.size-500))imageCache.delete(id);
  const transform = item => {
    if (Array.isArray(item)) return item.map(transform);
    if (!item || typeof item !== 'object') return item;
    const out = {};
    Object.entries(item).forEach(([key, val]) => {
      if (['imageUrl','coverUrl','avatarUrl'].includes(key) && typeof val === 'string' && val.startsWith('cloud://')) {
        out[key.replace('Url','FileID')] = val; out[key] = urls.get(val) || '';
      } else out[key] = typeof val === 'object' ? transform(val) : val;
    });
    return out;
  };
  return transform(value);
}
module.exports = { decodeImage, uploadImage, resolveImages };
