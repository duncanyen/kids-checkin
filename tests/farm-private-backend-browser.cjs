// 真實 Phaser 場景＋真實後端服務＋隔離 SDK。所有直接 Firestore 寫入均拒絕。
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
const {MemoryDB}=require('../game-admin/tests/memory-db.cjs'),{createService}=require('../game-admin/functions/service.cjs'),I=require('../functions/identity-domain.cjs');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8032';
const navigationTests=process.env.NAVIGATION_LOAD_TESTS==='1',navigationBefore=process.env.NAVIGATION_LOAD_BEFORE==='1';
const guardRentalTests=process.env.GUARD_RENTAL_TESTS==='1';
const dailyGroupTests=process.env.DAILY_GROUP_TESTS==='1';
const weeklyRankingTests=process.env.WEEKLY_RANKING_TESTS==='1';
let legacyRankingPeriod=false;
const hornetTests=process.env.HORNET_TESTS==='1';
const katanaTests=process.env.KATANA_TESTS==='1';
const encounterConfigTests=process.env.ENCOUNTER_CONFIG_TESTS==='1';
const chestFlowTests=process.env.CHEST_FLOW_TESTS==='1';
const chestArtFail=process.env.CHEST_ART_FAIL==='1';
const predatorRewardTests=process.env.PREDATOR_REWARD_TESTS==='1';
const predatorRewardKind=process.env.PREDATOR_REWARD_KIND||'wolf';
const battleRewardTests=process.env.BATTLE_REWARD_TESTS==='1'||chestFlowTests;
const battleRewardKind=process.env.BATTLE_REWARD_KIND||'eagle';
const legacyBattlePageBackend=process.env.LEGACY_BATTLE_PAGE_BACKEND==='1';
const legacyHarvestBackend=process.env.LEGACY_HARVEST_BACKEND==='1';
const resumeMode=process.env.RESUME_PENDING_BATTLE;
const battleExitTests=process.env.BATTLE_EXIT_TESTS==='1';
const visitReturnTests=process.env.VISIT_RETURN_TESTS==='1';
const visitReturnTheme=process.env.VISIT_RETURN_THEME==='default'?'default':'fuji';
const visitPreloadTests=navigationTests||hornetTests||katanaTests||encounterConfigTests||process.env.VISIT_PRELOAD_TESTS==='1'||visitReturnTests||predatorRewardTests;
const dragonStartupTests=process.env.DRAGON_STARTUP_TESTS==='1';
const legacyAnnouncements=process.env.LEGACY_ANNOUNCEMENT_BACKEND==='1';
const costTests=process.env.FARM_READ_COST_TESTS==='1';
const arcticSceneTests=process.env.ARCTIC_SCENE_TESTS==='1';
const sceneTests=process.env.FARM_SCENE_TESTS==='1'||arcticSceneTests;
const ownCleanTests=process.env.OWN_COOP_CLEAN_TESTS==='1';
const crossSelfCleanTests=process.env.CROSS_GROUP_SELF_CLEAN_TESTS==='1';
const coopCleanTests=process.env.COOP_CLEAN_TESTS==='1'||crossSelfCleanTests;
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
 const feedResponses=[];
 const db=new MemoryDB(),stamp=stealResultTests||weeklyRankingTests?Date.parse('2026-11-23T10:00:00+08:00'):Date.now(),tokens=new Map(),calls=[],errors=[];let cleanGate=null,cleanDenied=false,lateCleanReply=false;let stealDelay=0,timeoutStealAlways=false,lateReplyOnce=false;let sequence=0,serverRoll=battleRewardTests?(battleRewardKind==='eagle'?.1:0):entryEncounterTests||dragonStartupTests?0:.99,releaseSettlement,feedGate=null,feedEntered=null,releaseHarvest,releaseCollection,failCollection=false,visitGate=null,failVisitOnce=false,backendNow=stamp,lastStealResult=null,failSteal=false,failBattleSettlement=false,lastBattleResult=null,chestReplyDelay=0;
 const harvestGate=new Promise(resolve=>releaseHarvest=resolve);
 const collectionGate=new Promise(resolve=>releaseCollection=resolve);
 const settlementGate=new Promise(resolve=>releaseSettlement=resolve);
 let releaseEntryGate;const entryGate=new Promise(resolve=>releaseEntryGate=resolve);
 const farm={coins:12345,hens:1,hensState:[{id:'hen1',breed:'hen',laidAt:stamp,isSick:false}],poultryVersion:2,lastLayTime:stamp,readyEggs:{hen:3,silkie:0,bresse:0,onagadori:0},eggsReady:3,warehouseLimit:100,coopLevel:3,cleanliness:30,equippedWeapon:'club',worms:2,earthworms:3};
 if(dragonStartupTests)farm.coopLevel=2;
 if(predatorRewardTests)Object.assign(farm,{equippedWeapon:'ironhammer',ironhammer:1});
 if(hornetTests)Object.assign(farm,{shortbow:1,huntingbow:1,paladinbow:1,equippedBow:'paladinbow'});
 if(battleRewardTests)Object.assign(farm,{equippedWeapon:'ironhammer',ironhammer:1,equippedBow:'paladinbow',paladinbow:1});
 db.data.set('groups/A',{name:'隔離測試村落',members:['alice','bob'],farmVillageVisibility:'public'});
 db.data.set('ops_identity_state/global',{ready:true,farmReady:true});
 for(const id of ['alice','bob']){db.data.set('users/'+id,{accountId:id,name:id,role:'member'});db.data.set('groups/A/users/'+id,{farm:structuredClone(farm)});db.data.set('ops_identity_credentials/'+id,{authUid:I.profileUid(id),accountId:id,sessionVersion:1,disabled:false});}
 if(encounterConfigTests||weeklyRankingTests||dailyGroupTests||guardRentalTests||navigationTests||arcticSceneTests){const E=require('../game-admin/functions/encounters.cjs');const config=structuredClone(E.DEFAULTS);for(const value of Object.values(config))value.enabled=false;db.data.set('ops_game_config/encounters',{monsters:config,revision:1});}
 if(hornetTests){const E=require('../game-admin/functions/encounters.cjs'),m=structuredClone(E.DEFAULTS);for(const v of Object.values(m))v.enabled=false;m.hornet.enabled=true;m.hornet.home.rate=m.hornet.visit.rate=100;db.data.set('ops_game_config/encounters',{monsters:m,revision:1});}
 const pendingKey='ops_farm_active/'+I.hash('alice:A');
 if(resumeMode)db.data.set(pendingKey,{id:'resume-gorilla',kind:'gorilla',groupId:'A',targetGroupId:'A',targetAccountId:resumeMode==='visit'?'bob':'alice',startedAt:stamp-1000,approachEndsAt:stamp-1,deadline:stamp+40000,health:700,attacks:{melee:1,ranged:0}});
 const token={nexusProfileId:'alice',nexusAccountId:'alice',nexusSessionVersion:1,photoGroupId:'A',photoAccountId:'alice'},auth={uid:I.profileUid('alice'),token};
 if(stealResultTests||entryEncounterTests||coopCleanTests||visitPreloadTests||battleExitTests){db.data.set('groups/B',{name:'另一座公開村落',members:['bob'],farmVillageVisibility:'public'});db.data.set('groups/B/users/bob',{farm:{...structuredClone(farm),hens:2,hensState:[{id:'flower',name:'花花',breed:'silkie',laidAt:stamp},{id:'rice',name:'米粒',breed:'silkie',laidAt:stamp}],readyEggs:{hen:0,silkie:3,bresse:0,onagadori:0}}});}
 if(coopCleanTests||visitPreloadTests){db.data.get('users/bob').name='村長 Bob';db.data.set('groups/C',{name:'另一個公開村落',members:['carol'],farmVillageVisibility:'public'});db.data.set('users/carol',{accountId:'carol',name:'Carol 村長',role:'member'});db.data.set('groups/C/users/carol',{farm:structuredClone(farm)});}
 if(visitReturnTests){Object.assign(db.data.get('groups/A/users/alice').farm,{ownedSceneIds:['fuji'],activeSceneId:visitReturnTheme,cleanliness:70});Object.assign(db.data.get('groups/C/users/carol').farm,{ownedSceneIds:['fuji'],activeSceneId:'fuji',cleanliness:70});}
 if(crossSelfCleanTests){db.data.get('groups/A/users/alice').farm.moral=40;db.data.get('groups/B').members=['alice'];db.data.set('groups/B/users/alice',{farm:{...structuredClone(farm),cleanliness:70}});}
 if(ownCleanTests)Object.assign(db.data.get('groups/A/users/alice').farm,{cleanliness:70,moral:40});
 if(costTests){db.data.set('ops_feed_versions/global',{revision:'v1'});db.data.set('ops_announcements/read-test',{title:'初始公告',content:'測試內容',status:'published',priority:1,targetType:'all',targetAccountIds:[],audienceKeys:['all'],startAt:stamp-100,endAt:stamp+3600000,createdAt:stamp,updatedAt:stamp,showPopup:false});db.data.get('groups/A/users/bob').farm.stolenEggs20261123=50;}
 if(predatorRewardTests)db.data.get('groups/B/users/bob').farm.coopLevel=1;
 if(battleRewardTests&&!chestFlowTests)db.data.set('ops_game_config/chests',{revision:1,monsters:Object.fromEntries(Object.entries(require('../game-admin/functions/chests.cjs').DEFAULTS).map(([kind,value])=>[kind,{...value,dropRate:0}]))});
 if(chestFlowTests)db.data.set('ops_game_config/chests',{revision:1,monsters:{eagle:{dropRate:100,coins:{enabled:true,min:137,max:137},items:[]}}});
 if(dailyGroupTests){db.data.set('groups/B',{name:'另一個群組',members:['alice'],farmVillageVisibility:'public'});db.data.set('groups/B/users/alice',{farm:structuredClone(farm)});}
 const service=createService({db,auth:{getUser:async()=>({disabled:false})},now:()=>weeklyRankingTests||hornetTests||readOptimizationTests||stealResultTests||entryEncounterTests||battleExitTests?backendNow:Date.now(),privateIdentityEnabled:()=>true,farmBackendEnabled:()=>true,farmRandom:()=>typeof serverRoll==='function'?serverRoll():serverRoll});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({serviceWorkers:'block',viewport:{width:390,height:844},hasTouch:guardRentalTests}),startupLogs=[];page.on('console',message=>{if(message.type()==='error')startupLogs.push(message.text());if(message.text().includes('farm-entry-encounter'))console.log(message.text());});page.setDefaultTimeout(15000);page.on('pageerror',e=>{errors.push(e.message);if(visitReturnTests)console.error('RETURN_PAGE_ERROR',e.stack);});
  await page.exposeFunction('__saveDb',async op=>{if(op.kind==='query')return [...db.data].filter(([key,value])=>key.startsWith(op.path+'/')&&key.split('/').length===op.path.split('/').length+1&&(op.filters||[]).every(f=>f.op==='in'?f.value.includes(value[f.field]):value[f.field]===f.value)).map(([path,data])=>({path,data}));if(op.kind==='get')return structuredClone(db.data.get(op.path));throw Error('Private mode attempted direct Firestore write: '+op.kind);});
  await page.exposeFunction('__privateServer',async(name,data)=>{
   if(legacyBattlePageBackend&&data.action==='beginBattlePage')return{__fixtureError:{code:'functions/invalid-argument',message:'選項無效 [400]'}};
   if(battleRewardTests&&data.action==='battleSettle'&&failBattleSettlement)return{__fixtureError:{code:'functions/unavailable',message:'隔離測試：入庫交易暫時失敗'}};
   calls.push({name,action:data.action,requestId:data.requestId,verifyOnly:data.verifyOnly===true,collectWhenClear:data.collectWhenClear===true,stealWhenClear:data.stealWhenClear===true});
   if(stealFlowTests&&data.stealWhenClear&&stealDelay)await new Promise(resolve=>setTimeout(resolve,stealDelay));
   if(coopCleanTests&&data.action==='helpClean'||ownCleanTests&&data.action==='cleanOwn'){if(cleanDenied)return{__fixtureError:{code:'functions/permission-denied',message:'隔離測試：清潔被拒絕'}};if(cleanGate)await cleanGate;}
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
   if(name==='gameOpsFarmTransaction'){if(entryEncounterTests&&data.action==='homeEncounter'&&!data.collectWhenClear&&!data.verifyOnly)await entryGate;if(data.action==='homeEncounter'&&data.collectWhenClear)await harvestGate;if(data.action==='collectEggs')await collectionGate;if(data.action==='battleSettle')await settlementGate;const gate=data.action==='feedPoultry'?feedGate:null;let response;try{response=await service.farmTransaction(request);}catch(error){if(chestFlowTests&&data.action==='openChest'||sceneTests&&['buyScene','setScene'].includes(data.action)||coopCleanTests&&data.action==='helpClean'||ownCleanTests&&data.action==='cleanOwn')return{__fixtureError:{code:'functions/'+(error.code||'internal'),message:error.message}};throw error;}if((coopCleanTests&&data.action==='helpClean'||ownCleanTests&&data.action==='cleanOwn')&&lateCleanReply){lateCleanReply=false;await new Promise(resolve=>setTimeout(resolve,350));}const steal=response.result?.steal||(data.action==='stealEgg'?response.result:null);if(steal){lastStealResult=structuredClone(steal);if(oldStealResultFields)for(const key of ['transactionId','totalEggs','eggBreed','eggSources'])delete steal[key];}if(stealFlowTests&&data.stealWhenClear&&lateReplyOnce){lateReplyOnce=false;await new Promise(resolve=>setTimeout(resolve,350));}
if(stealFlowTests&&data.stealWhenClear&&timeoutStealAlways)await new Promise(resolve=>setTimeout(resolve,550));
if(battleRewardTests&&data.action==='battleSettle')lastBattleResult=structuredClone(response.result);
if(chestFlowTests&&data.action==='openChest'&&chestReplyDelay)await new Promise(resolve=>setTimeout(resolve,chestReplyDelay));
if(katanaTests||hornetTests||dailyGroupTests||arcticSceneTests)await page.evaluate(()=>window.__privateEmitAll?.());
if(legacyDailyProgress)delete response.dailyProgress;if(gate){feedEntered?.();await gate;}return response;}
   if(name==='gameOpsDailyChallenges'){const result=await service.dailyChallenges(request);if(dailyGroupTests&&data.action==='claim')await page.evaluate(()=>window.__privateEmitAll?.());return result;}
   if(name==='gameOpsAnnouncements'){const result=await service.announcements(legacyAnnouncements?{...request,data:{...request.data,action:undefined}}:request);if(weeklyRankingTests&&legacyRankingPeriod&&data.action==='ranking')result.scoreField='stolenEggs20261116';if(costTests)feedResponses.push({action:data.action,notModified:!!result.notModified,rows:result.rows?.length});return result;}
   if(name==='gameOpsGuardDog'){const result=await service.guardDog(request);if(guardRentalTests)await page.evaluate(()=>window.__privateEmitAll?.());return result;}
   throw Error('Unexpected callable '+name);
  });
  const old=fs.readFileSync('tests/farm-save-browser.cjs','utf8').match(/const sdk = `([\s\S]*?)`;/)[1];
  const querySDK=costTests||sceneTests||stealFlowTests||entryEncounterTests||coopCleanTests||visitPreloadTests||battleExitTests?old.replace('export const getDocs=async()=>({empty:true,docs:[],forEach:()=>{}});',`export const getDocs=async ref=>{const rows=await window.__saveDb({kind:'query',...ref});const docs=rows.map(row=>snap(row.path,row.data));return{empty:!docs.length,docs,forEach:fn=>docs.forEach(fn)};};`):old;
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
  const navigationProbe=navigationTests?await require('./helpers/farm-navigation-loading.cjs').setup(page,navigationBefore):null;
  let releaseStealAssets,heldAssets=0;const assetGate=new Promise(resolve=>releaseStealAssets=resolve);
  if(holdStealAssets){await page.route('**/js/farm/steal-result-ui.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('export const prepareStealResultAssets',"for(const key in assets)assets[key]+='?held-assets';\nexport const prepareStealResultAssets")});});await page.route('**/*?held-assets',async r=>{heldAssets++;await assetGate;await r.continue();});}
  if(stealFlowTests||coopCleanTests||ownCleanTests||chestFlowTests)await page.route('**/js/farm/operations-client.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('reject(timeoutFailure()),timeoutMs);','reject(timeoutFailure()),globalThis.__fixtureTimeoutMs||timeoutMs);')});});
  if(flowBefore)await page.route('**/css/farm-egg-result.css*',r=>r.fulfill({contentType:'text/css',body:require('node:child_process').execFileSync('git',['show','3517dab:css/farm-egg-result.css'],{encoding:'utf8'})}));
  if(flowBefore)for(const file of ['VisitScene.js','backend-client.js','egg-result-ui.js','steal-result-ui.js'])await page.route('**/js/farm/'+file+'*',r=>r.fulfill({contentType:'text/javascript',body:require('node:child_process').execFileSync('git',['show','3517dab:js/farm/'+file],{encoding:'utf8'})}));
  if(dailyGroupTests)await page.addInitScript(()=>{const group=new URLSearchParams(location.search).get('daily-group')==='B'?'B':'A';sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',docId:'alice',groupId:group,name:'Alice'}));localStorage.setItem('lastGroupId',group);sessionStorage.setItem('nexus_active_group_id',group);});else await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',docId:'alice',groupId:'A',name:'Alice'}));localStorage.setItem('lastGroupId','A');sessionStorage.setItem('nexus_active_group_id','A');});
  if(unavailableEggResult==='module')await page.route('**/js/farm/egg-result-ui.js',r=>r.fulfill({status:503,contentType:'text/javascript',body:'fixture optional module unavailable'}));
  if(unavailableEggResult==='image')await page.route('**/assets/farm/egg-result/v1/egg_result_panel.png',r=>r.fulfill({status:503,body:'fixture optional image unavailable'}));
  if(stealResultTests||entryEncounterTests||battleExitTests)await page.clock.setFixedTime(new Date(stamp));
  if(hornetTests||weeklyRankingTests)await page.clock.install({time:new Date(stamp)});
  if(costTests)await page.clock.install({time:new Date(stamp)});
  await page.goto(base+'/farmgame.html');await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.coins===12345);
  if(!resumeMode&&!entryEncounterTests)await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').entryChecked===true);
  if(navigationTests){releaseSettlement();await require('./helpers/farm-navigation-loading.cjs').run({page,probe:navigationProbe,before:navigationBefore,calls,db,errors});return;}
  if(guardRentalTests){
   releaseSettlement();const own=()=>db.data.get('groups/A/users/alice').farm;
   await page.locator('.farm-hud-bottom button[aria-label="商店"]').tap();await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene')&&window.__farmGame.scene.getScene('ShopScene').categoryTabs);
   const tap=async find=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const p=await page.evaluate(find=>{const s=window.__farmGame.scene.getScene('ShopScene'),o=find==='dogs'?s.categoryTabs.tabs.get('dogs').background:s.buyContainer.list.find(o=>o.catalogKey==='guard:'+find&&o.input?.enabled),w=o.getWorldTransformMatrix().transformPoint(0,0),v=s.cameras.main.matrix.transformPoint(w.x-s.cameras.main.scrollX,w.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+v.x/s.scale.width*r.width,y:r.y+v.y/s.scale.height*r.height};},find);await page.touchscreen.tap(p.x,p.y);};
   await tap('dogs');
   const dialog=page.locator('[data-guard-dog-dialog]'),input=page.locator('#guard-rental-days');
   for(const viewport of [{width:390,height:844},{width:320,height:568},{width:430,height:932}]){
    await page.setViewportSize(viewport);await tap('corgi');await dialog.getByRole('heading',{name:'租用柯基犬',exact:true}).waitFor();
    const before=calls.filter(c=>c.name==='gameOpsGuardDog').length;
    for(const days of [7,1,7]){await dialog.getByRole('button',{name:days+' 天',exact:true}).tap();await page.waitForTimeout(150);assert.equal(await input.inputValue(),String(days));assert.equal(await dialog.getByRole('heading').textContent(),'租用柯基犬');assert.equal(await dialog.locator('.guard-dog-price').textContent(),days===7?'7 天 · 500 金幣':'1 天 · 100 金幣');}
    assert.equal(calls.filter(c=>c.name==='gameOpsGuardDog').length,before,'presets only change the current dialog');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').input.enabled),false);
    await page.screenshot({path:'/tmp/gugu-corgi-seven-days-'+viewport.width+'.png'});await dialog.getByRole('button',{name:'取消',exact:true}).tap();assert.equal(await dialog.count(),0);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').input.enabled),true);
   }
   assert.equal(own().coins,12345);own().coins=400;await page.evaluate(()=>window.__privateEmitAll());await tap('corgi');await dialog.getByRole('button',{name:'7 天',exact:true}).tap();await dialog.getByRole('button',{name:'確認租用',exact:true}).tap();await dialog.locator('.guard-dog-error').filter({hasText:'金幣不足'}).waitFor();assert.equal(await input.inputValue(),'7');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').input.enabled),false);assert.equal(own().guardDogs?.length||0,0);assert.equal(own().coins,400);await dialog.getByRole('button',{name:'取消',exact:true}).tap();assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').input.enabled),true);own().coins=12345;await page.evaluate(()=>window.__privateEmitAll());await tap('corgi');await dialog.getByRole('button',{name:'7 天',exact:true}).tap();await dialog.getByRole('button',{name:'確認租用',exact:true}).tap();await dialog.waitFor({state:'detached'});assert.equal(own().coins,11845);assert.equal(own().guardDogs.length,1);assert.equal(own().guardDogs[0].breedId,'corgi');assert.equal(own().guardDogs[0].days,7);assert.equal(own().guardDogs[0].remainingMs,7*86400000);assert.equal(own().guardDogs[0].startedAt,null);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').input.enabled),true);
   await tap('beagle');await dialog.getByRole('heading',{name:'租用米格魯',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').input.enabled),true);await tap('beagle');await dialog.getByRole('heading',{name:'租用米格魯',exact:true}).waitFor();await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('MyFarmScene'));await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').entryChecked);await page.locator('.farm-hud-bottom button[aria-label=商店]').tap();await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').input.enabled),true);await tap('dogs');await tap('beagle');await dialog.getByRole('heading',{name:'租用米格魯',exact:true}).waitFor();await dialog.getByRole('button',{name:'取消',exact:true}).tap();assert.deepEqual(errors,[]);
   console.log('PASS actual shop touch entry: corgi 1/7 day presets retain breed/price at320/390/430px, no background catalogue requests, cancel/Escape/error/scene-exit restore input, one seven-day lease costs500 and waits in warehouse');return;
  }
  if(dailyGroupTests){
   releaseSettlement();releaseHarvest();releaseCollection();const farmOf=g=>db.data.get(`groups/${g}/users/alice`).farm;
   const tasks=page.locator('.farm-hud-side button[aria-label="每日任務"]'),claim=page.locator('.farm-daily-claim'),close=page.locator('.farm-daily-close');
   const open=async()=>{await tasks.click();await page.waitForFunction(()=>document.querySelector('.farm-daily-claim')?.textContent==='立即簽到'||document.querySelector('.farm-daily-claim')?.textContent==='今日已領取');};
   await open();await claim.click();await page.waitForFunction(()=>document.querySelector('.farm-daily-status').textContent.includes('領取成功'));assert.equal(farmOf('A').coins,12445);assert.equal(farmOf('B').coins,12345);await close.click();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').harvestEgg());await page.locator('[data-result-kind=harvest] button[aria-label=確定]').click();
   await open();await page.getByRole('tab',{name:'每日任務',exact:true}).click();assert.deepEqual(await page.locator('.farm-daily-count').allTextContents(),['1/3','0/3','0/3']);await page.screenshot({path:'/tmp/gugu-daily-group-A-progress.png'});await close.click();
   token.photoGroupId='B';await page.goto(base+'/farmgame.html?daily-group=B',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.entryChecked);
   await open();assert.equal(await page.getByRole('tab',{name:'每日簽到',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await claim.isEnabled(),true);await page.screenshot({path:'/tmp/gugu-daily-group-B-checkin.png'});await claim.click();await page.waitForFunction(()=>document.querySelector('.farm-daily-status').textContent.includes('領取成功'));assert.equal(farmOf('B').coins,12445);assert.equal(farmOf('A').coins,12445);
   await page.getByRole('tab',{name:'每日任務',exact:true}).click();assert.deepEqual(await page.locator('.farm-daily-count').allTextContents(),['0/3','0/3','0/3']);await page.screenshot({path:'/tmp/gugu-daily-group-B-progress.png'});await close.click();
   token.photoGroupId='A';await page.goto(base+'/farmgame.html?daily-group=A',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.entryChecked);await tasks.click();await page.waitForFunction(()=>document.querySelector('.farm-daily-claim').textContent==='領取獎勵');assert.deepEqual(await page.locator('.farm-daily-count').allTextContents(),['1/3','0/3','0/3']);await page.getByRole('tab',{name:'每日簽到',exact:true}).click();assert.equal(await claim.textContent(),'今日已領取');assert.equal(await claim.isDisabled(),true);await close.click();assert.deepEqual(errors,[]);
   console.log('PASS actual daily launcher: same account A/B separate checkins and wallets, A harvest progress does not enter B, per-group saved tabs/caches, reload retains A claim without duplicate grant');return;
  }
  if(weeklyRankingTests){
   releaseSettlement();const owner=db.data.get('groups/A/users/alice').farm;
   owner.stolenEggs20261116=999;owner.monsterKills20261116=888;
   const panel=page.locator('.farm-ranking-panel'),launcher=page.getByRole('button',{name:'開啟排行榜',exact:true});
   const loaded=()=>page.waitForFunction(()=>document.querySelector('.farm-ranking-content').getAttribute('aria-busy')==='false');
   await launcher.click();await loaded();assert.equal(await panel.locator('.farm-ranking-row').count(),0);assert.match(await panel.locator('.farm-ranking-period').textContent(),/2026\/11\/23 06:00:00～2026\/11\/30 00:00:00/);
   await panel.getByRole('tab',{name:'打怪王',exact:true}).click();await loaded();assert.match(await panel.locator('.farm-ranking-empty').textContent(),/擊退怪物/);assert.doesNotMatch(await panel.locator('.farm-ranking-status').textContent(),/偷蛋/);
   // Apply an actual server-validated kill, reward and replay, then query it via the normal ranking button.
   const current=db.data.get(pendingKey),id='weekly-ranked-wolf',beforeCoins=owner.coins;
   Object.assign(owner,{ironhammer:1,equippedWeapon:'ironhammer'});
   db.data.set(pendingKey,{...current,id,kind:'wolf',groupId:'A',targetGroupId:'A',targetAccountId:'alice',health:200,startedAt:backendNow-4000,deadline:backendNow+60000,attacks:{melee:0,ranged:0},result:undefined});
   const command=async(action,extra={})=>service.farmTransaction({auth,data:{groupId:'A',battlePageId:current.ownerPageId,action,battleId:id,requestId:'weekly-'+action,...extra}});
   await command('battleAttack',{mode:'melee',count:2});await command('battleSettle');await command('battleSettle');
   assert.equal(db.data.get('groups/A/users/alice').farm.monsterKills20261123,1);assert.equal(db.data.get('groups/A/users/alice').farm.wolfFangs,1);assert.equal(db.data.get('groups/A/users/alice').farm.coins,beforeCoins);
   Object.assign(db.data.get('groups/A/users/bob').farm,{stolenEggs20261123:7,monsterKills20261123:1025});
   db.data.set('groups/Closed',{name:'私密村落',farmVillageVisibility:'closed',members:['alice']});db.data.set('groups/Closed/users/alice',{farm:{stolenEggs20261123:99999,monsterKills20261123:99999}});
   await panel.getByRole('button',{name:'重新整理',exact:true}).click();await loaded();assert.equal(await panel.locator('.farm-ranking-row').count(),2);assert.match(await panel.locator('.farm-ranking-row').first().textContent(),/bob.*1,025 隻/);assert.match(await panel.locator('.farm-ranking-row').nth(1).textContent(),/alice.*1 隻/);assert.equal(await panel.getByRole('tab',{name:'打怪王',exact:true}).getAttribute('aria-selected'),'true');
   for(const viewport of [{width:390,height:844},{width:320,height:568},{width:768,height:1024}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await panel.getByRole('tab',{name:'打怪王',exact:true}).isVisible(),true);await page.screenshot({path:'/tmp/gugu-monster-ranking-'+viewport.width+'.png'});
   }
   await page.setViewportSize({width:390,height:844});await panel.getByRole('tab',{name:'偷蛋王',exact:true}).click();await loaded();assert.equal(await panel.locator('.farm-ranking-row').count(),1);assert.match(await panel.locator('.farm-ranking-score').textContent(),/7 顆/);await page.screenshot({path:'/tmp/gugu-theft-ranking-20261123.png'});
   await panel.getByRole('button',{name:'關閉',exact:true}).click();legacyRankingPeriod=true;await launcher.click();await loaded();assert.match(await panel.locator('.farm-ranking-status').textContent(),/服務正在同步/);assert.equal(await panel.locator('.farm-ranking-row').count(),0);await panel.getByRole('button',{name:'關閉',exact:true}).click();legacyRankingPeriod=false;assert.equal(await page.evaluate(()=>window.__farmGame.input.enabled),true);assert.deepEqual(errors,[]);
   console.log('PASS weekly rankings from game launcher: archive reset, actual validated wolf kill/replay, both tabs, new dates, query privacy, 1,025 kills, refresh retains tab, 320/390/768px and scene input restored');return;
  }
  if(hornetTests){
   releaseSettlement();const own=()=>db.data.get('groups/A/users/alice').farm;
   const progress=async()=>(await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}})).challenges.mission.tasks.find(t=>t.type==='DEFEAT_MONSTER').count;
   const point=(key,x,y)=>page.evaluate(({key,x,y})=>{const s=window.__farmGame.scene.getScene(key),p=s.cameras.main.matrix.transformPoint(x-s.cameras.main.scrollX,y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},{key,x,y});
   const click=async(key,find)=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const p=await page.evaluate(({key,find})=>{const s=window.__farmGame.scene.getScene(key);let o;
    if(find==='hornet')o=s.hornetEncounter.sprite;else if(find==='bow')o=s.hornetEncounter.archery.button;else if(find==='back')o=s.children.list.find(o=>o.input?.enabled&&o.x===55&&o.y===60);
    else if(find==='other')o=s.categoryTabs.tabs.get('other').background;else if(find==='sell')o=s.children.list.find(o=>o.input?.enabled&&o.x===290&&o.y===180);else if(find==='honey')o=s.sellContainer.list.find(o=>o.catalogKey==='honey'&&o.input?.enabled);else if(find==='confirm')o=s.dialogContainer.list.find(o=>o.input?.enabled&&o.x===130&&o.y===505);
    else if(find==='public')o=s.publicVillageButton;else if(find==='village')o=s.content.list.find(o=>o.getData('villageGroupId')==='B');else if(find==='farm')o=s.content.list.find(o=>o.texture?.key==='coop');
    if(!o)throw Error('Missing hornet test target '+find);const world=o.getWorldTransformMatrix().transformPoint(0,0);return{x:world.x,y:world.y};},{key,find}),q=await point(key,p.x,p.y);await page.mouse.click(q.x,q.y);};
   await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').hornetEncounter?.sprite?.active);
   assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').hornetEncounter.health),600);
   await page.waitForTimeout(2200);await page.screenshot({path:'/tmp/gugu-hornet-home.png'});
   const beforeHit=calls.filter(c=>c.action==='battleAttack').length;await click('MyFarmScene','hornet');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').hornetEncounter.health),600);assert.equal(calls.filter(c=>c.action==='battleAttack').length,beforeHit);
   await page.locator('.farm-hud-bottom button[aria-label="倉庫"]').dispatchEvent('click');assert.equal(await page.evaluate(()=>window.__farmGame.scene.isActive('WarehouseScene')),false);
   // Stabilize only target movement for repeatable projectile collision testing.
   // Screenshots above and pure route tests cover the actual moving entry route.
   await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),b=s.hornetEncounter;s.events.off('update',b.motion);b.animateHornet=()=>{};b.sprite.setPosition(195,350);});
   backendNow=stamp+18000;await click('MyFarmScene','bow');
   for(let i=0;i<14;i++){
    if(await page.evaluate(()=>!!window.__farmGame.scene.getScene('MyFarmScene').hornetEncounter.result))break;
    const aim=await page.evaluate(()=>{const b=window.__farmGame.scene.getScene('MyFarmScene').hornetEncounter,o=b.archery.bow,r=b.sprite.getBounds(),t=.45;return{x:o.x,y:o.y,px:o.x-(r.centerX-o.x)/t/9,py:o.y-((r.centerY-o.y)/t-180*t)/9};}),a=await point('MyFarmScene',aim.x,aim.y),z=await point('MyFarmScene',aim.px,aim.py);
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(z.x,z.y,{steps:5});await page.mouse.up();await page.waitForTimeout(650);
   }
   const reward=page.locator('[data-result-kind=battle]');await reward.waitFor();assert.match(await reward.textContent(),/擊退 虎頭蜂/);assert.match(await reward.textContent(),/蜂蜜/);assert.equal(own().honey,1);assert.equal(own().coins,12345);assert.equal(await progress(),1);assert.equal(await reward.locator('.farm-battle-reward-row:not(.is-empty)').count(),1);assert.equal(await reward.locator('.farm-battle-reward-row.is-empty').count(),2);await page.screenshot({path:'/tmp/gugu-hornet-victory.png'});await page.setViewportSize({width:320,height:568});await page.waitForTimeout(150);assert.equal(await reward.locator('button[aria-label=確定]').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/gugu-hornet-victory-small.png'});await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
   await reward.locator('button[aria-label=確定]').click();await page.locator('.farm-hud-bottom button[aria-label="倉庫"]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));await click('WarehouseScene','other');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').visibleWarehouseItems.some(i=>i.key==='honey')),true);await page.screenshot({path:'/tmp/gugu-honey-warehouse.png'});await click('WarehouseScene','back');await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').entryChecked);
   await page.locator('.farm-hud-bottom button[aria-label="商店"]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));await click('ShopScene','sell');await click('ShopScene','other');await click('ShopScene','honey');assert.match(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').dialogSubText.text),/300/);await page.screenshot({path:'/tmp/gugu-honey-sale.png'});await click('ShopScene','confirm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData.honey===0);assert.equal(own().coins,12645);await click('ShopScene','back');await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').entryChecked);
   own().coins=50;await page.evaluate(()=>window.__privateEmitAll());const targetBefore=structuredClone(db.data.get('groups/B/users/bob').farm);
   await page.locator('.farm-hud-bottom button[aria-label="村落"]').click();await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.farms?.length>0);await click('LobbyScene','public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');await click('LobbyScene','village');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B'&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);await click('LobbyScene','farm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.hornetEncounter?.sprite?.active&&window.__farmGame.scene.getScene('VisitScene').entryChecked);
   await page.screenshot({path:'/tmp/gugu-hornet-visit.png'});backendNow=db.data.get(pendingKey).deadline+1;await page.clock.fastForward(51000);await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').hornetEncounter?.settled);assert.equal(own().coins,0);assert.equal(own().honey,0);assert.equal(await progress(),1);assert.deepEqual(db.data.get('groups/B/users/bob').farm,targetBefore);assert.match(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').hornetEncounter.warning.text),/扣除 50 金幣/);await page.screenshot({path:'/tmp/gugu-hornet-timeout.png'});assert.deepEqual(errors,[]);
   console.log('PASS hornet real home/public entry, melee no-op, bow projectile victory, honey warehouse/sale300, visit timeout caps actor loss at50 with target intact, one verified daily event');return;
  }
  if(katanaTests){
   releaseSettlement();const own=()=>db.data.get('groups/A/users/alice').farm;
   const click=async(key,find)=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const point=await page.evaluate(({key,find})=>{const s=window.__farmGame.scene.getScene(key);let o;
    if(find==='weapons')o=s.categoryTabs.tabs.get('weapons').background;
    else if(find==='buykatana'||find==='sellkatana')o=s[find==='buykatana'?'buyContainer':'sellContainer'].list.find(o=>o.catalogKey==='katana'&&o.input?.enabled);
    else if(find==='confirm')o=s.dialogContainer.list.find(o=>o.input?.enabled&&o.x===130&&o.y===505);
    else if(find==='selltab')o=s.children.list.find(o=>o.input?.enabled&&o.x===290&&o.y===180);
    else if(find==='back')o=s.children.list.find(o=>o.input?.enabled&&o.x===55&&o.y===60);
    else if(find==='item')o=s.itemsPanel.list.find(o=>o.input?.enabled);
    else if(find==='equip')o=s.btnFeed;
    else if(find==='public')o=s.publicVillageButton;
    else if(find==='village')o=s.content.list.find(o=>o.getData('villageGroupId')==='B');
    else if(find==='farm')o=s.content.list.find(o=>o.texture?.key==='coop');
    else if(find==='wolf')o=s.wolf;
    if(!o)throw Error('Missing UI object '+key+':'+find);
    const p=o.getWorldTransformMatrix().transformPoint(0,0),camera=s.cameras.main,r=s.game.canvas.getBoundingClientRect(),q=camera.matrix.transformPoint(p.x-camera.scrollX,p.y-camera.scrollY);return{x:r.x+q.x/s.scale.width*r.width,y:r.y+q.y/s.scale.height*r.height};},{key,find});await page.mouse.click(point.x,point.y);};
   const home=()=>page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').entryChecked);
   const shop=async()=>{await page.locator('.farm-hud-bottom button[aria-label="商店"]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene')&&!!window.__farmGame.scene.getScene('ShopScene').farmData);await click('ShopScene','weapons');};
   const warehouse=async()=>{await page.locator('.farm-hud-bottom button[aria-label="倉庫"]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene')&&!!window.__farmGame.scene.getScene('WarehouseScene').farmData);await click('WarehouseScene','weapons');};
   own().coins=1100000;await page.evaluate(()=>window.__privateEmitAll());await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').farmData.coins===1100000);
   await shop();await page.screenshot({path:'/tmp/gugu-katana-shop.png'});
   await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('ShopScene');window.__katanaGuide=s.weaponGuide.list.filter(o=>o.type==='Text').map(o=>o.text).join('\n');});assert.match(await page.evaluate(()=>window.__katanaGuide),/武士刀/);
   const purchases=()=>calls.filter(c=>c.action==='buyWeapon').length;
   await click('ShopScene','buykatana');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').dialogContainer.visible),false);assert.match(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').msgText.text),/尚未開賣/);assert.equal(purchases(),0);assert.equal(own().coins,1100000);assert.equal(own().katana,undefined);
   await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('ShopScene');s.openTradeModal('buy','katana','武士刀',1);await s.executeBuyWeapon('katana',1,1);});assert.equal(purchases(),0);assert.equal(own().coins,1100000);
   await assert.rejects(service.farmTransaction({auth,data:{groupId:'A',action:'buyWeapon',item:'katana',quantity:1,price:1,purchasable:true,requestId:require('node:crypto').randomUUID(),battlePageId:db.data.get(pendingKey).ownerPageId}}),error=>error.code==='failed-precondition'&&error.message.includes('尚未開賣'));assert.equal(own().coins,1100000);assert.equal(own().katana,undefined);
   await page.screenshot({path:'/tmp/gugu-katana-unreleased.png'});
   own().katana=2; // Existing-owner fixture; no successful purchase is simulated.
   await page.evaluate(()=>window.__privateEmitAll());
   await click('ShopScene','back');await home();await warehouse();await click('WarehouseScene','item');await click('WarehouseScene','equip');await page.waitForFunction(()=>window.__farmGame.scene.getScene('WarehouseScene').farmData.equippedWeapon==='katana');await page.screenshot({path:'/tmp/gugu-katana-warehouse.png'});
   const coldPolicy=structuredClone(require('../game-admin/functions/encounters.cjs').DEFAULTS);for(const value of Object.values(coldPolicy))value.enabled=false;coldPolicy.gorilla.enabled=true;coldPolicy.gorilla.home.rate=100;db.data.set('ops_game_config/encounters',{monsters:coldPolicy,revision:1});
   await page.reload({waitUntil:'domcontentloaded'});await home();assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').farmData.equippedWeapon),'katana');assert.equal(own().katana,2);
   assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter.weaponSprite.texture.key),'katana','cold home boss must load equipped sword art before creating its attack sprite');await page.screenshot({path:'/tmp/gugu-katana-cold-gorilla.png'});
   coldPolicy.gorilla.enabled=false;db.data.set('ops_game_config/encounters',{monsters:coldPolicy,revision:2});await page.reload({waitUntil:'domcontentloaded'});await home();assert.equal(own().gorillaFangs||0,0,'closing the cold-entry battle does not grant a reward');
   await shop();await click('ShopScene','selltab');await click('ShopScene','sellkatana');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').dialogContainer.visible),false);assert.match(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').msgText.text),/卸下/);
   await click('ShopScene','back');await home();await warehouse();await click('WarehouseScene','item');await click('WarehouseScene','equip');await page.waitForFunction(()=>window.__farmGame.scene.getScene('WarehouseScene').farmData.equippedWeapon==='club');await click('WarehouseScene','back');await home();await shop();await click('ShopScene','selltab');await click('ShopScene','sellkatana');await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').dialogContainer.visible);assert.match(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').dialogSubText.text),/30000/);await page.screenshot({path:'/tmp/gugu-katana-sale.png'});await click('ShopScene','confirm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData.katana===1);assert.equal(own().coins,1130000);
   await click('ShopScene','back');await home();await warehouse();await click('WarehouseScene','item');await click('WarehouseScene','equip');await page.waitForFunction(()=>window.__farmGame.scene.getScene('WarehouseScene').farmData.equippedWeapon==='katana');await click('WarehouseScene','back');await home();
   const E=require('../game-admin/functions/encounters.cjs'),policy=structuredClone(E.DEFAULTS);for(const value of Object.values(policy))value.enabled=false;policy.wolf.enabled=true;policy.wolf.visit.rate=100;db.data.set('ops_game_config/encounters',{monsters:policy,revision:1});
   await page.locator('.farm-hud-bottom button[aria-label="村落"]').click();await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.farms?.length>0);await click('LobbyScene','public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');await click('LobbyScene','village');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B'&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);await click('LobbyScene','farm');await page.waitForFunction(()=>{const s=window.__farmGame.scene.getScene('VisitScene'),b=s?.wolf?.getBounds();return s?.entryChecked&&b&&b.left>=0&&b.right<=s.scale.width;});
   await page.screenshot({path:'/tmp/gugu-katana-wolf-one-hit.png'});await click('VisitScene','wolf');await page.locator('[data-result-kind=battle]').waitFor();assert.equal(own().wolfFangs,1);assert.equal(own().combatKills.wolf,1);assert.equal(own().coins,1130000);await page.screenshot({path:'/tmp/gugu-katana-wolf-victory.png'});assert.deepEqual(errors,[]);
   console.log('PASS unreleased katana: visible disabled shop, no client buy request, forged direct buy rejected, existing-owner equip/refresh/unequip, cold boss art, sell30000, one-hit wolf unchanged');return;
  }
  if(encounterConfigTests){
   const own=db.data.get('groups/A/users/alice').farm,settings=db.data.get('ops_game_config/encounters');
   settings.monsters.mole.enabled=true;settings.monsters.mole.interval=2;own.gardenCatchCount=2;
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.entryChecked&&window.__farmGame.scene.getScene('MyFarmScene').moleEncounter);
   assert.equal(db.data.get(pendingKey).kind,'mole');assert.equal(db.data.get(pendingKey).milestone,2);assert.equal(calls.filter(c=>c.action==='claimEncounter').length,0);
   await page.locator('.farm-hud-bottom button[aria-label="倉庫"]').dispatchEvent('click');assert.equal(await page.evaluate(()=>window.__farmGame.scene.isActive('WarehouseScene')),false);
   await page.screenshot({path:'/tmp/gugu-configured-mole-entry.png'});
   settings.monsters.mole.home.rate=0;settings.monsters.mole.visit.rate=0;
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.entryChecked);
   assert.equal(await page.evaluate(()=>!!window.__farmGame.scene.getScene('MyFarmScene').moleEncounter),false);assert.ok(!db.data.get(pendingKey).kind);
   settings.monsters.wolf.enabled=true;settings.monsters.wolf.visit.rate=100;
   const click=async(find)=>{const point=await page.evaluate(find=>{const s=window.__farmGame.scene.getScene('LobbyScene'),o=find==='public'?s.publicVillageButton:find==='village'?s.content.list.find(o=>o.getData('villageGroupId')==='B'):s.content.list.find(o=>o.texture?.key==='coop'),p=s.cameras.main.matrix.transformPoint(o.x-s.cameras.main.scrollX,o.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},find);await page.mouse.click(point.x,point.y);};
   await page.locator('.farm-hud-bottom button[aria-label="村落"]').click();await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.farms?.length>0);
   await click('public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');await click('village');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B'&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);await click('farm');
   await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.entryChecked&&window.__farmGame.scene.getScene('VisitScene').wolf?.active);
   assert.equal(db.data.get(pendingKey).kind,'wolf');assert.equal(calls.filter(c=>c.action==='claimEncounter').length,0);await page.waitForFunction(()=>{const s=window.__farmGame.scene.getScene('VisitScene'),b=s.wolf?.getBounds();return b&&b.left>=0&&b.right<=s.scale.width&&b.top>=0&&b.bottom<=s.scale.height;});await page.screenshot({path:'/tmp/gugu-configured-wolf-visit.png'});
   assert.deepEqual(errors,[]);console.log('PASS configurable server entry: mole threshold 2 below legacy 30, 0% disables, actual public village entry uses 100% wolf, no client milestone claims, battle blocks warehouse');return;
  }
  if(chestFlowTests){
   releaseSettlement();
   const openCalls=()=>calls.filter(c=>c.action==='openChest'),own=()=>db.data.get('groups/A/users/alice').farm;
   const taskCount=async()=>(await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}})).challenges.mission.tasks.find(t=>t.type==='DEFEAT_MONSTER').count;
   const clickObject=async(sceneKey,selector)=>{
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const p=await page.evaluate(({sceneKey,selector})=>{const s=window.__farmGame.scene.getScene(sceneKey),o=selector==='chest-tab'?s.categoryTabs.tabs.get('chests').background:s.itemsPanel.list.find(o=>o.type==='Rectangle'),w=o.getWorldTransformMatrix().transformPoint(0,0),q=s.cameras.main.matrix.transformPoint(w.x-s.cameras.main.scrollX,w.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+q.x/s.scale.width*r.width,y:r.y+q.y/s.scale.height*r.height};},{sceneKey,selector});await page.mouse.click(p.x,p.y);
   };
   const shoot=async()=>{
    await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter?.archery);
    const point=async(x,y)=>page.evaluate(({x,y})=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),p=s.cameras.main.matrix.transformPoint(x-s.cameras.main.scrollX,y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},{x,y});
    const b=await page.evaluate(()=>{const o=window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.archery.button;return{x:o.x,y:o.y};}),p=await point(b.x,b.y);await page.mouse.click(p.x,p.y);
    for(let shot=0;shot<15;shot++){
     if(await page.evaluate(()=>!!window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.result))break;
     const aim=await page.evaluate(()=>{const b=window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter,o=b.archery.bow,r=b.sprite.getBounds(),t=.45;return{x:o.x,y:o.y,px:o.x-(r.centerX-o.x)/t/9,py:o.y-((r.centerY-o.y)/t-180*t)/9};});
     const a=await point(aim.x,aim.y),z=await point(aim.px,aim.py);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(z.x,z.y,{steps:5});await page.mouse.up();await page.waitForTimeout(650);
    }
    await page.locator('[data-result-kind=battle]').waitFor();
    assert.equal(await page.locator('.farm-battle-reward-row:not(.is-empty)').count(),2);assert.equal(await page.locator('.farm-battle-reward-row.is-empty').count(),1);assert.match(await page.locator('[data-result-kind=battle]').textContent(),/寶箱/);
   };
   const cases=[{coins:{enabled:true,min:137,max:137},items:[]},{coins:{enabled:false,min:0,max:0},items:[{itemId:'medicine',quantity:2}]},{coins:{enabled:true,min:7,max:7},items:[{itemId:'worms',quantity:2},{itemId:'ironhammer',quantity:1},{itemId:'bresse',quantity:1}]}];
   if(chestArtFail)await page.route('**/assets/farm/chest/v1/frames/**',r=>r.fulfill({status:503,body:'fixture animation unavailable'}));
   for(let index=0;index<cases.length;index++){
    if(index){db.data.set('ops_game_config/chests',{revision:index+1,monsters:{eagle:{dropRate:100,...cases[index]}}});await page.setViewportSize({width:390,height:844});await page.reload();await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.entryChecked);}
    const coinsBefore=own().coins;await shoot();assert.equal(own().coins,coinsBefore);assert.equal(own().chestCount,1);
    const chestId=lastBattleResult.chest.id;
    await page.screenshot({path:`/tmp/gugu-chest-drop-${index}.png`});await page.locator('[data-result-kind=battle] button[aria-label=確定]').click();
    await page.evaluate(()=>window.__privateEmitAll());await page.locator('.farm-hud-bottom button[aria-label="倉庫"]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));
    await clickObject('WarehouseScene','chest-tab');await page.screenshot({path:`/tmp/gugu-chest-warehouse-${index}.png`});await clickObject('WarehouseScene','chest-card');
    const root=page.locator('[data-result-kind=chest]');await root.getByRole('button',{name:'開啟',exact:true}).waitFor();
    await page.screenshot({path:`/tmp/gugu-chest-list-${index}.png`});
    if(!chestArtFail)await page.evaluate(async()=>{await(await import('/js/farm/chest-ui.js')).prepareChestArt();});
    if(index===2)await page.emulateMedia({reducedMotion:'reduce'});
    if(index===1){chestReplyDelay=350;await page.evaluate(()=>window.__fixtureTimeoutMs=100);}
    const progress=await taskCount(),before=openCalls().length;
    await page.evaluate(()=>{window.__chestFrames=[];const root=document.querySelector('[data-result-kind=chest]');new MutationObserver(()=>{const frame=root.dataset.chestFrame;if(frame!==undefined&&window.__chestFrames.at(-1)?.frame!==frame)window.__chestFrames.push({frame,at:performance.now(),hidden:root.querySelector('.farm-chest-rewards')?.hidden});}).observe(root,{attributes:true,attributeFilter:['data-chest-frame']});});
    await root.getByRole('button',{name:'開啟',exact:true}).evaluate(b=>{b.click();b.click();b.click();});
    if(index===1){await root.getByText(/結果確認中/).waitFor();assert.equal(openCalls().length,before+1);const originalId=openCalls().at(-1).requestId;await page.waitForTimeout(400);chestReplyDelay=0;await page.evaluate(()=>window.__fixtureTimeoutMs=undefined);// Freeze the 900ms animation while Playwright performs its real pointer click.
     // Slow CI must not race the reveal frame which intentionally hides Skip.
     if(!chestArtFail){const clockStart=Date.now();await page.clock.install({time:clockStart});await page.clock.pauseAt(clockStart+10000);}
     try{await root.getByRole('button',{name:'確認／重試此寶箱',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-result-kind=chest] .farm-chest-rewards'));assert.equal(openCalls().at(-1).requestId,originalId);
      if(!chestArtFail){const skip=root.getByRole('button',{name:'跳過動畫',exact:true});await skip.click();assert.equal(await root.getAttribute('data-animation-state'),'complete');assert.equal(await root.getAttribute('data-chest-frame'),'7');}
     }finally{if(!chestArtFail)await page.clock.resume();}}
    if(index===0&&!chestArtFail){await page.waitForFunction(()=>Number(document.querySelector('[data-result-kind=chest]')?.dataset.chestFrame)>=4);await page.screenshot({path:'/tmp/gugu-chest-opening.png'});}
    await page.waitForFunction(()=>{const r=document.querySelector('[data-result-kind=chest]');return r?.querySelector('.farm-chest-rewards')&&!r.querySelector('.farm-chest-rewards').hidden&&['complete','static'].includes(r.dataset.animationState);});
    if(index===0&&!chestArtFail){const frames=await page.evaluate(()=>window.__chestFrames);assert.deepEqual(frames.map(f=>Number(f.frame)),[0,1,2,3,4,5,6,7]);assert.equal(frames.find(f=>f.frame==='3').hidden,true);assert.equal(frames.find(f=>f.frame==='4').hidden,false);}
    const expected=cases[index].coins.enabled?cases[index].coins.min:0;assert.equal(own().coins,coinsBefore+expected);assert.equal(own().chestCount,0);assert.equal(await taskCount(),progress);
    for(const item of cases[index].items)assert.match(await root.textContent(),item.itemId==='bresse'?/布雷斯雞/:item.itemId==='worms'?/菜蟲/:item.itemId==='ironhammer'?/大鐵槌/:/活力散/);
    await page.setViewportSize({width:320,height:568});await page.waitForTimeout(150);await page.screenshot({path:`/tmp/gugu-chest-result-${index}-320.png`});
    assert.equal(await root.locator('.farm-chest-rewards').evaluate(node=>!node.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true}))),false,'current rewards scroller must stay scrollable after replacing the inventory view');
    const bounds=await root.getByRole('button',{name:'確定',exact:true}).boundingBox();assert.ok(bounds.y+bounds.height<=568);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await root.getByRole('button',{name:'確定',exact:true}).evaluate(b=>{b.click();b.click();});assert.equal(await root.count(),0);
    const snapshot=structuredClone(own());await Promise.all([service.farmTransaction({auth,data:{groupId:'A',action:'openChest',chestId,requestId:require('node:crypto').randomUUID(),battlePageId:'other-device-a'}}),service.farmTransaction({auth,data:{groupId:'A',action:'openChest',chestId,requestId:require('node:crypto').randomUUID(),battlePageId:'other-device-b'}})]);assert.deepEqual(own(),snapshot);
    await clickObject('WarehouseScene','chest-card');await root.getByRole('button',{name:'開箱紀錄',exact:true}).click();await root.getByRole('button',{name:'查看結果',exact:true}).first().click();assert.equal(await root.getAttribute('data-animation-state'),'static');await root.getByRole('button',{name:'確定',exact:true}).click();
   }
   assert.deepEqual(errors,[]);console.log('PASS real eagle drop -> warehouse chest tab -> opening; full manifest frames/reveal/hold, coin-only/items-only/mixed/bird rewards, timeout same receipt, double taps, cross-device replay, refresh/history, reduced motion and 320px result'+(chestArtFail?' with failed animation fallback':''));return;
  }
  if(battleRewardTests){
   releaseSettlement();failBattleSettlement=true;
   const key=battleRewardKind+'Encounter',inventoryKey=battleRewardKind==='eagle'?'eagleFeathers':'gorillaFangs';
   await page.waitForFunction(key=>!!window.__farmGame.scene.getScene('MyFarmScene')[key],key);
   const point=async(x,y)=>page.evaluate(({x,y})=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),p=s.cameras.main.matrix.transformPoint(x-s.cameras.main.scrollX,y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},{x,y});
   if(battleRewardKind==='eagle'){
    const button=await page.evaluate(key=>{const o=window.__farmGame.scene.getScene('MyFarmScene')[key].archery.button;return{x:o.x,y:o.y};},key),p=await point(button.x,button.y);await page.mouse.click(p.x,p.y);
    for(let shot=0;shot<15;shot++){
     if(await page.evaluate(key=>!!window.__farmGame.scene.getScene('MyFarmScene')[key].result,key))break;
     const aim=await page.evaluate(key=>{const b=window.__farmGame.scene.getScene('MyFarmScene')[key],o=b.archery.bow,r=b.sprite.getBounds(),t=.45;return{x:o.x,y:o.y,px:o.x-(r.centerX-o.x)/t/9,py:o.y-((r.centerY-o.y)/t-180*t)/9};},key);
     const a=await point(aim.x,aim.y),z=await point(aim.px,aim.py);
     await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(z.x,z.y,{steps:5});await page.mouse.up();await page.waitForTimeout(650);
    }
   }else{
    for(let hit=0;hit<20;hit++){
     const o=await page.evaluate(key=>{const b=window.__farmGame.scene.getScene('MyFarmScene')[key],r=b.sprite.getBounds();return{x:r.centerX,y:r.centerY};},key),p=await point(o.x,o.y);await page.mouse.click(p.x,p.y);await page.waitForTimeout(90);
    }
   }
   await page.waitForFunction(key=>window.__farmGame.scene.getScene('MyFarmScene')[key].warning.text.includes('點此重試'),key);
   assert.equal(await page.locator('[data-result-kind=battle]').count(),0);assert.equal(db.data.get('groups/A/users/alice').farm[inventoryKey]||0,0);
   assert.equal((await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}})).challenges.mission.tasks.find(t=>t.type==='DEFEAT_MONSTER').count,0);
   failBattleSettlement=false;
   const retry=await page.evaluate(key=>{const o=window.__farmGame.scene.getScene('MyFarmScene')[key].warning;return{x:o.x,y:o.y};},key),r=await point(retry.x,retry.y);await page.mouse.click(r.x,r.y);
   const dialog=page.locator('[data-result-kind=battle]');await dialog.waitFor();
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-result-kind=battle] img')].every(i=>i.complete&&i.naturalWidth));
   assert.match(await dialog.textContent(),battleRewardKind==='eagle'?/擊退 巨飛鷹/:/擊退 大金剛/);
   assert.match(await dialog.textContent(),battleRewardKind==='eagle'?/巨鷹羽毛/:/猩猩尖牙/);
   assert.equal(await dialog.locator('.farm-battle-reward-row').count(),3);assert.equal(await dialog.locator('.is-empty').count(),2);
   assert.equal(await dialog.locator('.is-empty').evaluateAll(rows=>rows.every(row=>!row.textContent&&!row.children.length&&!row.hasAttribute('tabindex'))),true);
   assert.doesNotMatch(await dialog.textContent(),/商店|金幣|售出|300/);
   assert.equal(await dialog.locator('.farm-battle-reward-storage').getAttribute('alt'),'已放入倉庫');
   assert.equal(await dialog.locator('.farm-battle-reward-monster img').getAttribute('src'),await page.evaluate(kind=>{const s=window.__farmGame.scene.getScene('MyFarmScene');return s.textures.getBase64(kind,String(kind==='eagle'?6:9));},battleRewardKind));
   for(const size of [{width:390,height:844},{width:320,height:568}]){
    await page.setViewportSize(size);await page.waitForTimeout(180);
    const portraitBounds=await dialog.locator('.farm-battle-reward-monster img').boundingBox(),nameBounds=await dialog.locator('.farm-battle-reward-defeated').boundingBox();assert.ok(portraitBounds.y+portraitBounds.height<=nameBounds.y,'stunned portrait must not overlap monster name');
    const bounds=await dialog.locator('button[aria-label=確定]').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=size.height);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`/tmp/gugu-battle-${battleRewardKind}-${size.width}.png`});
   }
   assert.equal(db.data.get('groups/A/users/alice').farm[inventoryKey],1);
   const oldId=lastBattleResult.id;
   await dialog.locator('button[aria-label=確定]').evaluate(b=>{b.click();b.click();});
   assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').input.enabled),true);
   await page.evaluate(async({kind,result})=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),ui=await import('/js/farm/battle-reward-ui.js');const responses=await Promise.all([ui.openBattleReward(s,result,kind,{groupId:'A',accountId:'alice'}),ui.openBattleReward(s,result,kind,{groupId:'A',accountId:'alice'})]);if(!responses.every(r=>r.duplicate))throw Error('duplicate UI');}, {kind:battleRewardKind,result:lastBattleResult});
   await page.evaluate(async id=>{const backend=await import('/js/farm/backend-client.js');await backend.settleBackendBattle(id);},oldId);
   assert.equal(await dialog.count(),0);assert.equal(db.data.get('groups/A/users/alice').farm[inventoryKey],1);
   assert.equal((await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}})).challenges.mission.tasks.find(t=>t.type==='DEFEAT_MONSTER').count,1);
   await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),ui=await import('/js/farm/battle-reward-ui.js');await ui.openBattleReward(s,{id:'fixture-full-inventory',outcome:'win',inventoryUpdated:false,rewards:[]},'wolf');});
   assert.equal(await dialog.locator('.farm-battle-reward-storage').count(),0);assert.match(await dialog.textContent(),/戰利品未入庫/);await dialog.locator('button[aria-label=確定]').click();
   // UI-only future multi-item layout and missing art, without changing real drops.
   await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),ui=await import('/js/farm/battle-reward-ui.js');await ui.openBattleReward(s,{id:'fixture-three-rows',outcome:'win',inventoryUpdated:true,rewards:[{itemId:'eagleFeathers',quantity:1},{itemId:'gorillaFangs',quantity:2},{itemId:'fixture-missing-art',itemName:'非常非常長的測試戰利品名稱換行驗證',quantity:12345}]},'eagle');});
   assert.equal(await dialog.locator('.farm-battle-reward-row:not(.is-empty)').count(),3);await page.screenshot({path:'/tmp/gugu-battle-three-rows-320.png'});
   await dialog.locator('button[aria-label=關閉戰鬥勝利]').click();
   assert.equal(await dialog.count(),0);assert.deepEqual(errors,[]);
   console.log('PASS real home encounter and '+battleRewardKind+' combat input; failed settlement/retry, stunned atlas frame, one reward/mission, duplicate settlement, two blank slots, 320px layout and three-row/missing-art fixture');return;
  }
  if(costTests){
   await page.waitForFunction(()=>document.querySelector('.farm-mail-badge')?.textContent==='2');
   const feeds=()=>feedResponses.filter(r=>r.action==='feeds');assert.equal(feeds().length,1);
   await page.clock.fastForward(60001);await page.waitForTimeout(150);assert.equal(feeds().length,2);assert.equal(feeds().at(-1).notModified,!legacyAnnouncements);
   await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.fastForward(180001);await page.waitForTimeout(150);assert.equal(feeds().length,2);
   db.data.get('ops_announcements/read-test').title='更新公告';db.data.get('ops_feed_versions/global').revision='v2';
   await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(150);assert.equal(feeds().length,3);assert.equal(feeds().at(-1).notModified,false);
   await page.locator('.farm-mail-launcher').click();await page.getByRole('tab',{name:'公告',exact:true}).click();await page.getByText('更新公告',{exact:true}).first().waitFor();await page.locator('.farm-mail-overlay .farm-mail-header button').click();
   await page.locator('.farm-ranking-launcher').click();await page.waitForFunction(()=>document.querySelectorAll('.farm-ranking-row').length===1);assert.match(await page.locator('.farm-ranking-person').textContent(),/bob/);assert.match(await page.locator('.farm-ranking-score').textContent(),/50/);assert.ok(feedResponses.some(r=>r.action==='ranking'&&r.rows===1));await page.screenshot({path:'/tmp/gugu-read-optimized-ranking.png'});
   await page.locator('.farm-ranking-close').click();assert.equal(await page.evaluate(()=>window.__farmGame.input.enabled),true);assert.deepEqual(errors,[]);
   console.log('PASS read cost UI: one combined minute poll, unchanged version, background suspension, foreground refresh, announcement display, real ranking backend Top 10 and modal close');return;
  }
  if(arcticSceneTests){releaseSettlement();await require('./helpers/arctic-scene-browser.cjs').run({page,calls,db,errors});return;}
  if(sceneTests){
   const own=()=>db.data.get('groups/A/users/alice').farm;
   const artRequests=[];page.on('request',request=>{if(request.url().includes('/scenes/fuji-')&&!request.url().includes('thumb'))artRequests.push(request.url());});
   const clickObject=async(key,kind)=>{
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const p=await page.evaluate(({key,kind})=>{const s=window.__farmGame.scene.getScene(key);const o=kind==='category'?s.categoryTabs.tabs.get('scenes').background:kind==='product'?s.buyContainer.list.find(o=>o.type==='Rectangle'&&o.catalogCategory==='scenes'):s.children.list.find(o=>o.type==='Rectangle'&&o.x===55&&o.y===60);const world=o.getWorldTransformMatrix().transformPoint(0,0),point=s.cameras.main.matrix.transformPoint(world.x-s.cameras.main.scrollX,world.y-s.cameras.main.scrollY),rect=s.game.canvas.getBoundingClientRect();return{x:rect.x+point.x/s.scale.width*rect.width,y:rect.y+point.y/s.scale.height*rect.height};},{key,kind});await page.mouse.click(p.x,p.y);
   };
   const enterShop=async()=>{await page.locator('.farm-hud-bottom button[aria-label="商店"]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));await clickObject('ShopScene','category');await page.screenshot({path:'/tmp/gugu-scenes-shop.png'});};
   await page.locator('.farm-hud-settings').click();assert.match(await page.getByRole('dialog').textContent(),/目前只有初始場景/);assert.equal(await page.locator('[data-scene-id=fuji]').count(),0);await page.getByRole('button',{name:'關閉',exact:true}).click();
   await enterShop();await clickObject('ShopScene','product');const unavailable=page.getByRole('button',{name:'尚未開賣',exact:true});assert.equal(await unavailable.isDisabled(),true);await unavailable.evaluate(b=>{b.click();b.click();});assert.equal(calls.filter(c=>c.action==='buyScene').length,0);assert.equal(own().coins,12345);await page.getByRole('button',{name:'關閉',exact:true}).click();
   // Seed an existing owner; closing sales must not revoke previously bought scenes.
   own().coins=100000;own().ownedSceneIds=['fuji'];await page.evaluate(()=>window.__privateEmitAll());await clickObject('ShopScene','product');assert.equal(await page.getByRole('button',{name:'已擁有',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'關閉',exact:true}).click();await clickObject('ShopScene','back');await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').entryChecked);
   await page.locator('.farm-hud-bottom button[aria-label="倉庫"]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));await clickObject('WarehouseScene','category');assert.deepEqual(await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('WarehouseScene');return s.allConfigItems.filter(i=>i.type==='scene'&&s.warehouseItemCount(i)).map(i=>i.sceneId);}),['default','fuji']);await page.screenshot({path:'/tmp/gugu-scenes-warehouse.png'});await clickObject('WarehouseScene','back');await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').entryChecked);
   assert.equal(artRequests.length,0,'瀏覽商店和倉庫不載入完整富士山圖');
   await page.route('**/scenes/fuji-japanese-v2-portrait.webp',r=>r.fulfill({status:503,body:'fixture art unavailable'}));await page.locator('.farm-hud-settings').click();await page.locator('[data-scene-id=fuji]').click();await page.waitForFunction(()=>!document.querySelector('[data-scene-id=fuji]').disabled);assert.equal(own().activeSceneId,undefined);assert.equal(calls.filter(c=>c.action==='setScene').length,0);await page.unroute('**/scenes/fuji-japanese-v2-portrait.webp');await page.getByRole('button',{name:'關閉',exact:true}).click();
   await page.locator('.farm-hud-settings').click();await page.locator('[data-scene-id=fuji]').click();await page.waitForFunction(()=>document.querySelector('[data-scene-id=fuji]').textContent==='使用中');await page.evaluate(()=>window.__privateEmitAll());await page.getByRole('button',{name:'關閉',exact:true}).click();await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').children.list.some(o=>o.texture?.key==='scene_fuji_portrait'));
   assert.equal(own().activeSceneId,'fuji');assert.equal(own().coins,100000);
   assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').gardenPlants.length),42);
   // Click the repainted Japanese roof through the real canvas, not a direct handler.
   const coopPoint=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),o=s.coop,p=s.cameras.main.matrix.transformPoint(o.x,o.y-o.height*.3),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};});await page.mouse.click(coopPoint.x,coopPoint.y);await page.locator('.farm-coop-clean-no').waitFor();await page.locator('.farm-coop-clean-no').click();assert.equal(calls.filter(c=>c.action==='cleanOwn').length,0);
   await page.screenshot({path:'/tmp/gugu-scenes-fuji-mobile.png'});
   for(const size of [{width:320,height:568},{width:430,height:932},{width:768,height:1024},{width:1024,height:768}]){await page.setViewportSize(size);await page.waitForTimeout(200);if(sceneTests)await page.screenshot({path:`/tmp/gugu-fuji-v2-${size.width}x${size.height}.png`});await page.locator('.farm-hud-settings').click();assert.equal(await page.locator('[data-scene-id=fuji]').isDisabled(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.getByRole('button',{name:'關閉',exact:true}).click();}
   await page.setViewportSize({width:390,height:844});await page.reload();await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.children.list.some(o=>o.texture?.key==='scene_fuji_portrait'));assert.equal(own().coins,100000);await page.locator('.farm-hud-settings').click();await page.waitForFunction(()=>[...document.querySelectorAll('.farm-scenes-panel img')].every(i=>i.complete&&i.naturalWidth>0));await page.screenshot({path:'/tmp/gugu-scenes-settings.png'});await page.locator('[data-scene-id=default]').click();await page.waitForFunction(()=>document.querySelector('[data-scene-id=default]').textContent==='使用中');await page.evaluate(()=>window.__privateEmitAll());await page.getByRole('button',{name:'關閉',exact:true}).click();await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').children.list.some(o=>o.texture?.key==='farm_map'));assert.equal(own().coins,100000);
   Object.assign(db.data.get('groups/A/users/bob').farm,{ownedSceneIds:['fuji'],activeSceneId:'fuji'});
   await page.locator('.farm-hud-bottom button[aria-label="村落"]').click();await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.farms?.some(f=>f.accountId==='bob'));
   const p=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('LobbyScene'),o=s.content.list.find(o=>o.texture?.key==='coop'),world=o.getWorldTransformMatrix().transformPoint(0,0),q=s.cameras.main.matrix.transformPoint(world.x,world.y),r=s.game.canvas.getBoundingClientRect();return{x:r.x+q.x/s.scale.width*r.width,y:r.y+q.y/s.scale.height*r.height};});await page.mouse.click(p.x,p.y);await page.waitForFunction(()=>{const s=window.__farmGame.scene.getScene('VisitScene');return s?.targetAccountId==='bob'&&s.entryChecked&&s.children.list.some(o=>o.texture?.key==='scene_fuji_portrait');});assert.equal(own().activeSceneId,'default');assert.deepEqual(errors,[]);
   console.log('PASS unreleased Fuji: disabled shop, no purchase request or debit, existing-owner warehouse/settings preserved, lazy full art, free switching, refresh persistence, 320/390/430/768/1024 layouts');return;
  }
  if(dragonStartupTests){
   await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').dragonEncounter?.sprite?.active);
   const state=await page.evaluate(()=>{const scene=window.__farmGame.scene.getScene('MyFarmScene'),boss=scene.dragonEncounter;return{key:boss.spec.key,health:boss.health,salePrice:boss.spec.salePrice,size:boss.spec.size,ready:scene.entryChecked,kind:scene.backendChallenge.kind};});
   assert.deepEqual(state,{key:'dragon',health:600,salePrice:200,size:176,ready:true,kind:'dragon'});
   assert.ok(!startupLogs.some(x=>x.includes('farm-startup-failure')));assert.deepEqual(errors,[]);
   await page.screenshot({path:'/tmp/nexus-dragon-startup-fixed.png'});
   console.log('PASS real entry/Phaser with async Firebase Auth initialization: dragon scene starts with original health, sale price and backend challenge; no startup TDZ');return;
  }
  if(coopCleanTests||visitPreloadTests||battleExitTests||ownCleanTests){
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
   if(predatorRewardTests){
    releaseSettlement();
    const sequence=predatorRewardKind==='tiger'?[0]:[.99,0];serverRoll=()=>sequence.shift()??.99;
    await enter('B');
    await page.waitForFunction(kind=>{const o=window.__farmGame.scene.getScene('VisitScene')[kind];return o?.active&&o.x>65&&o.x<325;},predatorRewardKind);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    for(let hit=0;hit<6;hit++){
     if(await page.locator('[data-result-kind=battle]').count())break;
     const point=await page.evaluate(kind=>{const s=window.__farmGame.scene.getScene('VisitScene'),b=s[kind].getBounds(),p=s.cameras.main.matrix.transformPoint(b.centerX-s.cameras.main.scrollX,b.centerY-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},predatorRewardKind);
     await page.mouse.click(point.x,point.y);await page.waitForTimeout(120);
    }
    const dialog=page.locator('[data-result-kind=battle]');await dialog.waitFor();assert.match(await dialog.textContent(),predatorRewardKind==='wolf'?/狼牙/:/虎皮/);
    const item=predatorRewardKind==='wolf'?'wolfFangs':'tigerPelts';assert.equal(db.data.get('groups/A/users/alice').farm[item],1);
    const settlements=calls.filter(c=>c.action==='battleSettle').length;assert.equal(settlements,1);
    await dialog.locator('button[aria-label=確定]').evaluate(b=>{b.click();b.click();});
    assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').targetGroupId),'B');
    await page.evaluate(kind=>window.__farmGame.scene.getScene('VisitScene')[kind==='wolf'?'defeatWolf':'defeatTiger'](),predatorRewardKind);
    assert.equal(calls.filter(c=>c.action==='battleSettle').length,1);assert.equal(db.data.get('groups/A/users/alice').farm[item],1);
    assert.equal((await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}})).challenges.mission.tasks.find(t=>t.type==='DEFEAT_MONSTER').count,1);
    assert.deepEqual(errors,[]);console.log('PASS original public-village entry and '+predatorRewardKind+' pointer attacks, committed loot popup, double close, no duplicate settlement or mission and stay in visited village');return;
   }
   if(visitReturnTests){
    const pressBack=async key=>{
     const point=await page.evaluate(key=>{const s=window.__farmGame.scene.getScene(key),o=s.children.list.find(o=>o.input&&o.x===(key==='VisitScene'?55:42)&&o.y===50),p=s.cameras.main.matrix.transformPoint(o.x-s.cameras.main.scrollX,o.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},key);
     await page.mouse.click(point.x,point.y);
    };
    for(let round=0;round<3;round++){
     await enter(round%2?'C':'B');
     await pressBack('VisitScene');
     await page.waitForFunction(()=>window.__farmGame.scene.isActive('LobbyScene')&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);
     await pressBack('LobbyScene');
     await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').entryChecked);
     await page.waitForFunction(theme=>window.__farmGame.scene.getScene('MyFarmScene').displayedFarmSceneId===theme,visitReturnTheme);
     // Resizing must still reflow the current live rubbish group and all current hens.
     await page.setViewportSize({width:round%2?430:390,height:round%2?932:844});
     assert.ok(await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');return s.rubbishGroup.getChildren().length>0&&s.rubbishGroup.getChildren().every(o=>o.active&&Number.isFinite(o.x)&&Number.isFinite(o.y))&&s.hensGroup.every(o=>o.active); }));
     const frame=await page.evaluate(()=>window.__farmGame.loop.frame);
     await page.waitForTimeout(150);
     assert.ok(await page.evaluate(frame=>window.__farmGame.loop.frame>frame,frame),'return must keep the game loop running');
     assert.deepEqual(errors,[]);
    }
    await page.screenshot({path:`/tmp/gugu-visit-return-${visitReturnTheme}-390.png`});
    assert.equal(calls.filter(c=>['stealEgg','collectEggs','helpClean','cleanOwn'].includes(c.action)).length,0);
    console.log('PASS original HUD/public village/house/back/back path, three restarts with '+visitReturnTheme+' scenery, live rubbish/hens after resize, render loop alive and no transaction side effects');return;
   }
   if(ownCleanTests){
    const own=()=>db.data.get('groups/A/users/alice').farm,commands=()=>calls.filter(c=>c.action==='cleanOwn');
    const openOwn=async()=>{await clickScene('MyFarmScene','coop');await page.locator('.farm-coop-clean-yes').waitFor();};
    const refill=async()=>{own().cleanliness=70;await page.evaluate(()=>window.__privateEmitAll());};
    await openOwn();await page.waitForFunction(()=>[...document.querySelectorAll('[data-result-kind=coop-clean] img')].every(img=>img.complete&&img.naturalWidth));await page.screenshot({path:'/tmp/gugu-own-coop-clean-390.png'});assert.equal(await page.locator('.farm-coop-clean-message').textContent(),'你的雞舍有點髒亂，是否要打掃雞舍？');await page.locator('.farm-coop-clean-no').click();assert.equal(commands().length,0);assert.equal(own().cleanliness,70);
    cleanDenied=true;await openOwn();await page.locator('.farm-coop-clean-yes').click();await page.waitForFunction(()=>!document.querySelector('.farm-coop-clean-yes').disabled);assert.match(await page.locator('.farm-coop-clean-status').textContent(),/清潔被拒絕/);assert.equal(own().cleanliness,70);cleanDenied=false;await page.locator('.farm-coop-clean-no').click();
    let release;cleanGate=new Promise(resolve=>release=resolve);await openOwn();await page.evaluate(()=>{const b=document.querySelector('.farm-coop-clean-yes');b.click();b.click();b.click();});await page.waitForFunction(()=>document.querySelector('.farm-coop-clean-yes').disabled);assert.equal(await page.locator('.farm-coop-clean-status').textContent(),'');assert.equal(commands().length,2);release();cleanGate=null;await page.waitForFunction(()=>!document.querySelector('[data-result-kind=coop-clean]'));assert.equal(own().cleanliness,0);assert.equal(own().moral,40);
    await refill();await openOwn();own().cleanliness=0;await page.locator('.farm-coop-clean-yes').click();await page.waitForFunction(()=>!document.querySelector('[data-result-kind=coop-clean]'));assert.equal(own().cleanliness,0);
    await refill();await page.evaluate(()=>window.__fixtureTimeoutMs=100);lateCleanReply=true;await openOwn();await page.locator('.farm-coop-clean-yes').click();await page.waitForFunction(()=>document.querySelector('.farm-coop-clean-yes span').textContent==='確認結果');const before=commands().length,requestId=commands().at(-1).requestId;await page.waitForTimeout(400);assert.equal(commands().length,before,'逾時不自動新開交易');await page.locator('.farm-coop-clean-yes').click();await page.waitForFunction(()=>!document.querySelector('[data-result-kind=coop-clean]'));assert.equal(commands().at(-1).requestId,requestId);assert.equal(own().cleanliness,0);await page.evaluate(()=>window.__fixtureTimeoutMs=null);
    await refill();await openOwn();await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene'));await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));assert.equal(await page.locator('[data-result-kind=coop-clean]').count(),0);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').input.enabled),true);
    await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('MyFarmScene'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').entryChecked);own().hensState[0].isSick=true;await page.evaluate(()=>window.__privateEmitAll());await clickScene('MyFarmScene','coop');await page.getByRole('button',{name:'清理雞舍',exact:true}).click();await page.locator('.farm-coop-clean-yes').waitFor();assert.equal(await page.locator('[role=dialog]:visible').count(),1);await page.locator('.farm-coop-clean-no').click();
    const status=await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}});assert.equal(status.challenges.mission.tasks.find(t=>t.type==='HELP_CLEAN_OTHER').count,0);assert.deepEqual(errors,[]);
    console.log('PASS own coop original click/shared wood dialog: no cancels, one yes, hidden routine status, denied/already-clean, timeout same receipt, scene cleanup, sick-hen management preserved and no other-player task increment');return;
   }
   if(battleExitTests){
    Object.assign(db.data.get('groups/A/users/alice').farm,{ironhammer:1,equippedWeapon:'ironhammer'});await page.evaluate(()=>window.__privateEmitAll());serverRoll=0;
    await enter('B');await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').gorillaEncounter?.id);
    const back=async()=>{const p=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene'),o=s.children.list.find(o=>o.type==='Rectangle'&&o.x===55&&o.y===50),v=s.cameras.main.matrix.transformPoint(o.x-s.cameras.main.scrollX,o.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+v.x/s.scale.width*r.width,y:r.y+v.y/s.scale.height*r.height};});await page.mouse.click(p.x,p.y);};
    await back();assert.equal(await page.evaluate(()=>window.__farmGame.scene.isActive('VisitScene')),true,'怪物出現後不可溜走');
    await page.waitForTimeout(2500);backendNow+=1000;await page.evaluate(()=>{const b=window.__farmGame.scene.getScene('VisitScene').gorillaEncounter;for(let i=0;i<20;i++)b.hit({x:195,y:400});});
    await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').gorillaEncounter?.result==='win');
    await back();assert.equal(await page.evaluate(()=>window.__farmGame.scene.isActive('VisitScene')),true,'伺服器結算未完成仍不可溜走');
    releaseSettlement();await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').gorillaEncounter?.settled===true);await back();await page.waitForFunction(()=>window.__farmGame.scene.isActive('LobbyScene'));
    assert.equal(db.data.get('groups/A/users/alice').farm.gorillaFangs,1);assert.deepEqual(errors,[]);
    console.log('PASS original public visit/monster/escape click: locked during combat and pending settlement, one valid reward, escape enabled after authoritative completion');return;
   }
   if(crossSelfCleanTests){
    const taskCount=async()=>((await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}})).challenges.mission.tasks.find(t=>t.type==='HELP_CLEAN_OTHER').count);
    await enter('B');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').targetAccountId),'alice');
    await clickScene('VisitScene','coop');await page.locator('.farm-coop-clean-no').waitFor();assert.match(await page.locator('.farm-coop-clean-message').textContent(),/alice/);await page.locator('.farm-coop-clean-no').click();
    assert.equal(calls.filter(c=>c.action==='helpClean').length,0);assert.equal(db.data.get('groups/B/users/alice').farm.cleanliness,70);
    await clickScene('VisitScene','coop');await page.locator('.farm-coop-clean-yes').waitFor();await page.evaluate(()=>{const b=document.querySelector('.farm-coop-clean-yes');b.click();b.click();b.click();});
    await page.waitForFunction(()=>!document.querySelector('[data-result-kind=coop-clean]'));
    assert.equal(calls.filter(c=>c.action==='helpClean').length,1);assert.equal(db.data.get('groups/B/users/alice').farm.cleanliness,40);assert.equal(db.data.get('groups/A/users/alice').farm.cleanliness,30);assert.equal(db.data.get('groups/A/users/alice').farm.moral,43);assert.equal(await taskCount(),0);
    assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').targetGroupId),'B');assert.deepEqual(errors,[]);
    console.log('PASS original HUD/public village/own account in another group/coop confirmation: cancel unchanged, rapid confirm one clean, distinct farms preserved and other-player mission unchanged');return;
   }
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
    assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,60);assert.equal(db.data.get('groups/A/users/alice').farm.stolenEggs20261123,60);assert.deepEqual(errors,[]);console.log('PASS theft benchmark',flowBefore?'before':'after',rows.length);return;
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
   assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,1);assert.equal(db.data.get('groups/A/users/alice').farm.stolenEggs20261123,1);
   assert.equal(await openFixture({success:false,totalEggs:0}),false);assert.equal(await openFixture({success:true,totalEggs:0}),false);
   const reset=async()=>{const f=db.data.get('groups/A/users/alice').farm;f.villageStealCooldowns={};f.villageStealBlockedUntil={};await page.evaluate(()=>{window.__farmGame.scene.getScene('VisitScene').lastStealBlockedUntil=0;return window.__privateEmitAll();});};
   db.data.get('groups/B/users/bob').farm.guardDogs=[{id:'dog',breedId:'pyrenees',days:1,startedAt:stamp-1,expiresAt:stamp+86400000}];serverRoll=0;await reset();await clickHen();await page.waitForFunction(()=>!window.__farmGame.scene.getScene('VisitScene').isStealing);
   assert.equal(lastStealResult.success,false);assert.equal(await page.locator('[data-result-kind=steal]').count(),0);assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,1);
   const target=db.data.get('groups/B/users/bob').farm;target.guardDogs=[];target.readyEggs.silkie=0;target.eggsReady=0;serverRoll=.99;await reset();const empty=economyCalls();await clickHen();assert.equal(economyCalls(),empty);assert.equal(await page.locator('[data-result-kind=steal]').count(),0);
   target.readyEggs.silkie=2;target.eggsReady=2;await reset();failSteal=true;await clickHen();await page.waitForFunction(()=>!window.__farmGame.scene.getScene('VisitScene').isStealing);failSteal=false,failBattleSettlement=false,lastBattleResult=null,chestReplyDelay=0;assert.equal(await page.locator('[data-result-kind=steal]').count(),0);assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,1);
   await page.evaluate(()=>{window.__append=document.body.append;document.body.append=function(...nodes){if(nodes.some(n=>n.dataset?.resultKind==='steal'))throw Error('fixture popup failure');return window.__append.apply(this,nodes);};});
   await clickHen();await page.waitForFunction(()=>!window.__farmGame.scene.getScene('VisitScene').isStealing);await page.evaluate(()=>document.body.append=window.__append);
   assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,2);assert.equal(db.data.get('groups/A/users/alice').farm.stolenEggs20261123,2);assert.equal(await page.evaluate(()=>window.__successFloats),1,'開啟失敗保留成功浮字，不重送交易');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').input.enabled),true);
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
    const beforeTimeout=economyCalls(),beforeEggs=db.data.get('groups/A/users/alice').farm.silkieEggs,beforeRank=db.data.get('groups/A/users/alice').farm.stolenEggs20261123;
    lateReplyOnce=true;await clickObject('VisitScene','steal');await page.waitForSelector('[data-result-kind=steal]');
    assert.equal(await page.evaluate(()=>window.__sawConfirming),true);assert.equal(economyCalls(),beforeTimeout+2);
    const retries=calls.filter(c=>c.stealWhenClear).slice(-2);assert.equal(retries[0].requestId,retries[1].requestId);
    assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,beforeEggs+1);assert.equal(db.data.get('groups/A/users/alice').farm.stolenEggs20261123,beforeRank+1);
    await page.locator('.farm-egg-result-close').click();await page.waitForTimeout(400);assert.equal(await page.locator('[data-result-kind=steal]').count(),0,'原回覆晚到不重開');
    // 兩次均未收到明確結果，按「確認結果」仍沿用原 ID，跳過已提交造成的本地冷卻。
    refill();await reset();timeoutStealAlways=true;await clickObject('VisitScene','steal');await page.waitForFunction(()=>!window.__farmGame.scene.getScene('VisitScene').isStealing);
    assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').stealFeedback.text),'結果確認中，請再點母雞');
    const unresolved=calls.filter(c=>c.stealWhenClear).at(-1).requestId;timeoutStealAlways=false;
    await page.reload();await page.waitForFunction(expected=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.silkieEggs===expected,beforeEggs+2);
    await page.locator('.farm-hud-bottom button[aria-label="村落"]').click();await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.farms?.length>0);
    await clickObject('LobbyScene','public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');await clickObject('LobbyScene','village');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B'&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);await clickObject('LobbyScene','farm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.visitEncounterReady);
    await clickObject('VisitScene','steal');await page.waitForSelector('[data-result-kind=steal]');assert.equal(calls.filter(c=>c.stealWhenClear).at(-1).requestId,unresolved);
    assert.equal(db.data.get('groups/A/users/alice').farm.silkieEggs,beforeEggs+2);assert.equal(db.data.get('groups/A/users/alice').farm.stolenEggs20261123,beforeRank+2);
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
   await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').entryChecked);
   assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter?.id==='resume-gorilla'),false,'重新開頁不恢復舊怪');
   assert.equal(db.data.get('groups/A/users/alice').farm.coins,12345);assert.equal(db.data.get('groups/A/users/'+(resumeMode==='visit'?'bob':'alice')).farm.eggsReady,3);
   // 模擬 iOS 強制終止沒有送出 pagehide 通知：新頁面仍須作廢零血量／到期舊戰鬥。
   const previousOwner=db.data.get(pendingKey).ownerPageId;
   db.data.set(pendingKey,{id:'missed-close-battle',ownerPageId:previousOwner,kind:'gorilla',targetGroupId:'A',targetAccountId:resumeMode==='visit'?'bob':'alice',startedAt:stamp-1000,approachEndsAt:stamp-1000,deadline:stamp-1,health:0,lastAttackAt:stamp-2,attacks:{melee:20,ranged:0}});
   await page.evaluate(()=>window.addEventListener('pagehide',event=>event.stopImmediatePropagation(),{capture:true}));serverRoll=0;await page.reload();
   await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.gorillaEncounter?.health===1000);
   assert.notEqual(db.data.get(pendingKey).id,'missed-close-battle');assert.notEqual(db.data.get(pendingKey).ownerPageId,previousOwner);
   assert.equal(calls.filter(call=>call.action==='abandonBattlePage').length,0,'即使關閉通知完全遺失也能作廢');
   assert.equal(db.data.get('groups/A/users/alice').farm.coins,12345);assert.equal(db.data.get('groups/A/users/alice').farm.gorillaFangs,undefined);
   assert.equal(db.data.get('groups/A/users/'+(resumeMode==='visit'?'bob':'alice')).farm.eggsReady,3);
   assert.equal((await service.dailyChallenges({auth,data:{groupId:'A',action:'status'}})).challenges.mission.tasks.find(t=>t.type==='DEFEAT_MONSTER').count,0);
   assert.deepEqual(errors,[]);console.log('PASS abandoned '+resumeMode+' battle: no resume/reward/loss/task; lost pagehide still discards zero-health expired fight and starts fresh conditions');return;
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
