// 真實群組管理表單＋私有身分服務；不連正式 Firebase。
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const {MemoryDB}=require('../game-admin/tests/memory-db.cjs'),I=require('../functions/identity-domain.cjs'),{createIdentityService}=require('../functions/identity-service.cjs');
(async()=>{
 const db=new MemoryDB();db.data.set('ops_identity_state/global',{ready:true,farmReady:true});
 db.data.set('users/owner',{accountId:'owner',name:'Owner',role:'member'});db.data.set('ops_identity_credentials/owner',{authUid:I.profileUid('owner'),accountId:'owner',sessionVersion:1,disabled:false});db.data.set('groups/A',{name:'A',members:['owner'],nexusRoles:{owner:'owner'}});db.data.set('ops_group_roles/'+I.hash('A:owner'),{role:'owner'});db.data.set('ops_group_role_sets/A',{roles:{owner:'owner'}});db.data.set('system_menus/chat',{id:'chat',label:'聊天',isDefault:true,order:1});
 const api=createIdentityService({db,auth:{getUser:async()=>({disabled:false})},enabled:()=>true}),auth={uid:I.profileUid('owner'),token:{nexusProfileId:'owner',nexusAccountId:'owner',nexusSessionVersion:1}};
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
 await page.exposeFunction('__groupDb',async op=>{
  if(op.kind==='get')return db.data.get(op.path);
  if(op.kind==='query'){let query=db.collection(op.path);for(const filter of op.filters||[])if(filter.field)query=query.where(filter.field,filter.op,filter.value);const snap=await query.get();return snap.docs.map(row=>({path:op.path+'/'+row.id,data:row.data()}));}
  if(op.kind==='add'&&op.path==='logs'){const ref=await db.collection('logs').add(op.data);return ref.id;}
  throw Error('Unexpected direct management write: '+op.kind);
 });
 await page.exposeFunction('__identityAdmin',data=>api.handle({auth,data}));
 const sdk=fs.readFileSync('tests/admin-members.cjs','utf8').match(/const mock=`([\s\S]*?)`;/)[1];
 await page.route('https://www.gstatic.com/**',r=>{const url=r.request().url();const body=url.endsWith('firebase-auth.js')?`export const getAuth=()=>({authStateReady:async()=>{}});`:url.endsWith('firebase-functions.js')?`export const getFunctions=()=>({}),httpsCallable=()=>async data=>({data:await window.__identityAdmin(data)});`:sdk;return r.fulfill({contentType:'text/javascript',body});});
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={},app={},firebaseConfig={};'}));
 await page.route('**/js/identity-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const PRIVATE_IDENTITY_ENABLED=true;'}));
 await page.route('https://ui-avatars.com/**',r=>r.abort());
 await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'owner',name:'Owner',role:'member',groupId:'A'}));localStorage.setItem('lastGroupId','A');});
 await page.goto((process.env.ADMIN_BASE_URL||'http://127.0.0.1:8032')+'/admin.html');await page.waitForSelector('[data-account-id="owner"]',{state:'attached'});
 await page.evaluate(()=>{document.getElementById('newUserId').value='child';document.getElementById('newUserName').value='Child';document.getElementById('newUserPin').value='1234';document.getElementById('newUserRole').value='child';document.getElementById('btnAddUser').click();});
 await page.waitForSelector('[data-account-id="child"]',{state:'attached'});
 const profile=[...db.data.entries()].find(([path,data])=>path.startsWith('users/')&&data.accountId==='child');assert.ok(profile);assert.equal(profile[1].pin,undefined);
 const id=profile[0].slice('users/'.length);await page.evaluate(id=>window.openEditModal(id),id);assert.equal(await page.locator('#editPin').inputValue(),'');
 await page.fill('#editName','Child Updated');
 await page.evaluate(()=>document.getElementById('btnSaveEditUser').click());
 await page.waitForFunction(()=>document.getElementById('editModal').style.display==='none');
 assert.equal(db.data.get(profile[0]).name,'Child Updated');assert.equal(db.data.get('ops_identity_credentials/'+id).sessionVersion,1);
 assert.deepEqual(errors,[]);console.log('PASS private group-owner gate, actual add/edit forms, scoped roles, no public PIN and blank password retention');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
