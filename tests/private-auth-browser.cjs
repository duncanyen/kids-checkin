// 真實 private-auth-client 與私有登入服務整合；Firebase SDK／Firestore 使用隔離替身，不連正式資料。
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {MemoryDB}=require('../game-admin/tests/memory-db.cjs');
const {createIdentityService}=require('../functions/identity-service.cjs');
const I=require('../functions/identity-domain.cjs');
(async()=>{
 const db=new MemoryDB(),tokens=new Map();let currentAuth=null,sequence=0;
 db.data.set('ops_identity_state/global',{ready:true});db.data.set('users/profile',{accountId:'alice',name:'Alice',role:'member'});
 db.data.set('ops_identity_credentials/profile',{authUid:I.profileUid('profile'),accountId:'alice',sessionVersion:1,secrets:[await I.hashSecret('secret123')],disabled:false});
 db.data.set('ops_identity_accounts/'+I.hash('alice'),{profileId:'profile'});db.data.set('groups/A',{members:['alice']});
 const service=createIdentityService({db,enabled:()=>true,auth:{getUser:async()=>({disabled:false}),createCustomToken:async(uid,token)=>{const id='opaque-'+sequence++;tokens.set(id,{uid,token});return id;},revokeRefreshTokens:async()=>{}}});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext();
  await context.exposeFunction('__callIdentity',data=>service.handle({data,auth:currentAuth}));
  await context.exposeFunction('__acceptToken',token=>{assert.ok(tokens.has(token));currentAuth=tokens.get(token);return{user:{uid:currentAuth.uid}};});
  await context.exposeFunction('__logout',()=>{currentAuth=null;});
  await context.route('**/__identity_test',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Private identity integration</title>'}));
  await context.route('**/js/identity-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const PRIVATE_IDENTITY_ENABLED=true;'}));
  await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const app={};'}));
  await context.route('https://www.gstatic.com/**/firebase-auth.js',r=>r.fulfill({contentType:'text/javascript',body:`const auth={authStateReady:async()=>{}};export const getAuth=()=>auth,browserSessionPersistence={},setPersistence=async()=>{},signInWithCustomToken=(_,token)=>window.__acceptToken(token),signOut=()=>window.__logout();`}));
  await context.route('https://www.gstatic.com/**/firebase-functions.js',r=>r.fulfill({contentType:'text/javascript',body:`export const getFunctions=()=>({}),httpsCallable=()=>async data=>({data:await window.__callIdentity(data)});`}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto((process.env.AUTH_BASE_URL||'http://127.0.0.1:8032')+'/__identity_test');
  const result=await page.evaluate(async()=>{
   sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'old',password:'old-secret',pin:'1234'}));
   const api=await import('/js/private-auth-client.js');
   const scrubbed=JSON.parse(sessionStorage.getItem('familyCheckInUser'));
   const profile=await api.privateLogin('ALICE','secret123');sessionStorage.setItem('familyCheckInUser',JSON.stringify(profile));
   const group=await api.groupSession('A');
   const renamed=await api.privateUpdateProfile('Renamed','secret123','new-secret');
   const hydrated=await api.identityCall('profile');await api.privateLogout();
   return{scrubbed,profile,hasToken:!!group.token,renamed,hydrated,cache:sessionStorage.getItem('familyCheckInUser')};
  });
  assert.equal(result.scrubbed.password,undefined);assert.equal(result.scrubbed.pin,undefined);
  assert.equal(result.profile.accountId,'alice');assert.equal(result.profile.password,undefined);assert.equal(result.hasToken,true);
  assert.equal(result.renamed.name,'Renamed');assert.equal(result.hydrated.profile.name,'Renamed');assert.equal(result.cache,null);assert.equal(currentAuth,null);
  assert.deepEqual(errors,[]);console.log('PASS private login, sanitized session, scoped group token, profile/password update, session restoration and Firebase logout (isolated backend)');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
