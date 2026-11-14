// 真實 Phaser 場景＋真實後端服務＋隔離 SDK。所有直接 Firestore 寫入均拒絕。
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
const {MemoryDB}=require('../game-admin/tests/memory-db.cjs'),{createService}=require('../game-admin/functions/service.cjs'),I=require('../functions/identity-domain.cjs');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8032';
(async()=>{
 const db=new MemoryDB(),stamp=Date.now(),tokens=new Map(),calls=[],errors=[];let sequence=0,serverRoll=.99;
 const farm={coins:12345,hens:1,hensState:[{id:'hen1',breed:'hen',laidAt:stamp,isSick:false}],poultryVersion:2,readyEggs:{hen:3,silkie:0,bresse:0,onagadori:0},eggsReady:3,warehouseLimit:100,coopLevel:3,cleanliness:30,equippedWeapon:'club'};
 db.data.set('groups/A',{name:'隔離測試村落',members:['alice','bob'],farmVillageVisibility:'public'});
 db.data.set('ops_identity_state/global',{ready:true,farmReady:true});
 for(const id of ['alice','bob']){db.data.set('users/'+id,{accountId:id,name:id,role:'member'});db.data.set('groups/A/users/'+id,{farm:structuredClone(farm)});db.data.set('ops_identity_credentials/'+id,{authUid:I.profileUid(id),accountId:id,sessionVersion:1,disabled:false});}
 const token={nexusProfileId:'alice',nexusAccountId:'alice',nexusSessionVersion:1,photoGroupId:'A',photoAccountId:'alice'},auth={uid:I.profileUid('alice'),token};
 const service=createService({db,auth:{getUser:async()=>({disabled:false})},privateIdentityEnabled:()=>true,farmBackendEnabled:()=>true,farmRandom:()=>serverRoll});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),startupLogs=[];page.on('console',message=>{if(message.type()==='error')startupLogs.push(message.text());});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('__saveDb',async op=>{if(op.kind==='get')return structuredClone(db.data.get(op.path));throw Error('Private mode attempted direct Firestore write: '+op.kind);});
  await page.exposeFunction('__privateServer',async(name,data)=>{
   calls.push({name,action:data.action});
   if(name==='photoSession')return{token:'opaque-'+sequence++};
   const request={auth,data};
   if(name==='gameOpsFarmTransaction')return service.farmTransaction(request);
   if(name==='gameOpsDailyChallenges')return service.dailyChallenges(request);
   if(name==='gameOpsAnnouncements')return{rows:[],nextCursor:null};
   if(name==='gameOpsGuardDog')return service.guardDog(request);
   throw Error('Unexpected callable '+name);
  });
  const old=fs.readFileSync('tests/farm-save-browser.cjs','utf8').match(/const sdk = `([\s\S]*?)`;/)[1];
  const firestoreSDK="export const getFirestore=()=>({});\n"+old.replace('l.callback(await getDoc(l.ref))',"l.callback(l.ref.kind==='query'?await getDocs(l.ref):await getDoc(l.ref))")+`\nwindow.__privateEmitAll=async()=>{for(const l of [...listeners])await emit(l);};`;
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(process.env.PHASER_FIXTURE||'/tmp/kids-phaser.js','utf8')}));
  await page.route('https://www.gstatic.com/**',r=>{
   const url=r.request().url();let body=firestoreSDK;
   if(url.endsWith('firebase-app.js'))body=`const apps=[];export const getApps=()=>apps,initializeApp=(_,name)=>{const app={name};apps.push(app);return app;};`;
   if(url.endsWith('firebase-auth.js'))body=`export const getAuth=()=>({authStateReady:async()=>{}}),setPersistence=async()=>{},inMemoryPersistence={},signInWithCustomToken=async()=>({user:{uid:'${auth.uid}'}});`;
   if(url.endsWith('firebase-functions.js'))body=`export const getFunctions=()=>({}),httpsCallable=(_,name)=>async data=>({data:await window.__privateServer(name,data)});`;
   return r.fulfill({contentType:'text/javascript',body});
  });
  // 使用真正的 firebase-config.js，涵蓋預設 Auth 恢復與模組初始化；SDK 仍完全隔離。
  await page.route('**/js/identity-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const PRIVATE_IDENTITY_ENABLED=true;'}));
  await page.route('**/js/farm/backend-client.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('FARM_BACKEND_ENABLED = false','FARM_BACKEND_ENABLED = true')});});
  await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
  await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',docId:'alice',groupId:'A',name:'Alice'}));localStorage.setItem('lastGroupId','A');sessionStorage.setItem('nexus_active_group_id','A');});
  await page.goto(base+'/farmgame.html');await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.coins===12345);
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('MyFarmScene').harvestEgg();await window.__privateEmitAll();});
  assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,3);
  await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene'));await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('ShopScene').executeBuyMedicine(2);await window.__privateEmitAll();});assert.equal(db.data.get('groups/A/users/alice').farm.medicines,2);assert.equal(db.data.get('groups/A/users/alice').farm.coins,12325);
  await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('VisitScene',{targetGroupId:'A',targetAccountId:'bob',targetName:'Bob'}));
  await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.hasRolledEncounter&&window.__farmGame.scene.getScene('VisitScene')?.targetFarmData);
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('VisitScene').cleanTargetFarm();await window.__privateEmitAll();});assert.equal(db.data.get('groups/A/users/bob').farm.cleanliness,0);
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('VisitScene').attemptSteal();await window.__privateEmitAll();});assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,4);
  const status=await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}});assert.equal(status.challenges.mission.tasks[0].count,1);assert.equal(status.challenges.mission.tasks[1].count,1);
  await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('ShopScene'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene')?.farmData);
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('ShopScene').executeBuyWeapon('battleaxe',1);await window.__privateEmitAll();});
  await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('WarehouseScene'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('WarehouseScene')?.actionPanel);
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('WarehouseScene').toggleEquipWeapon('battleaxe',false);await window.__privateEmitAll();});
  serverRoll=0;
  await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').scene.start('VisitScene',{targetGroupId:'A',targetAccountId:'bob',targetName:'Bob'}));
  await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.gorillaEncounter?.id);
  await page.waitForTimeout(2500);
  await page.evaluate(()=>{const boss=window.__farmGame.scene.getScene('VisitScene').gorillaEncounter;for(let i=0;i<40;i++)boss.hit({x:195,y:400});});
  await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.gorillaEncounter?.settled===true);
  assert.equal(db.data.get('groups/A/users/alice').farm.gorillaFangs,1);
  assert.deepEqual(await page.evaluate(()=>window.__farmGame.scene.getScenes(true).filter(s=>['MyFarmScene','VisitScene','ShopScene','WarehouseScene'].includes(s.scene.key)).map(s=>s.scene.key)),['VisitScene']);
  const completed=await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}});assert.equal(completed.challenges.mission.tasks[2].count,1);
  assert.ok(calls.some(c=>c.action==='battleAttack'));assert.ok(calls.some(c=>c.action==='battleSettle'));
  assert.ok(calls.some(c=>c.action==='stealEgg'));assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/nexus-private-farm-mobile.png'});
  await page.route('**/js/farm/main.js',r=>r.fulfill({contentType:'text/javascript',body:"throw Object.assign(Error('fixture startup error'),{code:'fixture/module'});"}));
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('[data-loading-status]')?.textContent.includes('遊戲程式載入失敗'));
  assert.ok(startupLogs.some(message=>message.includes('farm-startup-failure')&&message.includes('fixture/module')));
  console.log('PASS real Phaser private-mode harvest, shop, visit cleaning, theft, real boss hits/settlement and daily progress; no client Firestore transaction writes; /tmp/nexus-private-farm-mobile.png');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
