const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

(async () => {
  const directory = path.resolve(process.argv[2] || 'admin/dist');
  const source = fs.readFileSync(path.join(directory, 'asset-worker.js'), 'utf8');
  const handlers = new Map();
  const entries = new Map();
  let downloads = 0;
  let claimed = false;
  const key = value => typeof value === 'string' ? new URL(value, 'https://admin.example').href : value.url;
  const cache = {
    match: async value => entries.get(key(value))?.clone(),
    put: async (value, response) => { entries.set(key(value), response.clone()); }
  };
  vm.runInNewContext(source, {
    self: {
      location: { origin: 'https://admin.example' },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => {},
      clients: { claim: async () => { claimed = true; }, get: async () => ({postMessage: () => {}}) }
    },
    caches: { open: async () => cache },
    URL, Set,
    fetch: async () => { downloads++; return new Response('script', { status: 200 }); }
  });
  let completion;
  handlers.get('install')({ waitUntil: promise => { completion = promise; } });
  await completion;
  const initialDownloads = downloads;
  assert(initialDownloads > 0);
  handlers.get('activate')({ waitUntil: promise => { completion = promise; } });
  await completion;
  assert(claimed);
  async function request(url, method = 'GET') {
    let result;
    const pending = [];
    handlers.get('fetch')({
      request: new Request(new URL(url, 'https://admin.example'), { method }),
      respondWith: promise => { result = promise; },
      waitUntil: promise => pending.push(promise)
    });
    const response = result ? await result : undefined;
    await Promise.all(pending);
    return response;
  }
  const asset = [...entries.keys()][0];
  assert.equal((await request(asset)).status, 200);
  assert.equal(downloads, initialDownloads);
  for (const url of ['/store-admin/index.html', '/api', '/store-admin/asset-worker.js', '/store-admin/assets/not-in-build.js', `${asset}?version=other`, 'https://other.example/file.js']) {
    assert.equal(await request(url), undefined, `must not intercept ${url}`);
  }
  assert.equal(await request(asset, 'POST'), undefined);
  const paths = source.match(/const ASSETS = new Set\((.*)\);/)[1];
  const lazyAsset = JSON.parse(paths).find(value => !entries.has(key(value)));
  assert(lazyAsset, 'build must contain lazy-loaded pages');
  await request(lazyAsset);
  await request(lazyAsset);
  assert.equal(downloads, initialDownloads + 1);
  console.log('admin asset cache passed: immutable build assets reused, lazy chunks cached, HTML/API/cross-origin/POST excluded');
})().catch(error => { console.error(error); process.exitCode = 1; });
