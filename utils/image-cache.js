const STORAGE_KEY = 'shiguang.catalog-image-cache.v1';
const MAX_CACHED_FILES = 40;
const MAX_CACHED_BYTES = 12 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PREFETCH_PER_RESPONSE = 12;
const MAX_CONCURRENT_DOWNLOADS = 2;
const IMAGE_FILE_FIELDS = {
  imageUrl: 'imageFileID',
  coverUrl: 'coverFileID',
  avatarUrl: 'avatarFileID'
};
const IMAGE_REMOTE_FIELDS = {
  imageUrl: 'imageRemoteUrl',
  coverUrl: 'coverRemoteUrl',
  avatarUrl: 'avatarRemoteUrl'
};

const queue = [];
const queuedIds = new Set();
const activeIds = new Set();
let activeDownloads = 0;
let pumpTimer = null;
let saveQueue = Promise.resolve();
let savedFilesRequest = null;

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
  if (savedFilesRequest) return savedFilesRequest;
  const request = new Promise((resolve, reject) => {
    api.getSavedFileList({
      success: (result) => resolve(Array.isArray(result.fileList) ? result.fileList : []),
      fail: reject
    });
  }).finally(() => {
    if (savedFilesRequest === request) savedFilesRequest = null;
  });
  savedFilesRequest = request;
  return request;
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

function collectImageEntries(value, entries = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageEntries(item, entries));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(IMAGE_FILE_FIELDS, key) && typeof child === 'string') {
        entries.push({ item: value, key, fileID: value[IMAGE_FILE_FIELDS[key]], url: child });
      } else if (child && typeof child === 'object') {
        collectImageEntries(child, entries);
      }
    }
  }
  return entries;
}

async function recoverTemporaryUrls(api, fileIDs) {
  const urls = new Map();
  if (!api || !api.cloud || typeof api.cloud.getTempFileURL !== 'function') return urls;
  for (let offset = 0; offset < fileIDs.length; offset += 50) {
    const fileList = fileIDs.slice(offset, offset + 50);
    try {
      const result = await new Promise((resolve, reject) => {
        api.cloud.getTempFileURL({ fileList, success: resolve, fail: reject });
      });
      (Array.isArray(result && result.fileList) ? result.fileList : []).forEach((file) => {
        if (file && file.fileID && file.tempFileURL && (!file.status || Number(file.status) === 0)) {
          urls.set(file.fileID, file.tempFileURL);
        }
      });
    } catch (error) {
      // Keep the image placeholder if CloudBase cannot resolve the file now.
    }
  }
  return urls;
}

async function withCachedImagePaths(value) {
  const index = readIndex();
  const api = wxApi();
  const entries = collectImageEntries(value);
  const cachedEntries = entries.filter((entry) => typeof entry.fileID === 'string' && index[entry.fileID] && index[entry.fileID].path);
  let savedPaths = null;
  if (cachedEntries.length && api) {
    try {
      const files = await getSavedFiles(api);
      savedPaths = new Set(files.map((file) => file && file.filePath).filter(Boolean));
    } catch (error) {
      // A local path is used only after it has been confirmed to still exist.
    }
  }

  let staleIndexChanged = false;
  if (savedPaths) {
    for (const entry of cachedEntries) {
      const cached = index[entry.fileID];
      if (cached && cached.path && !savedPaths.has(cached.path)) {
        // Remove stale metadata only. Saved files are left untouched.
        delete index[entry.fileID];
        staleIndexChanged = true;
      }
    }
  }
  if (staleIndexChanged) writeIndex(index);

  const recoverIDs = [...new Set(entries
    .filter((entry) => typeof entry.fileID === 'string' && entry.fileID.startsWith('cloud://'))
    .filter((entry) => {
      const hasRemoteUrl = typeof entry.url === 'string' && /^https:\/\//.test(entry.url);
      const hasRemoteFallback = typeof entry.item[IMAGE_REMOTE_FIELDS[entry.key]] === 'string'
        && /^https:\/\//.test(entry.item[IMAGE_REMOTE_FIELDS[entry.key]]);
      return !hasRemoteUrl && !hasRemoteFallback;
    })
    .map((entry) => entry.fileID))];
  const recoveredUrls = await recoverTemporaryUrls(api, recoverIDs);
  let changed = false;
  let scheduled = 0;
  const usedAt = Date.now();
  const visit = (item) => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    const output = {};
    for (const [key, child] of Object.entries(item)) {
      if (Object.prototype.hasOwnProperty.call(IMAGE_FILE_FIELDS, key) && typeof child === 'string') {
        const fileID = item[IMAGE_FILE_FIELDS[key]];
        const cached = typeof fileID === 'string' && index[fileID];
        const remoteField = IMAGE_REMOTE_FIELDS[key];
        const recoveredUrl = typeof fileID === 'string' ? recoveredUrls.get(fileID) : '';
        const priorRemoteUrl = typeof item[remoteField] === 'string' ? item[remoteField] : '';
        const remoteUrl = /^https:\/\//.test(child) ? child
          : /^https:\/\//.test(recoveredUrl) ? recoveredUrl
            : /^https:\/\//.test(priorRemoteUrl) ? priorRemoteUrl : '';
        const cacheIsValid = !!(cached && cached.path && savedPaths && savedPaths.has(cached.path));
        if (remoteUrl) output[remoteField] = remoteUrl;
        if (cacheIsValid) {
          output[key] = cached.path;
          if (cached.usedAt !== usedAt) { cached.usedAt = usedAt; changed = true; }
        } else {
          output[key] = remoteUrl || (child.startsWith('cloud://') ? '' : child);
          if (typeof fileID === 'string' && fileID.startsWith('cloud://') && remoteUrl && scheduled < MAX_PREFETCH_PER_RESPONSE) {
            enqueue(fileID, remoteUrl);
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
