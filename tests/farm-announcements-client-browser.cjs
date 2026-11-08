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
   else if(file==='firebase-app-check.js')body='export const initializeAppCheck=(_app,options)=>{window.__events.push("appCheck");window.__siteKey=options.provider.key;};export class ReCaptchaEnterpriseProvider{constructor(key){this.key=key;}}';
   else body=`export const getFunctions=()=>({});export const httpsCallable=(_f,name)=>async payload=>{window.__events.push(name);window.__requests.push({name,payload});if(name==='photoSession'){if(window.__holdSession){window.__holdSession=false;await new Promise(resolve=>window.__releaseSession=resolve);}if(window.__failSession){window.__failSession=false;throw Error('session offline');}return{data:{token:'isolated-token'}};}if(name==='gameOpsAnnouncements')return{data:{rows:[{id:'a',title:'公告'}],nextCursor:null}};if(name==='gameOpsRedeem'){if(window.__holdRedeem){window.__holdRedeem=false;await new Promise(resolve=>window.__releaseRedeem=resolve);}if(window.__redeemOffline){window.__redeemOffline=false;throw Error('reply lost');}return{data:{rewards:[{kind:'coins',amount:100}]}};}throw Error('Unexpected privileged endpoint');};`;
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
  assert.equal(await page.evaluate(()=>__events.filter(e=>e==='appCheck').length),0,'read-only feed never initializes App Check');
  await page.evaluate(()=>__client.announcements(null,'notifications'));
  assert.equal(await page.evaluate(()=>__requests.at(-1).payload.channel),'notifications');
  await page.evaluate(()=>window.__redeemOffline=true);
  assert.match(await page.evaluate(async()=>{try{await __client.redeem('TEST2026');}catch(e){return e.message;}}),/reply lost/);
  assert.equal((await page.evaluate(()=>__client.redeem('test-２０２６'))).rewards[0].amount,100);
  const redemptionRequests=await page.evaluate(()=>__requests.filter(r=>r.name==='gameOpsRedeem'));
  assert.equal(redemptionRequests.length,2);assert.equal(redemptionRequests[0].payload.requestId,redemptionRequests[1].payload.requestId,'retry preserves idempotency key across code normalization');
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('nexus.ops.pending:'))),false);
  assert.equal(await page.evaluate(()=>__events.filter(e=>e==='appCheck').length),0,'optional redemption never initializes App Check or exchanges a reCAPTCHA token');
  assert.equal(await page.evaluate(()=>__events.filter(e=>e==='signIn').length),2,'redemption still signs into its isolated authenticated app');
  await page.evaluate(()=>{window.__slow=__create({accountId:'self',groupId:'A'},{timeoutMs:100});window.__holdRedeem=true;});
  assert.match(await page.evaluate(async()=>{try{await __slow.redeem('WAIT2026');}catch(e){return e.message;}}),/連線逾時/);
  const retryId=await page.evaluate(()=>__requests.filter(r=>r.name==='gameOpsRedeem').at(-1).payload.requestId);
  await page.evaluate(()=>window.__releaseRedeem());await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('nexus.ops.pending:'))),true,'late successful response cannot erase a timed-out receipt');
  await page.evaluate(()=>__slow.redeem('WAIT2026'));
  assert.equal(await page.evaluate(()=>__requests.filter(r=>r.name==='gameOpsRedeem').at(-1).payload.requestId),retryId);
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('nexus.ops.pending:'))),false);
  await page.evaluate(()=>{window.__bridgeSlow=__create({accountId:'self',groupId:'A'},{timeoutMs:100});window.__holdSession=true;});
  assert.match(await page.evaluate(async()=>{try{await __bridgeSlow.redeem('BRIDGE2026');}catch(e){return e.message;}}),/連線逾時/);
  const count=await page.evaluate(()=>__requests.filter(r=>r.name==='gameOpsRedeem').length);
  await page.evaluate(()=>window.__releaseSession());await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>__requests.filter(r=>r.name==='gameOpsRedeem').length),count,'late authentication must not submit a timed-out redemption');
  await page.evaluate(()=>__bridgeSlow.redeem('BRIDGE2026'));
  const beforeConcurrent=await page.evaluate(()=>__requests.filter(r=>r.name==='gameOpsRedeem').length);
  await page.evaluate(()=>{window.__dedupe=__create({accountId:'self',groupId:'A'});window.__holdRedeem=true;window.__releaseRedeem=null;window.__same1=__dedupe.redeem('SAME2026');window.__same2=__dedupe.redeem('same-２０２６');});
  await page.waitForFunction(()=>typeof window.__releaseRedeem==='function');
  assert.equal(await page.evaluate(()=>__requests.filter(r=>r.name==='gameOpsRedeem').length),beforeConcurrent+1,'concurrent equivalent submissions send one award request');
  await page.evaluate(()=>window.__releaseRedeem());await page.evaluate(()=>Promise.all([__same1,__same2]));
  await page.evaluate(()=>localStorage.setItem('lastGroupId','B'));
  assert.match(await page.evaluate(async()=>{try{await __client.announcements();}catch(e){return e.message;}}),/群組已變更/);
  await page.evaluate(()=>{localStorage.setItem('lastGroupId','A');sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'other',groupId:'A'}));});
  assert.match(await page.evaluate(async()=>{try{await __client.announcements();}catch(e){return e.message;}}),/玩家或群組已變更/);
  await page.evaluate(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',groupId:'A',password:'isolated-only'}));window.__retry=__create({accountId:'self',groupId:'A'});window.__failSession=true;});
  assert.match(await page.evaluate(async()=>{try{await __retry.announcements();}catch(e){return e.message;}}),/session offline/);
  assert.equal((await page.evaluate(()=>__retry.announcements())).rows.length,1);
  assert.deepEqual(errors,[]);console.log('PASS real player announcement client: enabled read flag, authenticated session bridge, cached connection, cursor, system channel, enabled authenticated redemption without App Check, normalized-code idempotent retry, timeout recovery, late response and late authentication safety, account/group isolation and session retry.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
