/* KINETIX offline shell and same-origin runtime asset cache. */
const CACHE_VERSION = 'kinetix-3.0.0';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';
const SHELL_URLS = [
  '/',
  '/creator.html',
  '/manifest.webmanifest',
  '/icons/kinetix.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_URLS);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('kinetix-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

function isCacheableResponse(response) {
  return response && response.ok && (response.type === 'basic' || response.type === 'default');
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const fallback = await cache.match('/');
    if (fallback) return fallback;
    return new Response('KINETIX is offline. Open the app once while connected to prepare the offline version.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirst(request) {
  const runtime = await caches.open(RUNTIME_CACHE);
  const cached = await runtime.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await runtime.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const shell = await caches.match(request);
    if (shell) return shell;
    return new Response('This KINETIX asset has not been cached yet. Reconnect once and try again.', {
      status: 503,
      statusText: 'Asset Not Cached',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  const path = url.pathname;
  const isVersionedBuildAsset = path.startsWith('/assets/');
  const isMotionRuntime = path.startsWith('/mediapipe/wasm/');
  const isPoseModel = path.startsWith('/models/');
  const isLocalIconOrManifest = path.startsWith('/icons/') || path === '/manifest.webmanifest';

  if (isVersionedBuildAsset || isMotionRuntime || isPoseModel || isLocalIconOrManifest) {
    event.respondWith(cacheFirst(request));
  }
});
