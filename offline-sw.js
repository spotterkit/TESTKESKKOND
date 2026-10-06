const CACHE_NAME = 'tehnikatuvastus-offline-final-v13';


const SW_VERSION = 'v13-sw-version-check';
self.addEventListener('message', event => {
  if(event.data === 'whoami' && event.ports && event.ports[0]){
    event.ports[0].postMessage({SW_VERSION, CACHE_NAME});
  }
});

const CORE_ASSETS = [
  './', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './apple-touch-icon.png', './offline-sw.js', './offline-assets.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // v1 eemaldatakse alles siis, kui v2 on aktiveeritud.
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('tehnikatuvastus-offline-') && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const url = new URL(event.request.url);

    // Commonsi offline-pildid kasutavad ainult sama päritolu virtuaalset URL-i.
    // Seda rada EI TOHI kunagi võrku edasi saata: vastus peab tulema cache'ist.
    if(url.origin === self.location.origin && url.pathname.includes('/__offline_image__/')){
      const offlineCache = await caches.open(CACHE_NAME);
      const offlineImage = await offlineCache.match(event.request, {ignoreVary:true, ignoreSearch:true});
      if(offlineImage) return offlineImage;
      return new Response('', {status: 404, statusText: 'Offline image not cached'});
    }

    const cached = await caches.match(event.request, {ignoreVary:true});
    if(cached) return cached;
    try{
      const response = await fetch(event.request);
      // Sama päritolu ressursid võib jooksvalt cache'ida; Commonsi täispaketti haldab äpi nupp.
      if(response && response.ok && url.origin === self.location.origin){
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    }catch(err){
      if(event.request.mode === 'navigate') return (await caches.match('./index.html')) || (await caches.match('./'));
      throw err;
    }
  })());
});
