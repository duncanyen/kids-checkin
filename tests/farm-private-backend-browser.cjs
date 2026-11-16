// 真實 Phaser 場景＋真實後端服務＋隔離 SDK。所有直接 Firestore 寫入均拒絕。
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
const {MemoryDB}=require('../game-admin/tests/memory-db.cjs'),{createService}=require('../game-admin/functions/service.cjs'),I=require('../functions/identity-domain.cjs');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8032';
const legacyHarvestBackend=process.env.LEGACY_HARVEST_BACKEND==='1';
const resumeMode=process.env.RESUME_PENDING_BATTLE;
const visitPreloadTests=process.env.VISIT_PRELOAD_TESTS==='1';
const coopCleanTests=process.env.COOP_CLEAN_TESTS==='1';
const entryEncounterTests=process.env.ENTRY_ENCOUNTER_TESTS==='1';
const eggResultTests=process.env.EGG_RESULT_TESTS==='1';
const unavailableEggResult=process.env.EGG_RESULT_UNAVAILABLE;
const visitPermissionTests=process.env.VISIT_PERMISSION_TESTS==='1';
const readOptimizationTests=process.env.READ_OPTIMIZATION_TESTS==='1';
const legacyDailyProgress=process.env.LEGACY_DAILY_PROGRESS==='1';
const stealSpeedTests=process.env.STEAL_SPEED_TESTS==='1';
const legacyStealBackend=process.env.LEGACY_STEAL_BACKEND==='1';
const holdStealAssets=process.env.STEAL_FLOW_ASSET_HOLD==='1';
const flowBench=process.env.STEAL_FLOW_BENCH==='1',flowBefore=process.env.STEAL_FLOW_BEFORE==='1';
const stealFlowTests=process.env.STEAL_FLOW_TESTS==='1';
const stealResultTests=process.env.STEAL_RESULT_TESTS==='1'||stealFlowTests;
const oldStealResultFields=process.env.OLD_STEAL_RESULT_FIELDS==='1';
(async()=>{
 const db=new MemoryDB(),stamp=stealResultTests?Date.parse('2026-11-16T10:00:00+08:00'):Date.now(),tokens=new Map(),calls=[],errors=[];let cleanGate=null,cleanDenied=false,lateCleanReply=false;let stealDelay=0,timeoutStealAlways=false,lateReplyOnce=false;let sequence=0,serverRoll=entryEncounterTests?0:.99,releaseSettlement,feedGate=null,feedEntered=null,releaseHarvest,releaseCollection,failCollection=false,visitGate=null,failVisitOnce=false,backendNow=stamp,lastStealResult=null,failSteal=false;
 const harvestGate=new Promise(resolve=>releaseHarvest=resolve);
 const collectionGate=new Promise(resolve=>releaseCollection=resolve);
 const settlementGate=new Promise(resolve=>releaseSettlement=resolve);
 let releaseEntryGate;const entryGate=new Promise(resolve=>releaseEntryGate=resolve);
 const farm={coins:12345,hens:1,hensState:[{id:'hen1',breed:'hen',laidAt:stamp,isSick:false}],poultryVersion:2,lastLayTime:stamp,readyEggs:{hen:3,silkie:0,bresse:0,onagadori:0},eggsReady:3,warehouseLimit:100,coopLevel:3,cleanliness:30,equippedWeapon:'club',worms:2,earthworms:3};
 db.data.set('groups/A',{name:'隔離測試村落',members:['alice','bob'],farmVillageVisibility:'public'});
 db.data.set('ops_identity_state/global',{ready:true,farmReady:true});
 for(const id of ['alice','bob']){db.data.set('users/'+id,{accountId:id,name:id,role:'member'});db.data.set('groups/A/users/'+id,{farm:structuredClone(farm)});db.data.set('ops_identity_credentials/'+id,{authUid:I.profileUid(id),accountId:id,sessionVersion:1,disabled:false});}
 const pendingKey='ops_farm_active/'+I.hash('alice:A');
 if(resumeMode)db.data.set(pendingKey,{id:'resume-gorilla',kind:'gorilla',groupId:'A',targetGroupId:'A',targetAccountId:resumeMode==='visit'?'bob':'alice',startedAt:stamp-1000,approachEndsAt:stamp-1,deadline:stamp+40000,health:700,attacks:{melee:1,ranged:0}});
 const token={nexusProfileId:'alice',nexusAccountId:'alice',nexusSessionVersion:1,photoGroupId:'A',photoAccountId:'alice'},auth={uid:I.profileUid('alice'),token};
 if(stealResultTests||entryEncounterTests||coopCleanTests||visitPreloadTests){db.data.set('groups/B',{name:'另一座公開村落',members:['bob'],farmVillageVisibility:'public'});db.data.set('groups/B/users/bob',{farm:{...structuredClone(farm),hens:2,hensState:[{id:'flower',name:'花花',breed:'silkie',laidAt:stamp},{id:'rice',name:'米粒',breed:'silkie',laidAt:stamp}],readyEggs:{hen:0,silkie:3,bresse:0,onagadori:0}}});}
 if(coopCleanTests||visitPreloadTests){db.data.get('users/bob').name='村長 Bob';db.data.set('groups/C',{name:'另一個公開村落',members:['carol'],farmVillageVisibility:'public'});db.data.set('users/carol',{accountId:'carol',name:'Carol 村長',role:'member'});db.data.set('groups/C/users/carol',{farm:structuredClone(farm)});}
 const service=createService({db,auth:{getUser:async()=>({disabled:false})},now:()=>readOptimizationTests||stealResultTests||entryEncounterTests?backendNow:Date.now(),privateIdentityEnabled:()=>true,farmBackendEnabled:()=>true,farmRandom:()=>serverRoll});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),startupLogs=[];page.on('console',message=>{if(message.type()==='error')startupLogs.push(message.text());if(message.text().includes('farm-entry-encounter'))console.log(message.text());});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('__saveDb',async op=>{if(op.kind==='query')return [...db.data].filter(([key,value])=>key.startsWith(op.path+'/')&&key.split('/').length===op.path.split('/').length+1&&(op.filters||[]).every(f=>f.op==='in'?f.value.includes(value[f.field]):value[f.field]===f.value)).map(([path,data])=>({path,data}));if(op.kind==='get')return structuredClone(db.data.get(op.path));throw Error('Private mode attempted direct Firestore write: '+op.kind);});
  await page.exposeFunction('__privateServer',async(name,data)=>{
   calls.push({name,action:data.action,requestId:data.requestId,verifyOnly:data.verifyOnly===true,collectWhenClear:data.collectWhenClear===true,stealWhenClear:data.stealWhenClear===true});
   if(stealFlowTests&&data.stealWhenClear&&stealDelay)await new Promise(resolve=>setTimeout(resolve,stealDelay));
   if(coopCleanTests&&data.action==='helpClean'){if(cleanDenied)return{__fixtureError:{code:'functions/permission-denied',message:'隔離測試：清潔被拒絕'}};if(cleanGate)await cleanGate;}
   if(failSteal&&data.action==='visitEncounter'&&data.stealWhenClear)throw Object.assign(Error('fixture theft denied'),{code:'functions/failed-precondition'});
   if(stealSpeedTests&&['visitEncounter','stealEgg'].includes(data.action))await new Promise(resolve=>setTimeout(resolve,400));
   if(failCollection&&data.action==='homeEncounter'&&data.collectWhenClear)throw Object.assign(Error('隔離測試：收蛋交易失敗'),{code:'functions/failed-precondition'});
   if(data.action==='visitEncounter'){
    if(failVisitOnce){failVisitOnce=false;throw Object.assign(Error('隔離測試：拜訪驗證暫時失敗'),{code:'functions/failed-precondition'});}
    if(visitGate)await visitGate;
   }
   if(name==='photoSession')return{token:'opaque-'+sequence++};
   const compatibleData={...data};if(legacyHarvestBackend&&data.action==='homeEncounter')delete compatibleData.collectWhenClear;
   if(legacyStealBackend&&data.action==='visitEncounter')delete compatibleData.stealWhenClear;
   const request={auth,data:compatibleData};
   if(name==='gameOpsFarmTransaction'){if(entryEncounterTests&&data.action==='homeEncounter'&&!data.collectWhenClear&&!data.verifyOnly)await entryGate;if(data.action==='homeEncounter'&&data.collectWhenClear)await harvestGate;if(data.action==='collectEggs')await collectionGate;if(data.action==='battleSettle')await settlementGate;const gate=data.action==='feedPoultry'?feedGate:null;let response;try{response=await service.farmTransaction(request);}catch(error){if(coopCleanTests&&data.action==='helpClean')return{__fixtureError:{code:'functions/'+(error.code||'internal'),message:error.message}};throw error;}if(coopCleanTests&&data.action==='helpClean'&&lateCleanReply){lateCleanReply=false;await new Promise(resolve=>setTimeout(resolve,350));}const steal=response.result?.steal||(data.action==='stealEgg'?response.result:null);if(steal){lastStealResult=structuredClone(steal);if(oldStealResultFields)for(const key of ['transactionId','totalEggs','eggBreed','eggSources'])delete steal[key];}if(stealFlowTests&&data.stealWhenClear&&lateReplyOnce){lateReplyOnce=false;await new Promise(resolve=>setTimeout(resolve,350));}
if(stealFlowTests&&data.stealWhenClear&&timeoutStealAlways)await new Promise(resolve=>setTimeout(resolve,550));
if(legacyDailyProgress)delete response.dailyProgress;if(gate){feedEntered?.();await gate;}return response;}
   if(name==='gameOpsDailyChallenges')return service.dailyChallenges(request);
   if(name==='gameOpsAnnouncements')return{rows:[],nextCursor:null};
   if(name==='gameOpsGuardDog')return service.guardDog(request);
   throw Error('Unexpected callable '+name);
  });
  const old=fs.readFileSync('tests/farm-save-browser.cjs','utf8').match(/const sdk = `([\s\S]*?)`;/)[1];
  const querySDK=stealFlowTests||entryEncounterTests||coopCleanTests||visitPreloadTests?old.replace('export const getDocs=async()=>({empty:true,docs:[],forEach:()=>{}});',`export const getDocs=async ref=>{const rows=await window.__saveDb({kind:'query',...ref});const docs=rows.map(row=>snap(row.path,row.data));return{empty:!docs.length,docs,forEach:fn=>docs.forEach(fn)};};`):old;
  const firestoreSDK="export const getFirestore=()=>({});\n"+querySDK.replace('l.callback(await getDoc(l.ref))',"l.callback(l.ref.kind==='query'?await getDocs(l.ref):await getDoc(l.ref))")+`\nwindow.__privateEmitAll=async()=>{for(const l of [...listeners])await emit(l);};`;
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(process.env.PHASER_FIXTURE||'/tmp/kids-phaser.js','utf8')}));
  await page.route('https://www.gstatic.com/**',r=>{
   const url=r.request().url();let body=firestoreSDK;
   if(url.endsWith('firebase-app.js'))body=`const apps=[];export const getApps=()=>apps,initializeApp=(_,name)=>{const app={name};apps.push(app);return app;};`;
   if(url.endsWith('firebase-auth.js'))body=`export const getAuth=()=>({authStateReady:async()=>{}}),setPersistence=async()=>{},inMemoryPersistence={},signInWithCustomToken=async()=>({user:{uid:'${auth.uid}'}});`;
   if(url.endsWith('firebase-functions.js'))body=`export const getFunctions=(_app,region)=>{(window.__farmFunctionRegions||=[]).push(region);return{};},httpsCallable=(_,name)=>async data=>{if(data.action==='visitEncounter'||data.action==='claimEncounter')window.__entryCallCount=(window.__entryCallCount||0)+1;const tracked=data.stealWhenClear||data.action==='stealEgg';if(tracked&&window.__flowMeasure)window.__flowMeasure.requestAt??=performance.now();const result=await window.__privateServer(name,data);if(result?.__fixtureError)throw Object.assign(Error(result.__fixtureError.message),{code:result.__fixtureError.code});if(tracked&&window.__flowMeasure)window.__flowMeasure.responseAt=performance.now();return{data:result};};`;
   return r.fulfill({contentType:'text/javascript',body});
  });
  // 使用真正的 firebase-config.js，涵蓋預設 Auth 恢復與模組初始化；SDK 仍完全隔離。
  await page.route('**/js/identity-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const PRIVATE_IDENTITY_ENABLED=true;'}));
  await page.route('**/js/farm/backend-client.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('FARM_BACKEND_ENABLED = false','FARM_BACKEND_ENABLED = true')});});
  await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
  let releaseStealAssets,heldAssets=0;const assetGate=new Promise(resolve=>releaseStealAssets=resolve);
  if(holdStealAssets){await page.route('**/js/farm/steal-result-ui.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('export const prepareStealResultAssets',"for(const key in assets)assets[key]+='?held-assets';\nexport const prepareStealResultAssets")});});await page.route('**/*?held-assets',async r=>{heldAssets++;await assetGate;await r.continue();});}
  if(stealFlowTests||coopCleanTests)await page.route('**/js/farm/operations-client.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('reject(timeoutFailure()),timeoutMs);','reject(timeoutFailure()),globalThis.__fixtureTimeoutMs||timeoutMs);')});});
  if(flowBefore)await page.route('**/css/farm-egg-result.css*',r=>r.fulfill({contentType:'text/css',body:require('node:child_process').execFileSync('git',['show','3517dab:css/farm-egg-result.css'],{encoding:'utf8'})}));
  if(flowBefore)for(const file of ['VisitScene.js','backend-client.js','egg-result-ui.js','steal-result-ui.js'])await page.route('**/js/farm/'+file+'*',r=>r.fulfill({contentType:'text/javascript',body:require('node:child_process').execFileSync('git',['show','3517dab:js/farm/'+file],{encoding:'utf8'})}));
  await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',docId:'alice',groupId:'A',name:'Alice'}));localStorage.setItem('lastGroupId','A');sessionStorage.setItem('nexus_active_group_id','A');});
  if(unavailableEggResult==='module')await page.route('**/js/farm/egg-result-ui.js',r=>r.fulfill({status:503,contentType:'text/javascript',body:'fixture optional module unavailable'}));
  if(unavailableEggResult==='image')await page.route('**/assets/farm/egg-result/v1/egg_result_panel.png',r=>r.fulfill({status:503,body:'fixture optional image unavailable'}));
  if(stealResultTests||entryEncounterTests)await page.clock.setFixedTime(new Date(stamp));
  await page.goto(base+'/farmgame.html');await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.coins===12345);
  if(!resumeMode&&!entryEncounterTests)await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').entryChecked===true);
  if(coopCleanTests||visitPreloadTests){
   const cleanCalls=()=>calls.filter(c=>c.action==='helpClean');
   const progress=async()=>(await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}})).challenges.mission.tasks.find(t=>t.type==='HELP_CLEAN_OTHER').count;
   const clickScene=async(key,find)=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const point=await page.evaluate(({key,find})=>{const s=window.__farmGame.scene.getScene(key),o=find==='public'?s.publicVillageButton:find==='own'?s.ownVillageButton:find==='B'||find==='C'?s.content.list.find(o=>o.getData('villageGroupId')===find):find==='farm'?s.content.list.find(o=>o.texture?.key==='coop'):s.coop;const p=s.cameras.main.matrix.transformPoint(o.x-s.cameras.main.scrollX,o.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();if(find==='coop'){const q=s.cameras.main.matrix.transformPoint(o.x-s.cameras.main.scrollX,o.y-o.height*.3-s.cameras.main.scrollY);p.x=q.x;p.y=q.y;}return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},{key,find});await page.mouse.click(point.x,point.y);
   };
   const enter=async(group,waitForEntry=true)=>{
    const sceneKey=await page.evaluate(()=>window.__farmGame.scene.getScenes(true).find(s=>['MyFarmScene','VisitScene','LobbyScene'].includes(s.scene.key)).scene.key);
    if(sceneKey==='MyFarmScene')await page.locator('.farm-hud-bottom button[aria-label="村落"]').click();
    else if(sceneKey==='VisitScene'){
     const point=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene'),o=s.children.list.find(o=>o.type==='Rectangle'&&o.x===55&&o.y===50),p=s.cameras.main.matrix.transformPoint(o.x-s.cameras.main.scrollX,o.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};});await page.mouse.click(point.x,point.y);
    }
    await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.farms?.length>0);await clickScene('LobbyScene','public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');await clickScene('LobbyScene',group);await page.waitForFunction(g=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id===g&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0,group);await clickScene('LobbyScene','farm');if(waitForEntry)await page.waitForFunction(g=>{const s=window.__farmGame.scene.getScene('VisitScene');return s?.targetGroupId===g&&s.entryChecked&&!s.visitEncounterPending;},group);
   };
   if(visitPreloadTests){
    let releaseVisit;visitGate=new Promise(resolve=>releaseVisit=resolve);
    await enter('B',false);await page.waitForFunction(()=>window.__farmGame.scene.isActive('LobbyScene')&&window.__farmGame.scene.getScene('LobbyScene').entering);
    assert.equal(await page.evaluate(()=>window.__farmGame.scene.isActive('VisitScene')),false,'確認未完成時仍在列表載入');
    await page.waitForFunction(()=>document.querySelector('[data-loading-status]').textContent==='正在準備村落…');
    assert.equal(await page.locator('[data-farm-loading]').isVisible(),true);
    assert.equal(await page.locator('[data-farm-loading] canvas').isVisible(),true);
    const visits=()=>calls.filter(c=>c.action==='visitEncounter'||c.action==='claimEncounter');
    await page.waitForFunction(()=>window.__entryCallCount===1);
    await clickScene('LobbyScene','farm');await page.waitForTimeout(100);assert.equal(visits().length,1,'連點只送一次進場確認');
    await page.screenshot({path:'/tmp/gugu-visit-preload-list.png',animations:'disabled'});releaseVisit();visitGate=null;
    await page.waitForFunction(()=>{const s=window.__farmGame.scene.getScene('VisitScene');return s?.entryChecked&&!s.visitEncounterPending;});
    await page.waitForTimeout(100);assert.equal(visits().length,1,'進入後不重送確認');assert.equal(await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');return s.visitEncounterReady&&!s.stealFeedback.visible&&s.stealFeedback.text!=='確認村落中…'&&s.targetAccountId==='bob';}),true);
    assert.equal(await page.locator('[data-farm-loading]').isVisible(),false);await page.screenshot({path:'/tmp/gugu-visit-preload-ready.png',animations:'disabled'});
    serverRoll=0;await enter('C');await page.waitForFunction(()=>!!window.__farmGame.scene.getScene('VisitScene').gorillaEncounter);assert.equal(visits().length,2,'怪物已在列表取得，進場不再判定');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').stealFeedback.visible),false);
    db.data.set(pendingKey,{id:'fixture-cleared',kind:null,targetGroupId:'C',targetAccountId:'carol',visitPermit:true,result:{outcome:'clear'}});serverRoll=.99;failVisitOnce=true;
    await enter('B',false);await page.waitForFunction(()=>!window.__farmGame.scene.getScene('LobbyScene').entering);assert.equal(await page.evaluate(()=>window.__farmGame.scene.isActive('LobbyScene')),true,'失敗留在列表');
    await clickScene('LobbyScene','farm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').entryChecked&&window.__farmGame.scene.isActive('VisitScene'));
    visitGate=new Promise(resolve=>releaseVisit=resolve);const beforeCancel=visits().length;await enter('C',false);await page.waitForFunction(count=>window.__entryCallCount>count,beforeCancel);await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').entering);await page.evaluate(()=>window.__farmGame.scene.getScene('LobbyScene').showVillage('A'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='A');assert.equal(await page.locator('[data-farm-loading]').isVisible(),false);releaseVisit();visitGate=null;
    await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.__farmGame.scene.isActive('LobbyScene')&&!window.__farmGame.scene.isActive('VisitScene')),true,'舊回覆不可切進已取消的雞舍');
    await enter('B');const beforeRestart=visits().length;await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');window.__oldEntryToken=s.visitToken;s.scene.restart();});await page.waitForFunction(()=>{const s=window.__farmGame.scene.getScene('VisitScene');return s.visitToken!==window.__oldEntryToken&&s.entryChecked&&!s.visitEncounterPending;});assert.equal(visits().length,beforeRestart+1,'預先確認只交接一次，重啟場景仍重新驗證');assert.deepEqual(errors,[]);assert.ok((await page.evaluate(()=>window.__farmFunctionRegions||[])).length>0);assert.ok((await page.evaluate(()=>window.__farmFunctionRegions)).every(region=>region==='asia-east1'),'real farm client selects Taiwan');
    console.log('PASS visit preparation: original lobby click, slow verification stays in loading list, one call under rapid clicks, ready data/no second confirmation on arrival, monster before entry, safe error retry and discarded canceled selection');return;
   }
   const open=async()=>{await clickScene('VisitScene','coop');await page.waitForSelector('[data-result-kind=coop-clean]');await page.waitForFunction(()=>[...document.querySelectorAll('[data-result-kind=coop-clean] img')].every(i=>i.complete&&i.naturalWidth));};
   const no=()=>page.locator('.farm-coop-clean-no'),yes=()=>page.locator('.farm-coop-clean-yes');
   const refill=async(group='B',account='bob',cleanliness=70)=>{db.data.get(`groups/${group}/users/${account}`).farm.cleanliness=cleanliness;await page.evaluate(()=>window.__privateEmitAll());};
   await enter('B');await refill();const listenersBefore=await page.evaluate(()=>{const e=window.__farmGame.scene.getScene('VisitScene').events;return ['shutdown','destroy','update'].map(key=>e.listenerCount(key));});await open();
   assert.match(await page.locator('.farm-coop-clean-message').textContent(),/村長 Bob/);
   await page.screenshot({path:'/tmp/gugu-coop-clean-390.png',animations:'disabled'});await page.setViewportSize({width:390,height:693});await page.screenshot({path:'/tmp/gugu-coop-clean-reference-ratio.png',animations:'disabled'});await page.setViewportSize({width:390,height:844});
   const before=cleanCalls().length,taskBefore=await progress();await no().click();assert.equal(cleanCalls().length,before);assert.deepEqual(await page.evaluate(()=>{const e=window.__farmGame.scene.getScene('VisitScene').events;return ['shutdown','destroy','update'].map(key=>e.listenerCount(key));}),listenersBefore,'關閉清理所有臨時監聽器');assert.equal(db.data.get('groups/B/users/bob').farm.cleanliness,70);assert.equal(await progress(),taskBefore);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').targetGroupId),'B');
   // 等待中的按壓回饋與雙層防重；同次確認只減 30，任務只加一次。
   let releaseClean;cleanGate=new Promise(resolve=>releaseClean=resolve);await open();await yes().click();await page.waitForFunction(()=>document.querySelector('.farm-coop-clean-yes').disabled);
   await page.evaluate(()=>{const b=document.querySelector('.farm-coop-clean-yes');b.click();b.click();window.__farmGame.scene.getScene('VisitScene').cleanTargetFarm();});assert.equal(cleanCalls().length,before+1);assert.equal(await no().isDisabled(),true);releaseClean();cleanGate=null;
   await page.waitForSelector('[data-result-kind=coop-clean]',{state:'detached'});assert.equal(db.data.get('groups/B/users/bob').farm.cleanliness,40);assert.equal(await progress(),taskBefore+1);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').input.enabled),true);
   // 明確拒絕後保留視窗並恢復按鈕，取消仍不寫資料。
   await refill();cleanDenied=true;await open();await yes().click();await page.waitForFunction(()=>!document.querySelector('.farm-coop-clean-yes').disabled);assert.match(await page.locator('.farm-coop-clean-status').textContent(),/清潔被拒絕/);assert.equal(db.data.get('groups/B/users/bob').farm.cleanliness,70);assert.equal(await progress(),taskBefore+1);cleanDenied=false;await no().click();
   // 對方先被打掃：保留舊畫面快照，交給原後端拒絕，不計任務。
   await open();db.data.get('groups/B/users/bob').farm.cleanliness=0;await yes().click();await page.waitForSelector('[data-result-kind=coop-clean]',{state:'detached'});assert.equal(await progress(),taskBefore+1);
   // 真正客戶端逾時。沒有自動第二次清潔；手動確認沿用同一 ID。
   await refill();await open();await page.evaluate(()=>window.__fixtureTimeoutMs=100);lateCleanReply=true;const timeoutAt=cleanCalls().length;await yes().click();await page.waitForFunction(()=>document.querySelector('.farm-coop-clean-yes span')?.textContent==='確認結果');assert.equal(cleanCalls().length,timeoutAt+1);assert.equal(db.data.get('groups/B/users/bob').farm.cleanliness,40);assert.equal(await progress(),taskBefore+2);
   await page.waitForTimeout(400);assert.equal(cleanCalls().length,timeoutAt+1);assert.equal(await page.locator('[data-result-kind=coop-clean]').count(),1);await yes().click();await page.waitForSelector('[data-result-kind=coop-clean]',{state:'detached'});assert.equal(cleanCalls().at(-1).requestId,cleanCalls().at(-2).requestId);assert.equal(db.data.get('groups/B/users/bob').farm.cleanliness,40);assert.equal(await progress(),taskBefore+2);await page.evaluate(()=>window.__fixtureTimeoutMs=0);
   // 不同村落主人、長名稱、未知名稱及純文字注入。
   await enter('C');await open();assert.match(await page.locator('.farm-coop-clean-message').textContent(),/Carol 村長/);await no().click();
   await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').targetName='<img src=x onerror="window.__injected=1">很長的村落主人名稱'.repeat(8));await open();assert.equal(await page.locator('.farm-coop-clean-message img').count(),0);assert.equal(await page.evaluate(()=>window.__injected),undefined);await no().click();await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').targetName='住在咕咕村落的超長名稱村長'.repeat(4));await open();
   for(const [width,height] of [[320,568],[375,667],[430,932],[768,1024],[844,390]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>{const p=document.querySelector('.farm-coop-clean-panel').getBoundingClientRect(),n=document.querySelector('.farm-coop-clean-no').getBoundingClientRect(),y=document.querySelector('.farm-coop-clean-yes').getBoundingClientRect(),m=document.querySelector('.farm-coop-clean-message').getBoundingClientRect();return p.left>=0&&p.right<=innerWidth&&p.top>=0&&p.bottom<=innerHeight&&n.height>=44&&y.height>=44&&Math.abs(n.width-y.width)<.1&&Math.abs(n.height-y.height)<.1&&m.bottom<=n.top&&document.documentElement.scrollWidth<=innerWidth;}),true);if(width===320)await page.screenshot({path:'/tmp/gugu-coop-clean-long-320.png',animations:'disabled'});}
   const nameScroll=page.locator('.farm-coop-clean-message strong');assert.equal(await nameScroll.evaluate(n=>n.scrollHeight>n.clientHeight),true);await nameScroll.hover();await page.mouse.wheel(0,300);await page.waitForFunction(()=>document.querySelector('.farm-coop-clean-message strong').scrollTop>0);
   await no().click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').targetName='');await open();assert.equal(await page.locator('.farm-coop-clean-message').textContent(),'這座雞舍有點髒亂，是否要幫忙打掃雞舍？');await no().click();
   // 開窗後切換目標，不可在舊名稱之下發出新目標的交易。
   await open();const staleAt=cleanCalls().length;await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('LobbyScene',{targetGroupId:'C'}));await page.waitForSelector('[data-result-kind=coop-clean]',{state:'detached'});assert.equal(cleanCalls().length,staleAt);
   await enter('B');await refill();await open();
   cleanGate=new Promise(resolve=>releaseClean=resolve);await yes().click();await page.waitForFunction(()=>document.querySelector('.farm-coop-clean-yes').disabled);
   await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('LobbyScene'));await page.waitForSelector('[data-result-kind=coop-clean]',{state:'detached'});await enter('C');const carolBefore=db.data.get('groups/C/users/carol').farm.cleanliness;releaseClean();cleanGate=null;await page.waitForFunction(async()=> (await window.__saveDb({kind:'get',path:'groups/B/users/bob'}))?.farm.cleanliness===40);assert.equal(db.data.get('groups/C/users/carol').farm.cleanliness,carolBefore);assert.equal(db.data.get('groups/B/users/bob').farm.cleanliness,40);assert.equal(await page.locator('[data-result-kind=coop-clean]').count(),0);
   assert.deepEqual(errors,[]);console.log('PASS coop clean: original public visit and coop click, real owner text, no/yes and concurrent protection, authoritative already-clean/error, manual same-ID timeout confirmation, six viewports, safe text, target-switch cleanup and original-target completion');return;
  }
  if(entryEncounterTests){
   const economy=()=>calls.filter(c=>c.collectWhenClear||c.stealWhenClear||['collectEggs','stealEgg','cleanOwn','helpClean','searchGarden','treatHen'].includes(c.action));
   await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').checkingEntry);
   await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');await s.harvestEgg();await s.cleanMyFarm();s.askCleanMyFarm();await s.searchCabbage(s.gardenPlants[0]);});assert.equal(economy().length,0,'進場回覆未到前不能執行農場操作');releaseEntryGate();await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').entryChecked);
   assert.equal(await page.evaluate(()=>!!window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter),true,'進入自己的農場即出現怪物');assert.equal(economy().length,0);
   const blockHome=async()=>page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');await s.harvestEgg();await s.cleanMyFarm();s.askCleanMyFarm();await s.searchCabbage(s.gardenPlants[0]);});
   await blockHome();assert.equal(economy().length,0,'有怪物時收蛋清潔抓蟲完全不送交易');
   backendNow=stamp+50000;releaseSettlement();releaseHarvest();releaseCollection();
   await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');window.__homeMonster=s.gorillaEncounter;s.gorillaEncounter.resolve('loss');});await page.waitForFunction(()=>window.__homeMonster.settled);
   const f=db.data.get('groups/A/users/alice').farm;f.readyEggs.hen=1;f.eggsReady=1;f.gardenCatchCount=99;await page.evaluate(()=>window.__privateEmitAll());
   await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').harvestEgg());await page.waitForSelector('[data-result-kind=harvest]');
   assert.equal(economy().filter(c=>c.collectWhenClear).at(-1).verifyOnly,true);assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,1);await page.locator('.farm-egg-result-confirm').click();
   await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');await s.cleanMyFarm();await s.searchCabbage(s.gardenPlants[0]);});
   assert.equal(await page.evaluate(()=>!!window.__farmGame.scene.getScene('MyFarmScene').moleEncounter),false,'抓蟲達門檻不臨時生成地鼠');assert.equal(db.data.get('groups/A/users/alice').farm.gardenCatchCount,100);
   // 從真正 HUD／公開村落卡片進入其他雞舍；進場先有怪物，不能先偷蛋。
   const click=async(sceneKey,find)=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const point=await page.evaluate(({sceneKey,find})=>{const s=window.__farmGame.scene.getScene(sceneKey),o=find==='public'?s.publicVillageButton:find==='group'?s.content.list.find(o=>o.getData('villageGroupId')==='B'):s.content.list.find(o=>o.texture?.key==='coop'),p=s.cameras.main.matrix.transformPoint(o.x-s.cameras.main.scrollX,o.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},{sceneKey,find});await page.mouse.click(point.x,point.y);
   };
   await page.locator('.farm-hud-bottom button[aria-label="村落"]').click();await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.farms?.length>0);
   await click('LobbyScene','public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');await click('LobbyScene','group');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B'&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);await click('LobbyScene','farm');
   await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.moleEncounter&&window.__farmGame.scene.getScene('VisitScene').entryChecked);
   assert.equal(economy().some(c=>c.stealWhenClear||c.action==='stealEgg'),false);
   const before=economy().length;await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('VisitScene');await s.attemptSteal();s.askCleanTargetFarm();await s.cleanTargetFarm();await s.searchCabbage(s.gardenPlants[0]);});assert.equal(economy().length,before);
   await page.screenshot({path:'/tmp/gugu-entry-monster-visit.png',animations:'disabled'});
   backendNow+=70000;await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');window.__visitMonster=s.moleEncounter;s.moleEncounter.resolve('loss');});await page.waitForFunction(()=>window.__visitMonster.settled);
   const t=db.data.get('groups/B/users/bob').farm;t.readyEggs.silkie=1;t.eggsReady=1;await page.evaluate(()=>window.__privateEmitAll());
   const point=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene'),h=s.hensGroup[0];h.walkTimer?.remove();s.tweens.killTweensOf(h);h.setPosition(180,400);const p=s.cameras.main.matrix.transformPoint(h.x-s.cameras.main.scrollX,h.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};});await page.mouse.click(point.x,point.y);await page.waitForSelector('[data-result-kind=steal]');
   assert.equal(economy().filter(c=>c.stealWhenClear).at(-1).verifyOnly,true);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').moleEncounter===window.__visitMonster),true,'偷蛋期間沒有生成新怪物');assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,1);assert.deepEqual(errors,[]);
   console.log('PASS entry-only encounters: own login and original public village entry show monsters before actions; harvest/theft/clean/garden blocked in combat; settled entry permits collect and steal without reroll; garden milestone deferred');return;
  }
  if(stealResultTests){
   const clickObject=async(sceneKey,find)=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const point=await page.evaluate(({sceneKey,find})=>{const s=window.__farmGame.scene.getScene(sceneKey),o=find==='public'?s.publicVillageButton:find==='village'?s.content.list.find(o=>o.getData('villageGroupId')==='B'):find==='farm'?s.content.list.find(o=>o.texture?.key==='coop'):s.hensGroup[0];if(find==='steal'){o.walkTimer?.remove();s.tweens.killTweensOf(o);o.setPosition(180,400);}const p=s.cameras.main.matrix.transformPoint(o.x-s.cameras.main.scrollX,o.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},{sceneKey,find});await page.mouse.click(point.x,point.y);
   };
   if(stealFlowTests){
    await page.locator('.farm-hud-bottom button[aria-label="村落"]').click();
    await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.farms?.length>0);
    await clickObject('LobbyScene','public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');
    await clickObject('LobbyScene','village');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B'&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);
    await clickObject('LobbyScene','farm');
   }else await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetGroupId:'B',targetAccountId:'bob',targetName:'Bob'}));
   await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.visitEncounterReady&&!window.__farmGame.scene.getScene('VisitScene').visitEncounterPending);
   await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene'),original=s.showFloatingText.bind(s);window.__successFloats=0;s.showFloatingText=(message,...args)=>{if(message.startsWith('偷到'))window.__successFloats++;return original(message,...args);};});
   const clickHen=async()=>{
    const point=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene'),h=s.hensGroup[0];h.walkTimer?.remove();s.tweens.killTweensOf(h);h.setPosition(180,400);const p=s.cameras.main.matrix.transformPoint(h.x-s.cameras.main.scrollX,h.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};});
    await page.mouse.click(point.x,point.y);
   };
   const economyCalls=()=>calls.filter(c=>c.action==='stealEgg'||c.stealWhenClear).length;
   if(flowBench){
    const rows=[];
    for(const delay of [60,350,900])for(let i=0;i<20;i++){
     stealDelay=delay;
     const f=db.data.get('groups/A/users/alice').farm,t=db.data.get('groups/B/users/bob').farm;
     f.villageStealCooldowns={};f.villageStealBlockedUntil={};t.eggsReady=3;t.readyEggs.silkie=3;
     await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.lastStealBlockedUntil=0;window.__flowMeasure=null;return window.__privateEmitAll();});
     await page.evaluate(()=>{
      const s=window.__farmGame.scene.getScene('VisitScene');
      if(!window.__originalAttempt){window.__originalAttempt=s.attemptSteal.bind(s);s.attemptSteal=function(){if(this.isStealing||this.eggResultDialog)return window.__originalAttempt();const m=window.__flowMeasure={clickAt:performance.now()};requestAnimationFrame(()=>{m.feedbackAt=performance.now();m.feedbackVisible=this.isStealing&&(this.stealFeedback.visible||this.stealTarget?.isTinted);});return window.__originalAttempt();};}
      const observer=new MutationObserver(()=>{if(!document.querySelector('[data-result-kind=steal]'))return;observer.disconnect();requestAnimationFrame(()=>{if(window.__flowMeasure)window.__flowMeasure.visibleAt=performance.now();});});observer.observe(document.body,{childList:true});
     });
     await clickHen();await page.waitForFunction(()=>!!window.__flowMeasure?.visibleAt);
     const m=await page.evaluate(()=>window.__flowMeasure);
     rows.push({delay,feedbackMs:Math.round(m.feedbackAt-m.clickAt),requestMs:Math.round(m.requestAt-m.clickAt),networkAndServerMs:Math.round(m.responseAt-m.requestAt),responseMs:Math.round(m.responseAt-m.clickAt),resultMs:Math.round(m.visibleAt-m.clickAt),renderMs:Math.round(m.visibleAt-m.responseAt)});
     assert.ok(Number.isFinite(m.feedbackAt-m.clickAt));
     await page.locator('.farm-egg-result-confirm').click();
    }
    fs.writeFileSync('/tmp/gugu-theft-'+(flowBefore?'before':'after')+'.json',JSON.stringify({baseline:flowBefore,viewport:'390x844',environment:'Linux Chromium, real Phaser, MemoryDB callable, injected service delay; warm assets',rows},null,2));
    assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,60);assert.equal(db.data.get('groups/A/users/alice').farm.stolenEggs20261116,60);assert.deepEqual(errors,[]);console.log('PASS theft benchmark',flowBefore?'before':'after',rows.length);return;
   }
   if(stealFlowTests){assert.equal(await page.evaluate(()=>!!window.__farmGame.scene.getScene('VisitScene').stealButton),false,'沒有額外偷蛋按鈕');}
   if(stealFlowTests)await page.screenshot({path:'/tmp/gugu-steal-action-mobile.png',animations:'disabled'});
   await clickHen();await page.waitForSelector('[data-result-kind=steal]');await page.waitForFunction(()=>!window.__farmGame.scene.getScene('VisitScene').isStealing);
   if(holdStealAssets){assert.ok(heldAssets>0);assert.equal(await page.locator('.farm-egg-result-confirm').isEnabled(),true,'圖片尚未回傳時結果及控制已可用');releaseStealAssets();await page.waitForFunction(()=>[...document.querySelectorAll('[data-result-kind=steal] img')].every(i=>i.complete&&i.naturalWidth>0));}
   const actual=structuredClone(lastStealResult);assert.equal(actual.totalEggs,1);assert.equal(actual.eggSources[0].henId,null);
   assert.equal(await page.locator('.farm-steal-result-name').textContent(),'烏骨雞蛋');assert.equal(await page.locator('.farm-steal-result-breed').count(),0);assert.equal(await page.locator('.farm-steal-result-quantity').textContent(),'× 1');assert.equal(await page.locator('.farm-egg-result-total strong').textContent(),'1');assert.equal(await page.evaluate(()=>window.__successFloats),0);
   await page.screenshot({path:'/tmp/gugu-steal-result-390.png',animations:'disabled'});await page.setViewportSize({width:320,height:568});await page.screenshot({path:'/tmp/gugu-steal-result-320.png',animations:'disabled'});await page.setViewportSize({width:390,height:844});
   const beforeClose=economyCalls();await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.attemptSteal();const b=document.querySelector('.farm-egg-result-confirm');b.click();b.click();});
   assert.equal(economyCalls(),beforeClose);assert.equal(await page.locator('[data-result-kind=steal]').count(),0);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').targetGroupId),'B');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').input.enabled),true);
   const openFixture=async result=>page.evaluate(async result=>{const ui=await import('/js/farm/steal-result-ui.js');return !!await ui.openStealResult(window.__farmGame.scene.getScene('VisitScene'),result,{groupId:'A',accountId:'alice'});},result);
   assert.equal(await openFixture(actual),true);assert.equal(await page.locator('[data-result-kind=steal]').count(),0,'同一成功交易不重開');
   for(const [id,sources]of [
    ['named',[{henId:'a',henName:'花花',breed:'silkie',quantity:2},{henId:'b',henName:'米粒',breed:'silkie',quantity:1}]],
    ['same-name',[{henId:'a',henName:'花花',breed:'silkie',quantity:1},{henId:'b',henName:'花花',breed:'silkie',quantity:1}]],
    ['single',[{henId:'a',henName:'米粒',breed:'bresse',quantity:1}]],
    ['partial',[{henId:'a',henName:'米粒',breed:'hen',quantity:1},{henId:null,breed:'hen',quantity:2}]],
    ['long',Array.from({length:8},(_,i)=>({henId:'long-'+i,henName:'很長的母雞名字'.repeat(12)+i,breed:'silkie',quantity:1}))]
   ]){
    const fixture={success:true,transactionId:'ui-fixture-'+id,totalEggs:sources.reduce((n,s)=>n+s.quantity,0),eggSources:sources};await openFixture(fixture);
    assert.equal(await page.locator('.farm-egg-result-row').count(),sources.length);assert.equal(await page.locator('.farm-egg-result-row img').count(),0);
    if(id==='named'){assert.equal(await page.locator('.farm-egg-result-total strong').textContent(),'3');await page.screenshot({path:'/tmp/gugu-steal-result-example-390.png',animations:'disabled'});}
    if(id==='long'){
     assert.equal(await page.locator('.farm-egg-result-rows').evaluate(n=>n.scrollHeight>n.clientHeight),true);
     for(const [width,height]of [[320,568],[375,667],[430,932],[768,1024],[844,390]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>{const p=document.querySelector('.farm-egg-result-panel').getBoundingClientRect(),b=document.querySelector('.farm-egg-result-confirm').getBoundingClientRect();return p.left>=0&&p.right<=innerWidth&&p.top>=0&&b.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth;}),true);}
     await page.setViewportSize({width:390,height:844});
     const touch=await page.context().newCDPSession(page),box=await page.locator('.farm-egg-result-rows').boundingBox(),x=box.x+box.width/2,y=box.y+box.height-10;
     await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
     for(let step=1;step<=6;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*12}]});
     await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>document.querySelector('.farm-egg-result-rows').scrollTop>0);await touch.detach();
    }
    await page.locator('.farm-egg-result-close').click();assert.equal(await page.evaluate(()=>window.__farmGame.scene.isActive('VisitScene')),true);
   }
   assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,1);assert.equal(db.data.get('groups/A/users/alice').farm.stolenEggs20261116,1);
   assert.equal(await openFixture({success:false,totalEggs:0}),false);assert.equal(await openFixture({success:true,totalEggs:0}),false);
   const reset=async()=>{const f=db.data.get('groups/A/users/alice').farm;f.villageStealCooldowns={};f.villageStealBlockedUntil={};await page.evaluate(()=>{window.__farmGame.scene.getScene('VisitScene').lastStealBlockedUntil=0;return window.__privateEmitAll();});};
   db.data.get('groups/B/users/bob').farm.guardDogs=[{id:'dog',breedId:'pyrenees',days:1,startedAt:stamp-1,expiresAt:stamp+86400000}];serverRoll=0;await reset();await clickHen();await page.waitForFunction(()=>!window.__farmGame.scene.getScene('VisitScene').isStealing);
   assert.equal(lastStealResult.success,false);assert.equal(await page.locator('[data-result-kind=steal]').count(),0);assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,1);
   const target=db.data.get('groups/B/users/bob').farm;target.guardDogs=[];target.readyEggs.silkie=0;target.eggsReady=0;serverRoll=.99;await reset();const empty=economyCalls();await clickHen();assert.equal(economyCalls(),empty);assert.equal(await page.locator('[data-result-kind=steal]').count(),0);
   target.readyEggs.silkie=2;target.eggsReady=2;await reset();failSteal=true;await clickHen();await page.waitForFunction(()=>!window.__farmGame.scene.getScene('VisitScene').isStealing);failSteal=false;assert.equal(await page.locator('[data-result-kind=steal]').count(),0);assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,1);
   await page.evaluate(()=>{window.__append=document.body.append;document.body.append=function(...nodes){if(nodes.some(n=>n.dataset?.resultKind==='steal'))throw Error('fixture popup failure');return window.__append.apply(this,nodes);};});
   await clickHen();await page.waitForFunction(()=>!window.__farmGame.scene.getScene('VisitScene').isStealing);await page.evaluate(()=>document.body.append=window.__append);
   assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,2);assert.equal(db.data.get('groups/A/users/alice').farm.stolenEggs20261116,2);assert.equal(await page.evaluate(()=>window.__successFloats),1,'開啟失敗保留成功浮字，不重送交易');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').input.enabled),true);
   if(stealFlowTests){
    const beforeSlow=economyCalls();stealDelay=850;await reset();
    await clickObject('VisitScene','steal');await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').stealFeedback.visible),false,'500ms 內沒有等待文字');
    assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').input.enabled),true,'等待只防重複偷蛋，其他場景操作不鎖定');
    await clickObject('VisitScene','steal');await page.waitForFunction(()=>{const s=window.__farmGame.scene.getScene('VisitScene');return s.stealFeedback.visible&&s.stealFeedback.text==='正在偷蛋…';});
    await page.waitForSelector('[data-result-kind=steal]');assert.equal(economyCalls(),beforeSlow+1,'連點不多送交易');
    assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').stealFeedback.visible),false);
    await page.locator('.farm-egg-result-confirm').click();stealDelay=0;
    // 真正的客戶端逾時計時器；第一筆已提交後延遲回傳，第二次查回同一收據。
    const refill=()=>{const t=db.data.get('groups/B/users/bob').farm;t.eggsReady=3;t.readyEggs.silkie=3;};refill();await reset();
    await page.evaluate(()=>{window.__fixtureTimeoutMs=100;window.__sawConfirming=false;const s=window.__farmGame.scene.getScene('VisitScene'),set=s.stealFeedback.setText.bind(s.stealFeedback);s.stealFeedback.setText=function(value){if(value==='結果確認中')window.__sawConfirming=true;return set(value);};});
    const beforeTimeout=economyCalls(),beforeEggs=db.data.get('groups/A/users/alice').farm.silkieEggs,beforeRank=db.data.get('groups/A/users/alice').farm.stolenEggs20261116;
    lateReplyOnce=true;await clickObject('VisitScene','steal');await page.waitForSelector('[data-result-kind=steal]');
    assert.equal(await page.evaluate(()=>window.__sawConfirming),true);assert.equal(economyCalls(),beforeTimeout+2);
    const retries=calls.filter(c=>c.stealWhenClear).slice(-2);assert.equal(retries[0].requestId,retries[1].requestId);
    assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,beforeEggs+1);assert.equal(db.data.get('groups/A/users/alice').farm.stolenEggs20261116,beforeRank+1);
    await page.locator('.farm-egg-result-close').click();await page.waitForTimeout(400);assert.equal(await page.locator('[data-result-kind=steal]').count(),0,'原回覆晚到不重開');
    // 兩次均未收到明確結果，按「確認結果」仍沿用原 ID，跳過已提交造成的本地冷卻。
    refill();await reset();timeoutStealAlways=true;await clickObject('VisitScene','steal');await page.waitForFunction(()=>!window.__farmGame.scene.getScene('VisitScene').isStealing);
    assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').stealFeedback.text),'結果確認中，請再點母雞');
    const unresolved=calls.filter(c=>c.stealWhenClear).at(-1).requestId;timeoutStealAlways=false;
    await page.reload();await page.waitForFunction(expected=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.silkieEggs===expected,beforeEggs+2);
    await page.locator('.farm-hud-bottom button[aria-label="村落"]').click();await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.farms?.length>0);
    await clickObject('LobbyScene','public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');await clickObject('LobbyScene','village');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B'&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);await clickObject('LobbyScene','farm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.visitEncounterReady);
    await clickObject('VisitScene','steal');await page.waitForSelector('[data-result-kind=steal]');assert.equal(calls.filter(c=>c.stealWhenClear).at(-1).requestId,unresolved);
    assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,beforeEggs+2);assert.equal(db.data.get('groups/A/users/alice').farm.stolenEggs20261116,beforeRank+2);
    await page.screenshot({path:'/tmp/gugu-steal-flow-mobile.png',animations:'disabled'});await page.locator('.farm-egg-result-confirm').click();
    assert.deepEqual(errors,[]);console.log('PASS original HUD/public village/coop/hen tap, delayed hint, rapid click, real timeout+late reply, same-ID receipt replay across reload, one inventory/ranking update');return;
   }
   await page.reload();await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.silkieEggs===2);
   const duplicate=await page.evaluate(async result=>{const ui=await import('/js/farm/steal-result-ui.js');return(await ui.openStealResult(window.__farmGame.scene.getScene('MyFarmScene'),result,{groupId:'A',accountId:'alice'}))?.duplicate;},actual);assert.equal(duplicate,true);assert.equal(await page.locator('[data-result-kind=steal]').count(),0);
   assert.deepEqual(errors,[]);console.log('PASS steal result: original cross-village hen click, true unknown source, same breed/name grouping, long-name scroll, duplicate close/reload, blocked/empty/failure paths and no extra inventory/ranking awards');return;
  }
  if(stealSpeedTests){
   await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetGroupId:'A',targetAccountId:'bob',targetName:'Bob'}));
   await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.visitEncounterReady&&!window.__farmGame.scene.getScene('VisitScene').visitEncounterPending);
   const before=calls.filter(c=>['visitEncounter','stealEgg'].includes(c.action)).length;
   const point=await page.evaluate(()=>{
    const s=window.__farmGame.scene.getScene('VisitScene'),hen=s.hensGroup[0];window.__speedHen=hen;hen.walkTimer?.remove();s.tweens.killTweensOf(hen);hen.setPosition(180,400);
    const original=s.attemptSteal.bind(s);s.attemptSteal=function(){if(this.isStealing)return original();window.__stealStarted=performance.now();const result=original();window.__speedTask=result.then(()=>window.__stealFinished=performance.now());return result;};
    const p=s.cameras.main.matrix.transformPoint(hen.x-s.cameras.main.scrollX,hen.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};
   });
   await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>!!window.__speedTask);
   const immediate=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');return{processing:s.isStealing,hint:s.stealFeedback?.visible?s.stealFeedback.text:null};});
   await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').attemptSteal());await page.evaluate(()=>window.__speedTask);
   const metrics=await page.evaluate(()=>({resultMs:Math.round(window.__stealFinished-window.__stealStarted)}));metrics.calls=calls.filter(c=>['visitEncounter','stealEgg'].includes(c.action)).length-before;metrics.immediate=immediate;
   assert.equal(metrics.calls,legacyStealBackend?2:1);assert.equal(immediate.processing,true);assert.equal(immediate.hint,null);
   if(oldStealResultFields)assert.equal(await page.locator('[data-result-kind=steal]').count(),0,'舊後端沒有總數／收據欄位時使用原成功提示');
   await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').attemptSteal());assert.equal(calls.filter(c=>['visitEncounter','stealEgg'].includes(c.action)).length-before,metrics.calls,'快照尚未回來也不重送剛成功的偷蛋');
   await page.evaluate(()=>window.__privateEmitAll());assert.equal(await page.evaluate(()=>window.__speedHen.active&&window.__farmGame.scene.getScene('VisitScene').hensGroup[0]===window.__speedHen),true,'蛋數更新不重建雞隻');
   const target=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene'),h=s.hensGroup[0];return{width:h.input.hitArea.width*Math.abs(h.scaleX)*s.cameras.main.zoom,height:h.input.hitArea.height*Math.abs(h.scaleY)*s.cameras.main.zoom};});assert.ok(target.width>=43.9&&target.height>=43.9);
   assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,1);assert.equal(db.data.get('groups/A/users/bob').farm.eggsReady,2);assert.deepEqual(errors,[]);
   console.log('STEAL_SPEED',JSON.stringify(metrics));return;
  }
  if(readOptimizationTests){
   const statuses=()=>calls.filter(c=>c.name==='gameOpsDailyChallenges'&&c.action==='status').length;
   await page.clock.install();
   const tasks=page.locator('.farm-hud-side button[aria-label="每日任務"]');await tasks.click();
   await page.waitForFunction(()=>document.querySelector('.farm-daily-claim')?.textContent==='立即簽到');
   await page.getByRole('tab',{name:'每日任務',exact:true}).click();
   assert.deepEqual(await page.locator('.farm-daily-count').allTextContents(),['0/3','0/3','0/3']);
   const initial=statuses();await page.clock.fastForward(11000);assert.equal(statuses(),initial,'10 秒不再重查完整狀態');
   await page.locator('.farm-daily-close').click();releaseHarvest();releaseCollection();
   for(let i=1;i<=3;i++){
    const farm=db.data.get('groups/A/users/alice').farm;farm.readyEggs.hen=1;farm.eggsReady=1;await page.evaluate(()=>window.__privateEmitAll());
    await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').harvestEgg());await page.waitForSelector('.farm-egg-result-panel');await page.locator('.farm-egg-result-confirm').click();
    await tasks.click();await page.waitForFunction(()=>document.querySelector('.farm-daily-claim')?.textContent==='領取獎勵');assert.equal(await page.locator('.farm-daily-count').first().textContent(),i+'/3');assert.equal(statuses(),initial+(legacyDailyProgress?i:0),'新後端直接更新，舊後端缺少進度時才補查 status');await page.locator('.farm-daily-close').click();
   }
   await tasks.click();
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nexus-farm-daily-progress',{detail:{accountId:'someone-else',groupId:'A',progress:null}})));
   const afterHarvest=initial+(legacyDailyProgress?3:0);assert.equal(statuses(),afterHarvest,'其他帳號事件不觸發查詢');
   await page.clock.fastForward(61000);await page.waitForFunction(()=>document.querySelector('.farm-daily-claim')?.textContent==='領取獎勵');assert.equal(statuses(),afterHarvest+1,'仍保留每分鐘跨裝置狀態確認');
   await page.locator('.farm-daily-close').click();const hidden=statuses();await page.clock.fastForward(600000);assert.equal(statuses(),hidden,'關閉任務後不輪詢');
   await tasks.click();await page.waitForFunction(()=>document.querySelector('.farm-daily-claim')?.textContent==='領取獎勵');
   backendNow=(Math.floor((stamp+8*3600000)/86400000)+1)*86400000;
   const elapsed=await page.evaluate(()=>Date.now());await page.clock.fastForward(Math.max(1,backendNow-elapsed+1000));
   const newDate=new Date(backendNow+8*3600000).toISOString().slice(0,10);
   await page.waitForFunction(date=>document.querySelector('.farm-daily-date')?.textContent.startsWith(date),newDate);
   assert.deepEqual(await page.locator('.farm-daily-count').allTextContents(),['0/3','0/3','0/3'],'台灣午夜仍重新確認今日進度');
   assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,3);assert.equal(db.data.get('groups/A/users/alice').farm.coins,12345);
   assert.deepEqual(errors,[]);console.log('PASS read optimization: no 10-second polling, three verified harvest updates '+(legacyDailyProgress?'with compatible status fallback':'without extra status reads')+', account isolation, minute refresh, closed-panel cleanup and Taipei midnight reset');return;
  }
  if(visitPermissionTests){
   let releaseVisit;visitGate=new Promise(resolve=>releaseVisit=resolve);
   await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetGroupId:'A',targetAccountId:'bob',targetName:'Bob'}));
   await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').visitEncounterPending&&window.__farmGame.scene.getScene('VisitScene').targetFarmData?.eggsReady>0);
   await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');window.__earlySteal=Promise.all([s.attemptSteal(),s.attemptSteal(),s.cleanTargetFarm(),s.searchCabbage(s.gardenPlants[0])]);});
   assert.equal(calls.filter(c=>c.action==='stealEgg').length,0,'尚未確認拜訪時不送偷蛋');
   releaseVisit();visitGate=null;
   await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').entryChecked);
   await page.evaluate(async()=>{await window.__earlySteal;await window.__farmGame.scene.getScene('VisitScene').attemptSteal();await window.__privateEmitAll();});
   assert.equal(calls.filter(c=>c.action==='visitEncounter').length,2,'初始拜訪只有進場確認；完成後才送偷蛋驗證');assert.equal(calls.filter(c=>c.action==='stealEgg').length,0);assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,1);
   const resetCooldown=async()=>{const f=db.data.get('groups/A/users/alice').farm;f.villageStealCooldowns={};f.villageStealBlockedUntil={};await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.eggResultDialog?.close();s.lastStealBlockedUntil=0;return window.__privateEmitAll();});};
   // 其他分頁已把共用會話改回自己家：同一拜訪畫面仍會先恢復正確目標。
   db.data.set(pendingKey,{id:'another-tab',targetGroupId:'A',targetAccountId:'alice',kind:null,harvestPermit:true,result:{outcome:'clear'}});
   await resetCooldown();await page.evaluate(async()=>{await window.__farmGame.scene.getScene('VisitScene').attemptSteal();await window.__privateEmitAll();});assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,1,'失效許可不在偷蛋時抽怪或發蛋');
   const reenter=async()=>{await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.restart({targetGroupId:'A',targetAccountId:'bob',targetName:'Bob'}));await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').entryChecked&&!window.__farmGame.scene.getScene('VisitScene').visitEncounterPending);};
   await reenter();await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').attemptSteal());assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,2);
   // 重新確認同一目標不能偷偷重抽怪；0 會在全新拜訪觸發 gorilla。
   serverRoll=0;await resetCooldown();await page.evaluate(async()=>{await window.__farmGame.scene.getScene('VisitScene').attemptSteal();await window.__privateEmitAll();});assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,3);assert.equal(await page.evaluate(()=>!!window.__farmGame.scene.getScene('VisitScene').gorillaEncounter),false);
   serverRoll=.99;db.data.get('groups/A/users/bob').farm.readyEggs.hen=3;db.data.get('groups/A/users/bob').farm.eggsReady=3;
   db.data.set('groups/B',{members:['alice'],farmVillageVisibility:'public'});db.data.set('groups/B/users/alice',{farm:structuredClone(farm)});
   // 另一分頁在其他雞舍觸發戰鬥：點目前雞隻不能自動傳送或偷其他目標。
   db.data.set(pendingKey,{id:'other-live-target',kind:'gorilla',groupId:'A',targetGroupId:'B',targetAccountId:'alice',targetName:'另一位玩家',startedAt:Date.now(),approachEndsAt:Date.now()+10000,deadline:Date.now()+40000,health:1000,attacks:{melee:0,ranged:0}});
   await resetCooldown();
   const beforeOtherFarm=structuredClone(db.data.get('groups/B/users/alice').farm),beforeCurrentFarm=structuredClone(db.data.get('groups/A/users/bob').farm),beforeOwnFarm=structuredClone(db.data.get('groups/A/users/alice').farm);
   await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');window.__beforeVisit=s.visitToken;window.__beforeName=s.targetName;return s.attemptSteal();});
   assert.equal(await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');return s.visitToken===window.__beforeVisit&&s.targetGroupId==='A'&&s.targetAccountId==='bob'&&s.targetName===window.__beforeName&&!s.backendChallenge&&!s.visitEncounterReady;}),true,'拜訪位置與名稱不被其他會話覆蓋');
   assert.equal(db.data.get(pendingKey).id,'other-live-target');assert.equal(db.data.get(pendingKey).health,1000);
   assert.deepEqual(db.data.get('groups/B/users/alice').farm,beforeOtherFarm);assert.deepEqual(db.data.get('groups/A/users/bob').farm,beforeCurrentFarm);assert.deepEqual(db.data.get('groups/A/users/alice').farm,beforeOwnFarm,'沒有偷蛋、發獎或扣款');
   db.data.set(pendingKey,{id:'old-target',kind:'gorilla',groupId:'A',targetGroupId:'B',targetAccountId:'alice',startedAt:Date.now()-50000,approachEndsAt:Date.now()-40000,deadline:Date.now()-1000,health:1000,attacks:{melee:0,ranged:0}});
   await resetCooldown();await page.evaluate(async()=>{await window.__farmGame.scene.getScene('VisitScene').attemptSteal();await window.__privateEmitAll();});
   assert.equal(db.data.get('groups/B/users/alice').farm.eggsReady,0,'原戰鬥損失留在原雞舍');assert.equal(db.data.get('groups/A/users/bob').farm.eggsReady,3,'原戰鬥結算後不在偷蛋中重新抽怪');assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,3);
   await reenter();await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').attemptSteal());assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,4);
   await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('MyFarmScene'));await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene'));
   await resetCooldown();failVisitOnce=true;const beforeVisit=calls.filter(c=>c.action==='visitEncounter').length;
   await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetGroupId:'A',targetAccountId:'bob',targetName:'Bob'}));
   await page.waitForFunction(()=>window.__farmGame.scene.isActive('VisitScene')&&window.__farmGame.scene.getScene('VisitScene').targetFarmData&&window.__farmGame.scene.getScene('VisitScene').hasRolledEncounter===false);
   assert.equal(calls.filter(c=>c.action==='visitEncounter').length,beforeVisit+1);
   await page.locator('[data-loading-retry]').click();await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').entryChecked);
   await page.evaluate(async()=>{await window.__farmGame.scene.getScene('VisitScene').attemptSteal();await window.__privateEmitAll();});assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,5,'進場確認重試成功後才允許偷蛋');
   assert.equal(db.data.get('groups/A/users/alice').farm.reportStolenEggs,5);
   await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('MyFarmScene'));await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene'));
   serverRoll=.05;db.data.get('groups/A/users/bob').farm.coopLevel=1;
   await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetGroupId:'A',targetAccountId:'bob',targetName:'Bob'}));
   await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.wolf?.active);
   const beforeWolf=calls.filter(c=>['visitEncounter','stealEgg'].includes(c.action)).length;
   await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('VisitScene');window.__originalWolf=s.wolf;await s.attemptSteal();});
   assert.equal(calls.filter(c=>['visitEncounter','stealEgg'].includes(c.action)).length,beforeWolf,'野狼仍在場時不重複建立怪物或送偷蛋');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').wolf===window.__originalWolf),true);
   assert.deepEqual(errors,[]);assert.ok(!startupLogs.some(line=>line.includes('請先進入此村落並完成怪物事件')));
   console.log('PASS visit permission: delayed initial check, rapid clicks, overwritten target, no reroll on recheck, expired original battle and retry after validation failure; five successful thefts counted once');return;
  }
  if(unavailableEggResult){
   await page.waitForFunction(()=>window.__farmGame.registry.get('farmInitialReady')===true);
   assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').isSaveReady()),true,'非必要結果模組下載失敗仍可進入自己的農場');
   releaseHarvest();releaseCollection();
   await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');await Promise.all([s.harvestEgg(),s.harvestEgg()]);await window.__privateEmitAll();});
   assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,3);
   assert.equal(calls.filter(c=>c.action==='homeEncounter').length,1);
   assert.equal(calls.filter(c=>c.action==='collectEggs').length,0);
   assert.equal(await page.locator('.farm-egg-result-overlay').count(),0);
   assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').input.enabled),true);
   assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').isHarvesting),false);
   assert.ok(startupLogs.some(message=>message.includes('farm-egg-result-display-failure')));
   assert.ok(!startupLogs.some(message=>message.includes('farm-startup-failure')));
   const progress=await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}});assert.equal(progress.challenges.mission.tasks[0].count,1);
   await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene'));await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
   await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').executeBuyMedicine(1));
   assert.equal(db.data.get('groups/A/users/alice').farm.medicines,1);
   assert.deepEqual(errors,[]);
   console.log('PASS optional egg result '+unavailableEggResult+' unavailable: boot completes, harvest commits once, text fallback releases input, daily count stays one and shop remains usable');return;
  }
  if(resumeMode){
   const expectedScene=resumeMode==='visit'?'VisitScene':'MyFarmScene',originalDeadline=db.data.get(pendingKey).deadline;
   await page.waitForFunction(key=>window.__farmGame.scene.isActive(key)&&window.__farmGame.scene.getScene(key)?.gorillaEncounter?.id==='resume-gorilla',expectedScene);
   assert.equal(await page.evaluate(key=>window.__farmGame.scene.getScene(key).gorillaEncounter.health,expectedScene),700);
   assert.equal(await page.evaluate(key=>window.__farmGame.scene.getScene(key).gorillaEncounter.deadline,expectedScene),originalDeadline);
   assert.equal(calls.filter(call=>call.collectWhenClear||call.action==='collectEggs').length,0,'恢復戰鬥的進場驗證不自動收蛋，血量與期限不變');
   assert.equal(db.data.get('groups/A/users/alice').farm.coins,12345,'準備通知不發獎也不立即處罰');
   await page.reload();
   await page.waitForFunction(key=>window.__farmGame?.scene.isActive(key)&&window.__farmGame.scene.getScene(key)?.gorillaEncounter?.id==='resume-gorilla',expectedScene);
   assert.equal(await page.evaluate(key=>window.__farmGame.scene.getScene(key).gorillaEncounter.health,expectedScene),700,'重新整理不重設怪物血量');
   db.data.get(pendingKey).deadline=Date.now()-1;releaseSettlement();await page.reload();
   const settleDeadline=Date.now()+15000;
   while(db.data.get(pendingKey)?.result?.outcome!=='loss'&&Date.now()<settleDeadline)await new Promise(resolve=>setTimeout(resolve,50));
   assert.equal(db.data.get(pendingKey)?.result?.outcome,'loss');
   assert.equal(db.data.get('groups/A/users/alice').farm.coins,12245);
   assert.equal(db.data.get('groups/A/users/'+(resumeMode==='visit'?'bob':'alice')).farm.eggsReady,0,'損失仍歸原始戰鬥目標');
   await page.evaluate(async()=>{await window.__privateEmitAll();const scene=window.__farmGame.scene.getScenes(true).find(s=>['MyFarmScene','VisitScene'].includes(s.scene.key));scene.scene.start('WarehouseScene');});
   await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));
   await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').feedItem('earthworms','hen'));
   assert.equal(db.data.get('groups/A/users/alice').farm.earthworms,2,'完成原戰鬥結算後可正常餵食');
   assert.deepEqual(errors,[]);assert.ok(!startupLogs.some(message=>message.includes('farm-transaction-failure')));
   console.log('PASS pending '+resumeMode+' battle resumes with original health/deadline, survives reload, settles expired loss once and permits feeding; welcome preparation never returns 400');return;
  }
  if(eggResultTests){
   releaseHarvest();releaseCollection();
   // 原有背景 settlePoultry 會更新相容時間欄位；驗收比較所有經濟、雞隻與庫存資料。
   const savedState=()=>{const state=structuredClone(db.data.get('groups/A/users/alice').farm);delete state.lastLayTime;return state;};
   const seed=async(ready,limit=20000)=>{
    const farm=db.data.get('groups/A/users/alice').farm;
    farm.hensState=Object.entries(ready).flatMap(([breed,n])=>Array.from({length:Math.max(1,Math.ceil(n/6))},(_,i)=>({id:breed+i,breed,laidAt:Date.now(),isSick:false})));
    farm.hens=farm.hensState.length;farm.readyEggs={hen:0,silkie:0,bresse:0,onagadori:0,...ready};farm.eggsReady=Object.values(ready).reduce((a,b)=>a+b,0);farm.warehouseLimit=limit;
    await page.evaluate(()=>window.__privateEmitAll());
    await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').isSaveReady());
   };
   const collect=()=>page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');await Promise.all([s.harvestEgg(),s.harvestEgg()]);await window.__privateEmitAll();});
   const closed=async(button='.farm-egg-result-confirm')=>{
    const before=savedState(),count=calls.filter(c=>['homeEncounter','collectEggs'].includes(c.action)).length;
    await page.evaluate(selector=>{const b=document.querySelector(selector);b.click();b.click();},button);
    assert.equal(await page.locator('.farm-egg-result-overlay').count(),0);
    assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').input.enabled),true);
    assert.equal(calls.filter(c=>['homeEncounter','collectEggs'].includes(c.action)).length,count);assert.deepEqual(savedState(),before);
   };
   for(const [ready,total,rows]of [[{silkie:1},1,1],[{bresse:3},3,1],[{silkie:4,bresse:3,onagadori:5},12,3],[{hen:120},120,1],[{hen:1,silkie:1,bresse:1,onagadori:1},4,4]]){
    await seed(ready);await collect();await page.waitForSelector('.farm-egg-result-panel');
    assert.equal(await page.locator('.farm-egg-result-total strong').textContent(),String(total));
    assert.equal(await page.locator('.farm-egg-result-row').count(),rows);
    assert.equal(await page.locator('.farm-egg-result-row img').count(),0);
    assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').input.enabled),false);
    assert.equal(db.data.get('groups/A/users/alice').farm.eggsReady,0);
    if(total===12){
     for(const [width,height]of [[320,568],[375,667],[390,844],[430,932],[360,800],[768,1024],[844,390]]){
      await page.setViewportSize({width,height});
      const layout=await page.evaluate(()=>{const panel=document.querySelector('.farm-egg-result-panel'),button=document.querySelector('.farm-egg-result-confirm'),r=panel.getBoundingClientRect(),b=button.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,buttonBottom:b.bottom,viewport:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
      assert.ok(layout.left>=0&&layout.right<=layout.viewport&&layout.top>=0&&layout.bottom<=layout.height&&layout.buttonBottom<=layout.height,JSON.stringify(layout));assert.equal(layout.overflow,false);
      if(width===390)await page.screenshot({path:'/tmp/nexus-egg-result-mixed-mobile.png'});
      if(width===320)await page.screenshot({path:'/tmp/nexus-egg-result-small-mobile.png'});
     }
     await page.setViewportSize({width:390,height:844});
    }
    if(rows===4){
     assert.equal(await page.locator('.farm-egg-result-rows').evaluate(n=>n.scrollHeight>n.clientHeight),true);
     const touch=await page.context().newCDPSession(page),box=await page.locator('.farm-egg-result-rows').boundingBox(),x=box.x+box.width/2,y=box.y+box.height-10;
     await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});
     await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
     for(let step=1;step<=6;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*12}]});
     await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     await page.waitForFunction(()=>document.querySelector('.farm-egg-result-rows').scrollTop>0);
     await touch.detach();
    }
    await closed(total===1?'.farm-egg-result-close':undefined);
   }
   const beforeEmpty=calls.filter(c=>['homeEncounter','collectEggs'].includes(c.action)).length;await collect();assert.equal(await page.locator('.farm-egg-result-overlay').count(),0);assert.equal(calls.filter(c=>['homeEncounter','collectEggs'].includes(c.action)).length,beforeEmpty);
   await seed({hen:2});const beforeFailure=savedState();failCollection=true;await collect();failCollection=false;
   assert.deepEqual(savedState(),beforeFailure);assert.equal(await page.locator('.farm-egg-result-overlay').count(),0);
   // 模擬交易已提交後 DOM 建立失敗：不能重送收蛋，也不能把成功交易當作失敗。
   await page.evaluate(()=>{window.__bodyAppend=document.body.append;document.body.append=function(...nodes){if(nodes.some(n=>n.classList?.contains('farm-egg-result-overlay')))throw Error('fixture UI failure');return window.__bodyAppend.apply(this,nodes);};});
   const beforeUiFailure=calls.filter(c=>c.action==='homeEncounter').length;await collect();
   await page.evaluate(()=>document.body.append=window.__bodyAppend);
   assert.equal(calls.filter(c=>c.action==='homeEncounter').length,beforeUiFailure+1);assert.equal(db.data.get('groups/A/users/alice').farm.eggsReady,0);assert.equal(await page.locator('.farm-egg-result-overlay').count(),0);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').input.enabled),true);
   const {getUsedSpace}=await import('../js/farm/inventory-core.js');
   await seed({hen:2},getUsedSpace(db.data.get('groups/A/users/alice').farm)+1);await collect();await page.waitForSelector('.farm-egg-result-panel');
   assert.equal(await page.locator('.farm-egg-result-total strong').textContent(),'1');assert.ok((await page.locator('.farm-egg-result-remaining').textContent()).includes('1 顆蛋留在雞舍'));assert.equal(db.data.get('groups/A/users/alice').farm.eggsReady,1);await closed();
   const saved=structuredClone(db.data.get('groups/A/users/alice').farm);await page.reload();await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.inventoryEggs>0);
   assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').farmData.inventoryEggs),saved.inventoryEggs);assert.equal(await page.locator('.farm-egg-result-overlay').count(),0);
   await seed({silkie:2});await collect();await page.waitForSelector('.farm-egg-result-panel');
   await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene'));await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));assert.equal(await page.locator('.farm-egg-result-overlay').count(),0,'離開場景自動清理面板');
   const daily=await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}});assert.equal(daily.challenges.mission.tasks[0].count,3,'任務仍由有效交易累計並遵守既有上限');
   assert.deepEqual(errors,[]);console.log('PASS egg results: real Phaser + isolated backend; single/mixed/120 eggs, four scrollable breeds, seven viewports, close/repeated confirmation, empty/failure/UI failure, reload, scene cleanup and daily counter');return;
  }
  const ownFarm=db.data.get('groups/A/users/alice').farm;
  ownFarm.cleanliness=74;await page.evaluate(()=>window.__privateEmitAll());
  await page.evaluate(()=>{const scene=window.__farmGame.scene.getScene('MyFarmScene');window.__rubbishBefore=[...scene.rubbishGroup.getChildren()];window.__hensBefore=[...scene.hensGroup];});
  ownFarm.coins++;await page.evaluate(()=>window.__privateEmitAll());
  assert.equal(await page.evaluate(()=>{const scene=window.__farmGame.scene.getScene('MyFarmScene');return window.__rubbishBefore.length>0&&window.__rubbishBefore.every((item,i)=>item.active&&item===scene.rubbishGroup.getChildren()[i])&&window.__hensBefore.every((item,i)=>item===scene.hensGroup[i]);}),true,'金幣快照保留原垃圾圖像與走動雞隻');
  ownFarm.coins--;ownFarm.cleanliness=75;await page.evaluate(()=>window.__privateEmitAll());
  assert.equal(await page.evaluate(()=>window.__rubbishBefore.every(item=>!item.active)),true,'髒亂值改變時仍正常重建');
  ownFarm.cleanliness=30;await page.evaluate(()=>window.__privateEmitAll());
  assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').rubbishGroup.getLength()),0);
  const immediate=await page.evaluate(()=>{
   const scene=window.__farmGame.scene.getScene('MyFarmScene');
   window.__harvestFirst=scene.harvestEgg();
   window.__harvestRepeated=scene.harvestEgg();
   return{locked:scene.isHarvesting,status:scene.timerText.text};
  });
  assert.equal(immediate.locked,true,'第一次 await 前就鎖定收蛋');
  assert.ok(immediate.status.includes('確認雞舍'));
  await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').eggTick());
  assert.ok((await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').timerText.text)).includes('確認雞舍'),'倒數更新不蓋掉處理中提示');
  releaseHarvest();
  if(legacyHarvestBackend){
   await page.waitForFunction(()=>document.querySelector('.farm-hud-countdown-label')?.textContent==='收蛋中…');
   assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').isHarvesting),true);
  }
  releaseCollection();
  await page.evaluate(async()=>{await Promise.all([window.__harvestFirst,window.__harvestRepeated]);await window.__privateEmitAll();});
  assert.equal(calls.filter(call=>call.action==='homeEncounter'&&call.collectWhenClear).length,1);
  assert.equal(calls.filter(call=>call.action==='collectEggs').length,legacyHarvestBackend?1:0,'新版後端一次收蛋；舊版回傳時才接續 collectEggs');
  assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').isHarvesting),false);
  assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').timerText.text.includes('收蛋中')),false);
  assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,3);
  await page.waitForSelector('.farm-egg-result-panel');
  assert.equal(await page.locator('.farm-egg-result-total strong').textContent(),'3');
  assert.equal(await page.locator('.farm-egg-result-row').textContent(),'雞蛋 × 3');
  assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').input.enabled),false);
  await page.screenshot({path:'/tmp/nexus-egg-result-gameplay-mobile.png'});
  const collectionCalls=calls.filter(call=>['homeEncounter','collectEggs'].includes(call.action)).length;
  await page.evaluate(()=>{const scene=window.__farmGame.scene.getScene('MyFarmScene');scene.harvestEgg();const button=document.querySelector('.farm-egg-result-confirm');button.click();button.click();});
  assert.equal(await page.locator('.farm-egg-result-overlay').count(),0);
  assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').input.enabled),true);
  assert.equal(calls.filter(call=>['homeEncounter','collectEggs'].includes(call.action)).length,collectionCalls,'結果彈窗及連點確定不重送交易');
  assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,3);
  await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').harvestEgg());
  assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').isHarvesting),false,'無蛋分支釋放收蛋鎖');
  await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene'));await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('ShopScene').executeBuyMedicine(2);await window.__privateEmitAll();});assert.equal(db.data.get('groups/A/users/alice').farm.medicines,2);assert.equal(db.data.get('groups/A/users/alice').farm.coins,12325);
  await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('VisitScene',{targetGroupId:'A',targetAccountId:'bob',targetName:'Bob'}));
  await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.entryChecked&&!window.__farmGame.scene.getScene('VisitScene').visitEncounterPending&&window.__farmGame.scene.getScene('VisitScene')?.targetFarmData);
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('VisitScene').cleanTargetFarm();await window.__privateEmitAll();});assert.equal(db.data.get('groups/A/users/bob').farm.cleanliness,0);
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('VisitScene').attemptSteal();await window.__privateEmitAll();});assert.equal(db.data.get('groups/A/users/alice').farm.inventoryEggs,4);
  const status=await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}});assert.equal(status.challenges.mission.tasks[0].count,1);assert.equal(status.challenges.mission.tasks[1].count,1);
  await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('ShopScene'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene')?.farmData);
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('ShopScene').executeBuyWeapon('battleaxe',1);await window.__privateEmitAll();});
  await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('WarehouseScene'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('WarehouseScene')?.actionPanel);
  await page.evaluate(async()=>{await window.__farmGame.scene.getScene('WarehouseScene').toggleEquipWeapon('battleaxe',false);await window.__privateEmitAll();});
  await page.evaluate(async()=>{const scene=window.__farmGame.scene.getScene('WarehouseScene');await Promise.all([scene.feedItem('earthworms','hen'),scene.feedItem('earthworms','hen')]);await window.__privateEmitAll();});
  assert.equal(db.data.get('groups/A/users/alice').farm.earthworms,2,'連點只餵食一次');
  let releaseFeed;feedGate=new Promise(resolve=>releaseFeed=resolve);
  await page.evaluate(()=>{const scene=window.__farmGame.scene.getScene('WarehouseScene');window.__pendingFeed=scene.feedItem('earthworms','hen').then(()=>null,error=>error.message);scene.scene.start('ShopScene');});
  await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
  releaseFeed();assert.equal(await page.evaluate(()=>window.__pendingFeed),null,'離開倉庫後不更新已銷毀的精靈或文字');feedGate=null;
  assert.equal(db.data.get('groups/A/users/alice').farm.earthworms,1);
  await page.evaluate(async()=>{await window.__privateEmitAll();window.__farmGame.scene.getScene('ShopScene').scene.start('WarehouseScene');});
  await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));
  let releaseOld,noticeOld;feedGate=new Promise(resolve=>releaseOld=resolve);const oldStarted=new Promise(resolve=>noticeOld=resolve);feedEntered=noticeOld;
  await page.evaluate(()=>{window.__oldFeed=window.__farmGame.scene.getScene('WarehouseScene').feedItem('earthworms','hen');});
  await oldStarted;
  await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').scene.start('ShopScene'));
  await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
  await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('WarehouseScene'));
  await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));
  let releaseNew,noticeNew;feedGate=new Promise(resolve=>releaseNew=resolve);const newStarted=new Promise(resolve=>noticeNew=resolve);feedEntered=noticeNew;
  await page.evaluate(()=>{window.__newFeed=window.__farmGame.scene.getScene('WarehouseScene').feedItem('worms','hen');});
  await newStarted;
  releaseOld();await page.evaluate(()=>window.__oldFeed);
  assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').isFeeding),true,'舊回覆不能解除新場景正在餵食的防連點鎖');
  releaseNew();await page.evaluate(async()=>{await window.__newFeed;await window.__privateEmitAll();});feedGate=null;feedEntered=null;
  assert.equal(db.data.get('groups/A/users/alice').farm.earthworms,0);
  assert.equal(db.data.get('groups/A/users/alice').farm.worms,1);
  assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').isFeeding),false);
  serverRoll=0;
  await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').scene.start('VisitScene',{targetGroupId:'A',targetAccountId:'bob',targetName:'Bob'}));
  await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.gorillaEncounter?.id);
  await page.waitForTimeout(2500);
  await page.evaluate(()=>{const boss=window.__farmGame.scene.getScene('VisitScene').gorillaEncounter;for(let i=0;i<40;i++)boss.hit({x:195,y:400});});
  await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.gorillaEncounter?.result==='win');
  db.data.get('groups/A/users/bob').farm.cleanliness=30;
  const previousCleanCalls=calls.filter(call=>call.action==='helpClean').length;
  await page.evaluate(()=>{window.__queuedClean=window.__farmGame.scene.getScene('VisitScene').cleanTargetFarm().then(()=>window.__cleanAfterBattleDone=true);});
  assert.equal(calls.filter(call=>call.action==='helpClean').length,previousCleanCalls,'動畫勝利後仍須等待後端結算才送出清潔');
  releaseSettlement();
  await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.gorillaEncounter?.settled===true&&window.__cleanAfterBattleDone===true);
  assert.equal(db.data.get('groups/A/users/alice').farm.gorillaFangs,1);
  await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').cleanTargetFarm());
  assert.equal(db.data.get('groups/A/users/bob').farm.cleanliness,0);
  assert.deepEqual(await page.evaluate(()=>window.__farmGame.scene.getScenes(true).filter(s=>['MyFarmScene','VisitScene','ShopScene','WarehouseScene'].includes(s.scene.key)).map(s=>s.scene.key)),['VisitScene']);
  const completed=await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}});assert.equal(completed.challenges.mission.tasks[2].count,1);assert.equal(completed.challenges.mission.tasks[1].count,2);
  assert.ok(calls.some(c=>c.action==='battleAttack'));assert.ok(calls.some(c=>c.action==='battleSettle'));
  assert.ok(calls.some(c=>c.action==='stealEgg'||c.stealWhenClear));assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/nexus-private-farm-mobile.png'});
  await page.route('**/js/farm/main.js',r=>r.fulfill({contentType:'text/javascript',body:"throw Object.assign(Error('fixture startup error'),{code:'fixture/module'});"}));
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('[data-loading-status]')?.textContent.includes('遊戲程式載入失敗'));
  assert.ok(startupLogs.some(message=>message.includes('farm-startup-failure')&&message.includes('fixture/module')));
  assert.ok(startupLogs.some(message=>message.includes('farm-startup-failure')&&message.includes('game-module')));
  assert.ok((await page.locator('[data-loading-status]').textContent()).includes('初始化發生錯誤'));
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:503,body:'fixture engine unavailable'}));
  await page.reload();await page.waitForFunction(()=>document.querySelector('[data-loading-status]')?.textContent.includes('遊戲引擎載入失敗'));
  assert.ok(startupLogs.some(message=>message.includes('farm-startup-failure')&&message.includes('"stage":"engine"')));
  console.log('PASS real Phaser private-mode harvest, shop, visit cleaning, theft, real boss hits/settlement and daily progress; no client Firestore transaction writes; /tmp/nexus-private-farm-mobile.png');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
