// Actual admin runtime; Google SDK transport is isolated and no live tokens are used.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../../');
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(['/game-admin/site/runtime.js','/game-admin/site/config.js'].includes(pathname)){
   res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(root,pathname)));return;
  }
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<script type="module">import * as runtime from "/game-admin/site/runtime.js";window.__runtime=runtime;</script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('https://www.gstatic.com/**',route=>{
   const file=new URL(route.request().url()).pathname.split('/').at(-1);
   let body;
   if(file==='firebase-app.js')body='export const initializeApp=config=>({config});';
   else if(file==='firebase-functions.js')body=`export const getFunctions=()=>({}),connectFunctionsEmulator=()=>{};export const httpsCallable=()=>async payload=>{window.__calls=(window.__calls||0)+1;window.__payload=payload;return{data:{ok:true}};};`;
   else if(file==='firebase-app-check.js')body=`export class ReCaptchaEnterpriseProvider{constructor(key){this.key=key;}}export const initializeAppCheck=(_app,options)=>{window.__provider=options.provider.key;return{};};export const getToken=async(_app,force)=>{window.__checks=(window.__checks||0)+1;if(force)throw Error('Unexpected forced refresh');if(window.__failure)throw Object.assign(Error('isolated failure'),{code:window.__failure});return{token:'isolated-test-token'};};`;
   else body=`export const getAuth=()=>({}),browserSessionPersistence={},${['setPersistence','onAuthStateChanged','signInWithEmailAndPassword','signOut','getIdTokenResult','getMultiFactorResolver','multiFactor','connectAuthEmulator'].map(name=>name+'=()=>{}').join(',')};export const TotpMultiFactorGenerator={};`;
   return route.fulfill({contentType:'text/javascript',body});
  });
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);await page.waitForFunction(()=>window.__runtime);
  assert.equal(await page.evaluate(()=>window.__provider),undefined,'optional mode never initializes reCAPTCHA');
  await page.evaluate(()=>{window.__failure='appCheck/fetch-status-error';});
  assert.deepEqual(await page.evaluate(()=>__runtime.api('dashboard')),{ok:true});
  assert.equal(await page.evaluate(()=>window.__checks||0),0);
  await context.route('**/game-admin/site/config.js*',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'game-admin/site/config.js'),'utf8').replace('adminAppCheckRequired:false','adminAppCheckRequired:true')}));
  await page.reload();await page.waitForFunction(()=>window.__runtime);
  assert.ok(await page.evaluate(()=>typeof window.__provider==='string'&&window.__provider.length>0));
  for(const code of ['appCheck/fetch-status-error','appCheck/initial-throttle','appCheck/throttled']){
   const result=await page.evaluate(async code=>{window.__failure=code;try{await __runtime.api('saveAnnouncement',{},'same-write-id');return{};}catch(error){return{code:error.code,message:error.message,calls:window.__calls||0};}},code);
   assert.equal(result.code,'ops/app-check-failed');assert.match(result.message,/網站驗證（App Check）未通過/);assert.equal(result.calls,0);
  }
  await page.evaluate(()=>window.__failure=null);
  assert.deepEqual(await page.evaluate(()=>__runtime.api('saveAnnouncement',{title:'測試'},'same-write-id')),{ok:true});
  assert.deepEqual(await page.evaluate(()=>window.__payload),{action:'saveAnnouncement',payload:{title:'測試'},requestId:'same-write-id'});
  await page.goto(base+'/?emulators=1');await page.waitForFunction(()=>window.__runtime);
  await page.evaluate(()=>__runtime.api('dashboard'));assert.equal(await page.evaluate(()=>window.__checks||0),0);
  await context.route('**/game-admin/site/config.js*',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'game-admin/site/config.js'),'utf8').replace('adminAppCheckRequired:false','adminAppCheckRequired:true').replace(/appCheckSiteKey:'[^']*'/,"appCheckSiteKey:''")}));
  await page.goto(base);await page.waitForFunction(()=>window.__runtime);
  assert.equal(await page.evaluate(async()=>{try{await __runtime.api('dashboard');}catch(error){return error.code;}}),'ops/app-check-not-configured');
  assert.equal(await page.evaluate(()=>window.__calls||0),0);assert.deepEqual(errors,[]);
  console.log('PASS actual runtime: optional mode avoids reCAPTCHA, required mode uses configured provider, failed/throttled App Check blocks admin requests, valid token proceeds once with stable request ID, missing config message and isolated emulator bypass.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
