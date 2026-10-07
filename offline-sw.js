// Service Worker lifecycle release. SW_VERSION is only a version marker.
const SW_VERSION = 'offline-rc4';
const APP_CACHE = 'tehnikatuvastus-app-' + SW_VERSION;
// MEDIA nime EI TOHI muuta: olemasolevad Commonsi offline-pildid peavad release'ide vahel säilima.
const MEDIA_CACHE = 'tehnikatuvastus-offline-final-v13';

// Ainult index.html on installi jaoks kriitiline. SW ise ei kuulu precache'i.
const CRITICAL_ASSET = './index.html';
const OPTIONAL_APP_ASSETS = ['./', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const NAV_TIMEOUT_MS = 3500;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    const indexReq = new Request(CRITICAL_ASSET, {cache:'reload'});
    const indexRes = await fetch(indexReq);
    if(!indexRes.ok) throw new Error('Critical app asset failed: ' + CRITICAL_ASSET);
    await cache.put(CRITICAL_ASSET, indexRes.clone());

    await Promise.allSettled(OPTIONAL_APP_ASSETS.map(async asset => {
      const req = new Request(asset, {cache:'reload'});
      const res = await fetch(req);
      if(!res.ok) throw new Error('Optional app asset failed: ' + asset);
      await cache.put(req, res.clone());
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('tehnikatuvastus-app-') && name !== APP_CACHE)
      .map(name => caches.delete(name)));
    // MEDIA_CACHE'i ei kustutata siin kunagi.
    await self.clients.claim();
  })());
});

async function notifyClients(message){
  try{
    const list = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    list.forEach(c => c.postMessage(message));
  }catch(e){}
}

// Navigatsioon: võrk enne. Kui võrk on aeglane (>NAV_TIMEOUT_MS), serveeri kohe cache'i,
// aga ÄRA katkesta päringut: see lõpetab taustal, uuendab cache'i ja teatab lehele.
async function navigationNetworkFirst(event){
  const cache = await caches.open(APP_CACHE);
  const staleCopy = await cache.match('./index.html', {ignoreVary:true});
  let servedStale = false;

  const networkPromise = fetch(event.request, {cache:'no-cache'}).then(async response => {
    if(response && response.ok){
      await Promise.all([
        cache.put('./index.html', response.clone()),
        cache.put('./', response.clone())
      ]);
      if(servedStale){
        const oldTag = staleCopy && (staleCopy.headers.get('etag') || staleCopy.headers.get('last-modified'));
        const newTag = response.headers.get('etag') || response.headers.get('last-modified');
        if(!oldTag || !newTag || oldTag !== newTag) await notifyClients({type:'shell-updated', sw:SW_VERSION});
      }
    }
    return response;
  });
  event.waitUntil(networkPromise.catch(() => undefined));

  const fallback = async () =>
    (await cache.match('./index.html', {ignoreVary:true})) ||
    (await cache.match('./', {ignoreVary:true})) ||
    new Response('Offline app shell not cached', {status:503});

  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  try{
    const winner = await Promise.race([networkPromise, timeout]);
    if(winner && winner.status < 500) return winner;
    servedStale = !winner; // aeglane võrk: serveeri cache, uuendus tuleb taustal
    return await fallback();
  }catch(err){
    return await fallback();
  }
}

async function staleWhileRevalidate(event){
  const appCache = await caches.open(APP_CACHE);
  const mediaCache = await caches.open(MEDIA_CACHE);
  let hitCache = appCache;
  let cached = await appCache.match(event.request, {ignoreVary:true});
  if(!cached){
    cached = await mediaCache.match(event.request, {ignoreVary:true});
    if(cached) hitCache = mediaCache; // värskenda seda cache'i, kus koopia päriselt asub
  }
  const network = fetch(event.request, {cache:'no-cache'}).then(async response => {
    if(response && response.ok){
      await hitCache.put(event.request, response.clone());
    }
    return response;
  });
  if(cached){
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  try{ return await network; }
  catch(err){ return new Response('', {status:503}); }
}

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if(url.origin === self.location.origin && url.pathname.includes('/__offline_image__/')){
    event.respondWith((async () => {
      const mediaCache = await caches.open(MEDIA_CACHE);
      const image = await mediaCache.match(event.request, {ignoreVary:true, ignoreSearch:true});
      return image || new Response('', {status:404, statusText:'Offline image not cached'});
    })());
    return;
  }

  if(event.request.mode === 'navigate'){
    event.respondWith(navigationNetworkFirst(event));
    return;
  }

  // Installer ja värskendus küsivad faile cache:'reload' / 'no-store' režiimis: need peavad
  // minema päriselt võrku, mitte saama SW kaudu vana cache'itud koopiat tagasi.
  if(event.request.cache === 'reload' || event.request.cache === 'no-store') return;

  if(url.origin === self.location.origin){
    event.respondWith(staleWhileRevalidate(event));
  }
});
