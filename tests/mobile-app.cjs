// APP_BASE_URL=http://127.0.0.1:8012 node tests/mobile-app.cjs
// Tests configuration and navigation. Installed iOS chrome requires device verification.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=process.env.APP_BASE_URL||'http://127.0.0.1:8012';
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
 // Avoid all Firebase and game initialization while checking actual HTML metadata.
 let enableNavigation=false;
 await context.route('**/*.html',async route=>{
  const response=await route.fetch();let html=(await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  if(enableNavigation&&new URL(route.request().url()).pathname.endsWith('/index.html'))html=html.replace('</body>','<script type="module">import "./js/auth.js";document.getElementById("dashboardView").style.display="block";window.__navigationReady=true;</script></body>');
  await route.fulfill({response,body:html});
 });
 await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:'export const collection=()=>({}),query=()=>({}),where=()=>({}),getDocs=()=>{},addDoc=()=>{},serverTimestamp=()=>0;'}));
 await context.route('https://cdn.jsdelivr.net/**',r=>r.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.addInitScript(()=>{
  if(!sessionStorage.getItem('familyCheckInUser'))sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'test',name:'測試使用者'}));if(!localStorage.getItem('lastGroupId'))localStorage.setItem('lastGroupId','group-A');
  window.open=()=>{throw Error('Internal navigation must not open another window');};
 });
 const files=fs.readdirSync(root).filter(name=>name.endsWith('.html'));
 for(const name of files){
  await page.goto(base+'/'+name,{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-capable"]').count(),1,name);
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content'),'yes',name);
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content'),'Nexus',name);
  assert.equal(await page.locator('meta[name="mobile-web-app-capable"]').getAttribute('content'),'yes',name);
  assert.equal(await page.locator('link[rel="manifest"]').count(),1,name);
  assert.equal(await page.locator('link[rel="manifest"]').evaluate(el=>el.href),base+'/manifest.webmanifest',name);
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').evaluate(el=>el.href),base+'/Nexus.png',name);
 }
 const response=await context.request.get(base+'/manifest.webmanifest');assert.ok(response.ok());const manifest=await response.json();assert.equal(manifest.display,'standalone');
 for(const deployment of [base+'/',base+'/kids-checkin/']){
  const manifestUrl=new URL('manifest.webmanifest',deployment);
  assert.equal(new URL(manifest.start_url,manifestUrl).href,deployment+'index.html');
  assert.equal(new URL(manifest.scope,manifestUrl).href,deployment);
  for(const name of files)assert.ok(new URL(name,deployment).href.startsWith(new URL(manifest.scope,manifestUrl).href));
 }
 // Actual navTo and return button use the same page, preserving group/session state.
 enableNavigation=true;await page.goto(base+'/index.html');await page.waitForFunction(()=>window.__navigationReady);
 await page.locator('.current-user-badge').click();await page.waitForURL('**/settings.html');
 assert.equal(context.pages().length,1);assert.equal(await page.evaluate(()=>localStorage.getItem('lastGroupId')),'group-A');
 await page.locator('.btn-back').click();await page.waitForURL('**/index.html');await page.waitForFunction(()=>window.__navigationReady);
 await page.evaluate(()=>navTo('chat.html','聊天室'));await page.waitForURL('**/chat.html');assert.equal(context.pages().length,1);
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('familyCheckInUser')).accountId),'test');
 const logs=await page.evaluate(()=>JSON.parse(localStorage.getItem('nexus_pending_logs')));assert.equal(logs.length,2);assert.ok(logs.every(log=>log.groupId==='group-A'));
 assert.deepEqual(errors,[]);
 console.log(`PASS: ${files.length} pages have consistent iPhone standalone metadata; manifest covers root/subdirectory deployment; same-window card navigation/return preserves session, group and logs`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
