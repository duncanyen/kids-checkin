/* Scope is farmgame.html only. Cache public daily PNGs; never cache game/API data. */
const revision=new URL(self.location.href).searchParams.get('v')||'1';
const CACHE_PREFIX='gugu-daily-art-';
const CACHE_NAME=CACHE_PREFIX+revision;
const folder=new URL('assets/farm/daily-missions/v2/',self.location.href);
self.addEventListener('install',event=>{
    event.waitUntil((async()=>{
        const response=await fetch(new URL('manifest.json',folder),{cache:'no-cache'});
        if(!response.ok)throw Error('Daily asset manifest unavailable');
        const manifest=await response.json();
        const files=[...new Set(Object.values(manifest.assets).map(asset=>asset.file))];
        if(!files.length||files.some(file=>!/^[a-z0-9-]+\.png$/.test(file)))throw Error('Invalid daily asset manifest');
        const cache=await caches.open(CACHE_NAME);
        // A new art revision must not accidentally copy old HTTP-cache bytes.
        await cache.addAll(files.map(file=>new Request(new URL(file,folder),{cache:'reload'})));
        // Existing games keep their current art until they leave the game page.
        if(!self.registration.active)await self.skipWaiting();
    })());
});
self.addEventListener('activate',event=>{
    event.waitUntil((async()=>{
        const keys=await caches.keys();
        await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)));
        await self.clients.claim();
    })());
});
self.addEventListener('fetch',event=>{
    const request=event.request,url=new URL(request.url);
    if(request.method!=='GET'||url.origin!==folder.origin||!url.pathname.startsWith(folder.pathname)||!url.pathname.endsWith('.png'))return;
    event.respondWith((async()=>{
        let cache;
        try{cache=await caches.open(CACHE_NAME);const cached=await cache.match(request);if(cached)return cached;}catch{}
        const response=await fetch(request);
        if(cache&&response.ok&&response.type!=='opaque'){try{await cache.put(request,response.clone());}catch{}}
        return response;
    })());
});
