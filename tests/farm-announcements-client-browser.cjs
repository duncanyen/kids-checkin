// Real player operations client and production feature flags; no live Auth/Functions.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
(async()=>{
 const paths=new Set(['/js/farm/operations-client.js','/js/farm/operations-config.js','/js/firebase-config.js']);
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(paths.has(pathname)){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fs.readFileSync(path.join(root,pathname)));return;}
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<script type="module">import {createGameOperationsClient} from "/js/farm/operations-client.js";window.__create=createGameOperationsClient;window.__client=__create({accountId:"self",groupId:"A"});</script>');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://www.gstatic.com/**',route=>{
   const file=new URL(route.request().url()).pathname.split('/').at(-1);let body;
   if(file==='firebase-app.js')body='const apps=[];export const initializeApp=(config,name="default")=>{const app={config,name};apps.push(app);return app;};export const getApps=()=>apps;';
   else if(file==='firebase-firestore.js')body='export const getFirestore=()=>({});';
   else if(file==='firebase-auth.js')body='export const getAuth=()=>({}),inMemoryPersistence={};export const setPersistence=async()=>{};export const signInWithCustomToken=async()=>{window.__events.push("signIn");return{user:{uid:"self-doc"}};};';
   else if(file==='firebase-app-check.js')body='export const initializeAppCheck=()=>{throw Error("Announcement reads must not initialize App Check");};export class ReCaptchaEnterpriseProvider{}';
   else body=`export const getFunctions=()=>({});export const httpsCallable=(_f,name)=>async payload=>{window.__events.push(name);window.__requests.push({name,payload});if(name==='photoSession'){if(window.__failSession){window.__failSession=false;throw Error('session offline');}return{data:{token:'isolated-token'}};}if(name==='gameOpsAnnouncements')return{data:{rows:[{id:'a',title:'公告'}],nextCursor:null}};throw Error('Unexpected privileged endpoint');};`;
   return route.fulfill({contentType:'text/javascript',body});
  });
  await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',groupId:'A',password:'isolated-only'}));localStorage.setItem('lastGroupId','A');window.__events=[];window.__requests=[];});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.__client);
  assert.equal((await page.evaluate(()=>__client.announcements())).rows[0].title,'公告');
  assert.deepEqual(await page.evaluate(()=>__events),['photoSession','signIn','gameOpsAnnouncements']);
  assert.equal(await page.evaluate(()=>__requests.at(-1).payload.groupId),'A');
  await page.evaluate(()=>__client.announcements('next-page'));
  assert.equal(await page.evaluate(()=>__requests.filter(r=>r.name==='photoSession').length),1);
  assert.equal(await page.evaluate(()=>__requests.at(-1).payload.cursor),'next-page');
  assert.match(await page.evaluate(async()=>{try{await __client.redeem('TEST2026');}catch(e){return e.message;}}),/禮包服務尚未啟用/);
  assert.equal(await page.evaluate(()=>__requests.filter(r=>r.name==='gameOpsRedeem').length),0);
  await page.evaluate(()=>localStorage.setItem('lastGroupId','B'));
  assert.match(await page.evaluate(async()=>{try{await __client.announcements();}catch(e){return e.message;}}),/群組已變更/);
  await page.evaluate(()=>{localStorage.setItem('lastGroupId','A');sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'other',groupId:'A'}));});
  assert.match(await page.evaluate(async()=>{try{await __client.announcements();}catch(e){return e.message;}}),/玩家或群組已變更/);
  await page.evaluate(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',groupId:'A',password:'isolated-only'}));window.__retry=__create({accountId:'self',groupId:'A'});window.__failSession=true;});
  assert.match(await page.evaluate(async()=>{try{await __retry.announcements();}catch(e){return e.message;}}),/session offline/);
  assert.equal((await page.evaluate(()=>__retry.announcements())).rows.length,1);
  assert.deepEqual(errors,[]);console.log('PASS real player announcement client: enabled read flag, authenticated session bridge, cached connection, cursor, disabled redemption, account/group isolation and session retry.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
