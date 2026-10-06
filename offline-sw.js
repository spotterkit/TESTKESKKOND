const CACHE_NAME = 'tehnikatuvastus-offline-v1';
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./images/ad/PPRU1_01.jpg",
  "./images/antitank/kornett_01.jpg",
  "./images/antitank/shturms_01.jpg",
  "./images/artillery_recon/1v15_01.webp",
  "./images/artillery_recon/ark1_01.jpg",
  "./images/comms/R149BMR.jpg",
  "./images/comms/r440odb_01.jpg",
  "./images/comms/r441liven_01.jpg",
  "./images/drones/Molniya2_01.jpg",
  "./images/drones/geran5_01.webp",
  "./images/drones/geran_4.webp",
  "./images/engineer/umz_01.jpeg",
  "./images/engineer/ur83p_01.jpg",
  "./images/ew/borisoglebsk2_01.jpg",
  "./images/ew/rubikon_01.png",
  "./images/ifv/BTR70_01.jpg",
  "./images/ifv/bmp3_01.webp",
  "./images/ifv/btr60_01.jpg",
  "./images/mlrs/tosburatino.jpg",
  "./images/ranks/alampolkovnik_kolonelleitnant.png",
  "./images/ranks/armeekindral.png",
  "./images/ranks/jefreitor_kapral.png",
  "./images/ranks/kapten.png",
  "./images/ranks/kindralleitnant.png",
  "./images/ranks/kindralmajor.png",
  "./images/ranks/kindralpolkovnik.png",
  "./images/ranks/leitnant.png",
  "./images/ranks/major.png",
  "./images/ranks/nooremleitnant.png",
  "./images/ranks/nooremseersant.png",
  "./images/ranks/polkovnik_kolonel.png",
  "./images/ranks/praporstsik.png",
  "./images/ranks/reamees.png",
  "./images/ranks/seersant.png",
  "./images/ranks/vanem.png",
  "./images/ranks/vanem_praporstsik.png",
  "./images/ranks/vanemleitnant.png",
  "./images/ranks/vanemseersant.png",
  "./images/recon_special/taifunvdvk_01.jpg",
  "./images/ships/alexandrit_01.webp",
  "./images/ships/karakurt_01.png",
  "./images/ships/kilo2_01.jpg",
  "./images/ships/vishnya_01.jpg",
  "./images/trucks/desertcross1000-3_01.jpg"
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('tehnikatuvastus-offline-') && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if(cached) return cached;
    try {
      const response = await fetch(event.request);
      if(response && response.ok){
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch(err) {
      if(event.request.mode === 'navigate') return (await caches.match('./index.html')) || (await caches.match('./'));
      throw err;
    }
  })());
});
