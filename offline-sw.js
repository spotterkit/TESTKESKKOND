// Service Worker lifecycle release. SW_VERSION on ainult versioonimärk (peab klappima APP_BUILD-iga).
const SW_VERSION = 'offline-rc5';
const APP_CACHE = 'tehnikatuvastus-app-' + SW_VERSION;
// MEDIA nime EI TOHI muuta: olemasolevad Commonsi offline-pildid peavad release'ide vahel säilima.
const MEDIA_CACHE = 'tehnikatuvastus-offline-final-v13';

// Ainult index.html on installi jaoks kriitiline. SW ise ei kuulu precache'i.
const CRITICAL_ASSET = './index.html';
const OPTIONAL_APP_ASSETS = ['./', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const NAV_TIMEOUT_MS = 3500;

// Last-known-good shell:
//  './index.html' ja './'  = viimane TERVEKS märgitud leht (offline fallback kasutab ainult seda).
//  CANDIDATE               = viimane võrgust saadud leht, mida pole veel terveks märgitud.
// Leht saadab käivitumise järel teate {type:'shell-healthy', build}; alles siis tõstetakse
// kandidaat terveks. Vigane versioon ei saa seega offline-koopiat üle kirjutada.
const CANDIDATE = './__candidate__';
const APP_CACHE_PREFIX = 'tehnikatuvastus-app-';

function buildOf(text){
  const m = /APP_BUILD\s*=\s*'([^']+)'/.exec(text || '');
  return m ? m[1] : null;
}
async function buildOfResponse(res){
  try{ return buildOf(await res.clone().text()); }catch(e){ return null; }
}
function isShellPath(url){
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    const indexReq = new Request(CRITICAL_ASSET, {cache:'reload'});
    const indexRes = await fetch(indexReq);
    if(!indexRes.ok) throw new Error('Critical app asset failed: ' + CRITICAL_ASSET);
    await cache.put(CANDIDATE, indexRes.clone());

    // Päri varasemast app-cache'ist viimane terve shell. Kui seda pole (esmane install),
    // on äsja võrgust saadud leht ainus võimalus ja läheb otse terveks.
    let carried = false;
    for(const name of await caches.keys()){
      if(!name.startsWith(APP_CACHE_PREFIX) || name === APP_CACHE) continue;
      const old = await caches.open(name);
      const goodIndex = await old.match('./index.html', {ignoreVary:true});
      if(goodIndex){
        await cache.put('./index.html', goodIndex.clone());
        const goodRoot = await old.match('./', {ignoreVary:true});
        await cache.put('./', (goodRoot || goodIndex).clone());
        carried = true;
        break;
      }
    }
    if(!carried){
      await cache.put('./index.html', indexRes.clone());
      await cache.put('./', indexRes.clone());
    }

    await Promise.allSettled(OPTIONAL_APP_ASSETS.filter(a => a !== './').map(async asset => {
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
      .filter(name => name.startsWith(APP_CACHE_PREFIX) && name !== APP_CACHE)
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

// Tõsta kandidaat terveks, aga ainult siis, kui tervet lehte käitav kood on sama build.
async function promoteCandidate(build){
  const cache = await caches.open(APP_CACHE);
  const cand = await cache.match(CANDIDATE, {ignoreVary:true});
  if(!cand) return;
  const candBuild = await buildOfResponse(cand);
  if(!build || !candBuild || candBuild !== build) return;
  await cache.put('./index.html', cand.clone());
  await cache.put('./', cand.clone());
}

self.addEventListener('message', event => {
  const data = event.data;
  if(data && data.type === 'shell-healthy' && typeof data.build === 'string'){
    event.waitUntil(promoteCandidate(data.build).catch(() => undefined));
  }
});

// Navigatsioon: võrk enne. Kui võrk on aeglane (>NAV_TIMEOUT_MS), serveeri kohe tervet cache'i,
// aga ÄRA katkesta päringut: see lõpetab taustal, salvestab KANDIDAADI ja teatab lehele.
async function navigationNetworkFirst(event){
  const cache = await caches.open(APP_CACHE);
  const goodCopy = await cache.match('./index.html', {ignoreVary:true});
  let servedStale = false;

  const networkPromise = fetch(event.request, {cache:'no-cache'}).then(async response => {
    if(response && response.ok){
      await cache.put(CANDIDATE, response.clone());
      if(!goodCopy){
        // Terveks märgitud koopiat pole üldse: parem midagi kui mitte midagi.
        await Promise.all([
          cache.put('./index.html', response.clone()),
          cache.put('./', response.clone())
        ]);
      }
      if(servedStale && goodCopy){
        const oldBuild = await buildOfResponse(goodCopy);
        const newBuild = await buildOfResponse(response);
        if(newBuild && newBuild !== oldBuild) await notifyClients({type:'shell-updated', build:newBuild, sw:SW_VERSION});
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
    servedStale = !winner; // aeglane võrk: serveeri terve cache, uuendus tuleb taustal
    return await fallback();
  }catch(err){
    return await fallback();
  }
}

async function staleWhileRevalidate(event){
  const url = new URL(event.request.url);
  const appCache = await caches.open(APP_CACHE);
  const mediaCache = await caches.open(MEDIA_CACHE);
  let hitCache = appCache;
  let cached = await appCache.match(event.request, {ignoreVary:true});
  if(!cached){
    cached = await mediaCache.match(event.request, {ignoreVary:true});
    if(cached) hitCache = mediaCache; // värskenda seda cache'i, kus koopia päriselt asub
  }
  const network = fetch(event.request, {cache:'no-cache'}).then(async response => {
    // Shelli (index.html, './') värskendus käib ainult navigatsiooni + shell-healthy kaudu.
    if(response && response.ok && !isShellPath(url)){
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
