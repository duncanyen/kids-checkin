/* Imported only by the farmgame.html-scoped worker. Static art, never application data. */
const artRevision=new URL(self.location.href).searchParams.get('art');
const appRoot=new URL('./',self.location.href);
const artRoot=new URL('assets/farm/',appRoot);
const manifestURL=new URL('assets/farm/cache-manifest.json',appRoot);manifestURL.searchParams.set('v',artRevision);
const artCache='gugu-farm-public-art-v1',metaPrefix='gugu-farm-art-manifest-',metaCache=metaPrefix+artRevision;
let manifestPromise;const pendingArt=new Map();
function manifest(){
 if(!manifestPromise)manifestPromise=(async()=>{
  let cache,response;try{cache=await caches.open(metaCache);response=await cache.match(manifestURL.href);}catch{}
  if(!response){response=await fetch(manifestURL.href,{cache:'reload'});if(!response.ok)throw Error('Art manifest unavailable');}
  const value=await response.clone().json();
  if(value.version!==1||value.revision!==artRevision||!value.files||Object.entries(value.files).some(([file,digest])=>!/^assets\/farm\/(?!.*(?:^|\/)\.\.\/)[a-zA-Z0-9_./-]+\.(png|webp|jpe?g|gif|svg|json)$/.test(file)||! /^[a-f0-9]{20}$/.test(digest)))throw Error('Invalid public art manifest');
  if(cache)try{await cache.put(manifestURL.href,response.clone());}catch{}
  return value.files;
 })().catch(error=>{manifestPromise=null;throw error;});
 return manifestPromise;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{await manifest();await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const files=await manifest();
 try{
  const cache=await caches.open(artCache);
  for(const request of await cache.keys()){
   const url=new URL(request.url),file=url.pathname.slice(appRoot.pathname.length);
   if(!files[file]||url.searchParams.get('v')!==files[file])await cache.delete(request);
  }
  for(const name of await caches.keys())if(name.startsWith(metaPrefix)&&name!==metaCache)await caches.delete(name);
 }catch{}
 await self.clients.claim();
})()));
async function publicArt(request){
 let files;try{files=await manifest();}catch{return fetch(request);}
 const url=new URL(request.url),file=url.pathname.slice(appRoot.pathname.length),digest=files[file];
 if(!digest)return fetch(request);
 const key=new URL(file,appRoot);key.searchParams.set('v',digest);
 if(!pendingArt.has(key.href)){
  const work=(async()=>{
   let cache;try{cache=await caches.open(artCache);const hit=await cache.match(key.href);if(hit)return hit;}catch{}
   const response=await fetch(new Request(key.href,{credentials:'same-origin',cache:'default'}));
   if(cache&&response.ok&&response.type!=='opaque')try{await cache.put(key.href,response.clone());}catch{}
   return response;
  })();
  pendingArt.set(key.href,work);work.finally(()=>pendingArt.delete(key.href)).catch(()=>{});
 }
 return(await pendingArt.get(key.href)).clone();
}
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==artRoot.origin||!url.pathname.startsWith(artRoot.pathname)||! /\.(png|webp|jpe?g|gif|svg|json)$/i.test(url.pathname)||url.pathname===new URL('cache-manifest.json',artRoot).pathname)return;
 event.respondWith(publicArt(request));
});
