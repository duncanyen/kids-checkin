// Real worker + HTTP counters with the browser HTTP cache explicitly disabled.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),original=JSON.parse(fs.readFileSync(root+'/assets/farm/cache-manifest.json')),requests=[];let manifest=structuredClone(original),coinOverride;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://local'),file=url.pathname.slice(1);requests.push(file);
 if(['farmgame.html','index.html'].includes(file)){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><title>Public farm-art cache verification</title>');return;}
 if(file==='game-api'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({sequence:requests.filter(x=>x==='game-api').length}));return;}
 let body;try{body=file==='assets/farm/cache-manifest.json'?Buffer.from(JSON.stringify(manifest)):file==='assets/farm/coin.png'&&coinOverride?coinOverride:fs.readFileSync(path.resolve(root,file));}catch{res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'image/png','Cache-Control':'no-store'});res.end(body);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const context=await browser.newContext(),page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await page.goto(base+'/farmgame.html');await page.evaluate(async()=>{const m=await import('/js/farm/public-art-cache.js');const ready=await m.prepareFarmArtCache();if(!ready)throw Error('worker not ready');});
  const assets=['assets/farm/farm-map.jpg','assets/farm/hen-sheet.png','assets/farm/hen-sheet.json','assets/farm/coin.png','assets/farm/daily-missions/v2/hen.png'];
  const load=()=>page.evaluate(async assets=>Promise.all(assets.map(async file=>{const response=await fetch('/'+file);if(!response.ok)throw Error(file);return(await response.arrayBuffer()).byteLength;})),assets);
  const count=()=>requests.filter(file=>assets.includes(file)).length;
  await load();const initial=count();assert.equal(initial,5);const before=Date.now();
  await page.reload();await load();assert.equal(count(),initial);
  await page.goto(base+'/index.html');assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller),null);await page.goto(base+'/farmgame.html');await load();assert.equal(count(),initial);
  const replies=await page.evaluate(async()=>Promise.all([fetch('/game-api').then(r=>r.json()),fetch('/game-api').then(r=>r.json())]));assert.deepEqual(replies.map(r=>r.sequence),[1,2]);
  await page.evaluate(async()=>{await(await caches.open('nexus-unrelated')).put('/sentinel',new Response('keep'));});
  coinOverride=fs.readFileSync(root+'/assets/farm/egg.png');manifest.files['assets/farm/coin.png']=crypto.createHash('sha256').update(coinOverride).digest('hex').slice(0,20);manifest.revision=crypto.createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex').slice(0,20);
  await page.evaluate(async revision=>{await navigator.serviceWorker.register('/farm-daily-sw.js?v='+revision+'&art='+revision,{scope:'/farmgame.html',updateViaCache:'none'});},manifest.revision);
  await page.waitForFunction(revision=>navigator.serviceWorker.controller?.scriptURL.includes('art='+revision),manifest.revision);await load();assert.equal(count(),initial+1,'one changed file downloads; unchanged files stay cached');
  assert.equal(await page.evaluate(async()=>await(await caches.open('nexus-unrelated')).match('/sentinel').then(r=>r.text())),'keep');
  console.log(JSON.stringify({test:'public-art-persistent-cache',coldAssetDownloads:initial,repeatEntryDownloads:0,leaveAndReturnDownloads:0,oneFileUpdateDownloads:1,httpCache:'disabled',apiResponses:[1,2],repeatEntryAndReturnMs:Date.now()-before}));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
