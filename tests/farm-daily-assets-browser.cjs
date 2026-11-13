// Real service worker and HTTP request counts. No Firebase or production connections.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),requests=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://local'),name=url.pathname.slice(1);
 requests.push(name);
 if(['farmgame.html','index.html'].includes(name)){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><title>Isolated asset-cache test</title>');return;}
 if(name==='daily-api'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({sequence:requests.filter(n=>n==='daily-api').length}));return;}
 try{
  const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw Error('path');
  const body=fs.readFileSync(file);res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'image/png','Cache-Control':'no-store'});res.end(body);
 }catch{res.writeHead(404);res.end('missing');}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext(),page=await context.newPage(),cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  const count=()=>requests.filter(n=>n.startsWith('assets/farm/daily-missions/v2/')&&n.endsWith('.png')).length;
  const prepare=()=>page.evaluate(async()=>{const m=await import('/js/farm/daily-assets-cache.js');await m.prepareDailyAssets();await navigator.serviceWorker.ready;});
  await page.goto(base+'/farmgame.html');await prepare();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const registration=await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).scope);
  assert.equal(registration,base+'/farmgame.html','scope must not include Nexus homepage/admin');
  const first=count();assert.ok(first>=37);
  await page.reload();await prepare();assert.equal(count(),first,'second game entry serves PNGs without any server requests, even with HTTP cache disabled');
  await page.goto(base+'/index.html');assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller),null);
  await page.goto(base+'/farmgame.html');await prepare();assert.equal(count(),first,'leaving for Nexus and returning also reuses the same persistent PNG cache');
  const api=await page.evaluate(async()=>[await(await fetch('/daily-api')).json(),await(await fetch('/daily-api')).json()]);
  assert.deepEqual(api.map(x=>x.sequence),[1,2],'API/status requests must remain uncached');
  assert.equal(await page.evaluate(async()=>{for(const key of await caches.keys()){for(const request of await(await caches.open(key)).keys())if(request.url.includes('daily-api'))return true;}return false;}),false);
  // A different art revision creates a new cache and retires only our old cache.
  await page.evaluate(async()=>{await(await caches.open('unrelated-nexus-cache')).put('/sentinel',new Response('keep'));await(await navigator.serviceWorker.getRegistration()).unregister();});
  await page.goto(base+'/index.html');assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller),null);
  await page.goto(base+'/farmgame.html?upgrade');
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/farm-daily-sw.js?v=cache-test-v2',{scope:'/farmgame.html'});await navigator.serviceWorker.ready;});
  await page.waitForFunction(async()=>(await caches.keys()).includes('gugu-daily-art-cache-test-v2')&&!(await caches.keys()).includes('gugu-daily-art-20261113-1'));
  assert.ok(count()>first,'a new revision downloads its art instead of retaining the old version');
  assert.equal(await page.evaluate(async()=>await(await caches.open('unrelated-nexus-cache')).match('/sentinel').then(r=>r?.text())),'keep');
  console.log(`PASS: ${first} initial PNG requests, 0 repeat-entry PNG requests with HTTP cache disabled; game-only scope, uncached APIs, art version refresh and unrelated caches preserved.`);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
