import type { Plugin } from 'vite';

// The default CloudBase gateway disables HTTP caching. Cache immutable build
// assets locally without storing HTML, authentication or business responses.
export function assetCache(): Plugin {
  return {
    name: 'admin-asset-cache',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle)
        .filter(item => /\.(js|css)$/.test(item.fileName))
        .map(item => `/store-admin/${item.fileName}`);
      const initial = Object.values(bundle)
        .filter(item => (item.type === 'chunk' && item.isEntry) || item.fileName.endsWith('.css'))
        .map(item => `/store-admin/${item.fileName}`);
      const worker = `
const CACHE = 'store-admin-static-v1';
const ASSETS = new Set(${JSON.stringify(assets)});
const INITIAL = ${JSON.stringify(initial)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await Promise.all(INITIAL.map(async url => {
      if (await cache.match(url)) return;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Static asset unavailable');
      await cache.put(url, response);
    }));
    await self.skipWaiting();
  }));
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !ASSETS.has(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) {
      if (event.clientId) {
        event.waitUntil(self.clients.get(event.clientId).then(client => {
          if (client) client.postMessage({ type: 'admin-static-cache-hit', path: url.pathname });
        }).catch(() => {}));
      }
      return cached;
    }
    const response = await fetch(event.request);
    if (response.ok) {
      event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
    }
    return response;
  }));
});
`;
      this.emitFile({ type: 'asset', fileName: 'asset-worker.js', source: worker });
    }
  };
}
