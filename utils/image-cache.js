const STORAGE_KEY = 'shiguang.catalog-image-cache.v1';
const MAX_CACHED_FILES = 40;
const MAX_CACHED_BYTES = 12 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PREFETCH_PER_RESPONSE = 12;
const MAX_CONCURRENT_DOWNLOADS = 2;

const queue = [];
const queuedIds = new Set();
const activeIds = new Set();
let activeDownloads = 0;
let pumpTimer = null;
let saveQueue = Promise.resolve();

function wxApi() {
  return typeof wx === 'undefined' ? null : wx;
}

function readIndex() {
  const api = wxApi();
  if (!api || typeof api.getStorageSync !== 'function') return {};
  try {
    const value = api.getStorageSync(STORAGE_KEY);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    return {};
  }
}

function writeIndex(index) {
  const api = wxApi();
  if (!api || typeof api.setStorageSync !== 'function') return;
  try { api.setStorageSync(STORAGE_KEY, index); } catch (error) { /* The remote URL remains available if local storage is full. */ }
}

function getSavedFiles(api) {
  if (typeof api.getSavedFileList !== 'function') return Promise.reject(new Error('本地文件清单不可用'));
  return new Promise((resolve, reject) => {
    api.getSavedFileList({
      success: (result) => resolve(Array.isArray(result.fileList) ? result.fileList : []),
      fail: reject
    });
  });
}

function getFileInfo(api, filePath) {
  if (typeof api.getFileInfo !== 'function') return Promise.reject(new Error('本地文件信息不可用'));
  return new Promise((resolve, reject) => {
    api.getFileInfo({ filePath, success: resolve, fail: reject });
  });
}

function download(api, fileID) {
  return new Promise((resolve, reject) => {
    if (!api.cloud || typeof api.cloud.downloadFile !== 'function') return reject(new Error('CloudBase 文件下载不可用'));
    api.cloud.downloadFile({ fileID, success: resolve, fail: reject });
  });
}

function save(api, tempFilePath) {
  return new Promise((resolve, reject) => {
    if (typeof api.saveFile !== 'function') return reject(new Error('本地文件缓存不可用'));
    api.saveFile({ tempFilePath, success: resolve, fail: reject });
  });
}

function saveWithinQuota(api, fileID, tempFilePath, size) {
  const operation = saveQueue.then(async () => {
    const index = readIndex();
    if (index[fileID] && index[fileID].path) return;

    const savedFiles = await getSavedFiles(api);
    const indexedPaths = new Set(Object.values(index).map((entry) => entry && entry.path).filter(Boolean));
    const untrackedFiles = savedFiles.filter((file) => !indexedPaths.has(file.filePath));
    const cachedBytes = Object.values(index).reduce((sum, entry) => sum + Number(entry && entry.size || 0), 0)
      + untrackedFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const cachedCount = Object.keys(index).length + untrackedFiles.length;
    if (cachedCount >= MAX_CACHED_FILES || cachedBytes + size > MAX_CACHED_BYTES) return;

    const saved = await save(api, tempFilePath);
    if (!saved || !saved.savedFilePath) return;
    const next = readIndex();
    next[fileID] = { path: saved.savedFilePath, size, usedAt: Date.now() };
    writeIndex(next);
  });
  saveQueue = operation.catch(() => {});
  return operation;
}

async function cacheImage(fileID, imageUrl) {
  const api = wxApi();
  if (!api || !fileID || !imageUrl || activeIds.has(fileID)) return;
  const index = readIndex();
  if (index[fileID] && index[fileID].path) return;
  activeIds.add(fileID);
  try {
    const result = await download(api, fileID);
    if (!result || !result.tempFilePath) return;
    const info = await getFileInfo(api, result.tempFilePath);
    const size = Number(info.size || 0);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) return;
    await saveWithinQuota(api, fileID, result.tempFilePath, size);
  } catch (error) {
    // A cache miss must never prevent the regular network image from loading.
  } finally {
    activeIds.delete(fileID);
  }
}

function pumpQueue() {
  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && queue.length) {
    const item = queue.shift();
    queuedIds.delete(item.fileID);
    activeDownloads += 1;
    cacheImage(item.fileID, item.imageUrl).finally(() => {
      activeDownloads -= 1;
      pumpQueue();
    });
  }
}

function enqueue(fileID, imageUrl) {
  if (!fileID || !imageUrl || queuedIds.has(fileID) || activeIds.has(fileID)) return;
  const index = readIndex();
  if (index[fileID] && index[fileID].path) return;
  queuedIds.add(fileID);
  queue.push({ fileID, imageUrl });
  if (pumpTimer === null) {
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pumpQueue();
    }, 800);
  }
}

function withCachedImagePaths(value) {
  const index = readIndex();
  let changed = false;
  let scheduled = 0;
  const usedAt = Date.now();
  const visit = (item) => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    const output = {};
    for (const [key, child] of Object.entries(item)) {
      if (['imageUrl', 'coverUrl', 'avatarUrl'].includes(key) && typeof child === 'string') {
        const fileID = item[key.replace('Url', 'FileID')];
        const cached = typeof fileID === 'string' && index[fileID];
        if (cached && cached.path) {
          output[key] = cached.path;
          if (cached.usedAt !== usedAt) { cached.usedAt = usedAt; changed = true; }
        } else {
          output[key] = child;
          if (typeof fileID === 'string' && fileID.startsWith('cloud://') && child.startsWith('https://') && scheduled < MAX_PREFETCH_PER_RESPONSE) {
            enqueue(fileID, child);
            scheduled += 1;
          }
        }
      } else {
        output[key] = typeof child === 'object' ? visit(child) : child;
      }
    }
    return output;
  };
  const result = visit(value);
  if (changed) writeIndex(index);
  return result;
}

module.exports = { withCachedImagePaths };
