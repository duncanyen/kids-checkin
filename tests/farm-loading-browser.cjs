// Real Phaser/assets, isolated database. Never reads or writes production Firebase.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8012';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[],ops=[];
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 let releaseGroup,releaseFarm,releaseCore,coreRequestResolve;
 const coreRequested=new Promise(r=>coreRequestResolve=r);
 const groupGate=new Promise(r=>releaseGroup=r),farmGate=new Promise(r=>releaseFarm=r),coreGate=new Promise(r=>releaseCore=r);
 let failAsset='',failEngine=false,allowGroup=false,blockNextGroup=false,releaseLateGroup;
 const lateGroupGate=new Promise(r=>releaseLateGroup=r);
 const farm={coins:3141,hens:1,coopLevel:1,inventoryEggs:7,eggsReady:0,lastLayTime:Date.now(),hensState:[{isSick:false}],cleanliness:0,warehouseLimit:100,moral:100};
 await page.exposeFunction('__farmLoadDb',async({kind,path})=>{
  ops.push({kind,path,at:Date.now()});
  if(path==='groups/A'){await groupGate;if(blockNextGroup)await lateGroupGate;return {members:allowGroup?['alice']:[],name:'Fixture group'};}
  await farmGate;return {farm:structuredClone(farm)};
 });
 const sdk=`
 export const doc=(_, ...parts)=>({path:parts.join('/')}),collection=doc,query=ref=>ref,where=()=>({});
 const snap=data=>({exists:()=>!!data,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
 export const getDoc=async ref=>snap(await window.__farmLoadDb({kind:'get',path:ref.path}));
 export const getDocs=async()=>({docs:[],empty:true,forEach:()=>{}});
 export function onSnapshot(ref,next){let active=true;
 window.__loadWatch=()=>getDoc(ref).then(s=>{if(active)next(s);});
 window.__farmLoadDb({kind:'watch',path:ref.path}).then(data=>{if(active)next(snap(data));});
 return()=>{active=false;};}
 export async function runTransaction(_,fn){return fn({get:getDoc,set:()=>{throw Error('Unexpected write');},update:()=>{throw Error('Unexpected write');}});}
 export const addDoc=()=>{throw Error('Unexpected write');},updateDoc=addDoc,setDoc=addDoc,serverTimestamp=()=>1;
 `;
 await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill(failEngine?{status:503,body:'fixture engine failure'}:{contentType:'text/javascript',body:fs.readFileSync('/tmp/kids-phaser.js','utf8')}));
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 // DOM launchers and their shared wood texture are covered in farm-mail-browser.cjs.
 await page.route('**/js/farm/mail-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmMail(){}'}));
 await page.route('**/js/farm/ranking-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmRankings(){}'}));
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await page.route('**/assets/farm/*',async r=>{
  const file=new URL(r.request().url()).pathname.split('/').at(-1);requests.push(file);
  if(file==='farm-map.jpg'){coreRequestResolve();await coreGate;}
  if(file===failAsset){await r.fulfill({status:503,body:'fixture failure'});return;}
  await r.continue();
 });
 await page.addInitScript(()=>{
  sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'Fixture',groupId:'A'}));localStorage.setItem('lastGroupId','A');
  window.__progress=[];new MutationObserver(()=>{const e=document.querySelector('[role=progressbar]');if(e)__progress.push(Number(e.getAttribute('aria-valuenow')));}).observe(document,{subtree:true,attributes:true,attributeFilter:['aria-valuenow']});
 });
 await page.goto(base+'/farmgame.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!window.__farmGame);
 let coreTimeout;await Promise.race([coreRequested,new Promise((_,reject)=>{coreTimeout=setTimeout(()=>reject(Error('Core asset never requested')),15000);})]);clearTimeout(coreTimeout);
 assert.ok(requests.includes('farm-map.jpg'),'public assets must start while membership is pending');
 assert.equal(ops.some(op=>op.kind==='watch'),false,'private save cannot start before group validation');
 assert.equal(await page.evaluate(()=>__farmGame.scene.isActive('MyFarmScene')),false);
 allowGroup=true;releaseGroup();
 await page.waitForFunction(()=>window.__farmGame?.registry.get('isListeningFarm')===true);
 assert.ok(ops.some(op=>op.kind==='watch'),'save starts while core image remains blocked');
 assert.equal(await page.evaluate(()=>document.querySelector('[data-farm-loading]').hidden),false);
 assert.ok(await page.evaluate(()=>Number(document.querySelector('[role=progressbar]').getAttribute('aria-valuenow'))<100));
 releaseCore();await page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene'));
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').farmData),null);
 releaseFarm();await page.waitForFunction(()=>window.__farmGame?.registry.get('farmInitialReady')===true);
 await page.waitForFunction(()=>document.querySelector('[data-farm-loading]').hidden);
 assert.equal(await page.locator('[data-loading-hen-fallback]').getAttribute('hidden'),'');
 const initial=[...requests];
 assert.equal(initial.length,10);assert.ok(!initial.some(f=>/wolf|tiger|dragon|gorilla|eagle|mace|battleaxe|silkie|bresse/.test(f)));
 const progress=await page.evaluate(()=>__progress);assert.ok(progress.includes(100));assert.ok(progress.every((n,i)=>!i||n>=progress[i-1]),'initial progress never moves backward');
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').farmData.coins),3141);
 if(process.env.FARM_LOADING_SCREENSHOT){await page.evaluate(async()=>{const {farmLoading}=await import('/js/farm/loading-ui.js');farmLoading.begin('載入農莊素材');farmLoading.progress(42);});await page.screenshot({path:process.env.FARM_LOADING_SCREENSHOT});await page.evaluate(async()=>{const {farmLoading}=await import('/js/farm/loading-ui.js');farmLoading.complete(true);});}
 // New breed snapshots fetch only missing breeds, preserving the newest state.
 farm.hens=3;farm.poultryVersion=2;farm.readyEggs={hen:0,silkie:0,bresse:0};farm.hensState=['hen','silkie','bresse'].map((breed,i)=>({id:'h'+i,breed,laidAt:Date.now()}));
 await page.evaluate(()=>__loadWatch());await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene').hensGroup?.length===3);
 assert.ok(requests.includes('silkie-sheet.png')&&requests.includes('bresse-sheet.png'));
 assert.equal(await page.evaluate(()=>__farmGame.textures.exists('dragon')),false);
 // A failed demand load never starts an encounter or changes the save. Retry
 // must retain the roll even if a subsequent random roll would choose no boss.
 farm.coopLevel=2;farm.eggsReady=1;farm.readyEggs.hen=1;
 await page.evaluate(()=>__loadWatch());failAsset='dragon-sheet.webp';
 await page.evaluate(async()=>{const s=__farmGame.scene.getScene('MyFarmScene'),old=Phaser.Math.Between;Phaser.Math.Between=()=>1;try{await s.harvestEgg();}finally{Phaser.Math.Between=old;}});
 await page.waitForFunction(()=>!document.querySelector('[data-loading-retry]').hidden);
 assert.equal(await page.evaluate(()=>!!__farmGame.scene.getScene('MyFarmScene').dragonEncounter),false);
 assert.equal(farm.eggsReady,1);failAsset='';
 await page.evaluate(()=>{Phaser.Math.Between=(_,max)=>max;});
 await page.locator('[data-loading-retry]').click();
 await page.waitForFunction(()=>!!__farmGame.scene.getScene('MyFarmScene').dragonEncounter);
 assert.equal(await page.evaluate(()=>document.querySelector('[data-farm-loading]').hidden),true);
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').dragonEncounter.config.durationMs),60000);
 // Scene preload barriers protect direct scene.start too. Loaded assets are reused.
 await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene'));
 await page.waitForFunction(()=>window.__farmGame?.scene.isActive('ShopScene'));
 const beforeRepeat=requests.length;
 await page.evaluate(()=>__farmGame.scene.getScene('ShopScene').scene.start('WarehouseScene'));
 await page.waitForFunction(()=>window.__farmGame?.scene.isActive('WarehouseScene'));
 assert.equal(requests.length,beforeRepeat,'cached feature bundle must not redownload');
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').scene.start('MyFarmScene'));
 await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene').hensGroup?.length===3);
 // Dedicated loader is invisible and owns no game objects/timers.
 assert.deepEqual(await page.evaluate(()=>{const s=__farmGame.scene.getScene('FarmAssetScene');return[s.children.length,s.time._active.length,s.jobs.length];}),[0,0,0]);
 // A fresh feature failure stops create; retry fetches only the missing texture.
 failAsset='battleaxe.png';await page.reload();await page.waitForFunction(()=>window.__farmGame?.registry.get('farmInitialReady'));
 await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene'));
 await page.waitForFunction(()=>document.querySelector('[data-loading-status]').textContent.includes('素材載入失敗'));
 assert.equal(await page.evaluate(()=>!!__farmGame.scene.getScene('ShopScene').buyContainer),false);
 const retryRequests=requests.length;failAsset='';await page.locator('[data-loading-retry]').click();
 await page.waitForFunction(()=>!!__farmGame.scene.getScene('ShopScene').buyContainer);
 assert.equal(requests.length,retryRequests+1);
 // Core failure cannot enter the farm; retry reload keeps the original save.
 failAsset='farm-map.jpg';await page.reload();await page.waitForFunction(()=>document.querySelector('[data-loading-status]').textContent.includes('農莊素材載入失敗'));
 assert.equal(await page.evaluate(()=>__farmGame.scene.isActive('MyFarmScene')),false);
 assert.ok(await page.evaluate(()=>Number(document.querySelector('[role=progressbar]').getAttribute('aria-valuenow'))<100));
 failAsset='';await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('[data-loading-retry]').click()]);
 await page.waitForFunction(()=>window.__farmGame?.registry.get('farmInitialReady'));
 assert.equal(await page.evaluate(()=>__farmGame.registry.get('myFarmData').coins),3141);
 // A CDN failure is visible even before Phaser exists.
 failEngine=true;await page.reload();await page.waitForFunction(()=>document.querySelector('[data-loading-status]').textContent.includes('遊戲程式載入失敗'));
 assert.equal(await page.evaluate(()=>!!window.__farmGame),false);
 failEngine=false;await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('[data-loading-retry]').click()]);
 await page.waitForFunction(()=>window.__farmGame?.registry.get('farmInitialReady'));
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(async()=>{const {farmLoading}=await import('/js/farm/loading-ui.js');farmLoading.begin();farmLoading.progress(50);});
 assert.equal(await page.locator('.farm-loading-walker').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 assert.equal(await page.locator('[data-loading-hen-fallback]').evaluate(el=>getComputedStyle(el).animationName),'none');
 // Destroying a boot while membership is pending must not later subscribe.
 blockNextGroup=true;await page.reload();
 await page.waitForFunction(()=>window.__farmGame?.scene.getScene('BootScene')?.assetProgress!==undefined);
 await page.evaluate(()=>__farmGame.destroy(true));
 await page.waitForFunction(()=>document.querySelector('#game-container canvas')===null);
 const watchesBefore=ops.filter(op=>op.kind==='watch').length;
 blockNextGroup=false;releaseLateGroup();await page.waitForTimeout(200);
 assert.equal(ops.filter(op=>op.kind==='watch').length,watchesBefore);
 assert.deepEqual(errors,[]);
 const {ASSET_MANIFEST}=await import('data:text/javascript;base64,'+fs.readFileSync('js/farm/asset-manifest.js').toString('base64'));
 const baselineAssets=Object.values(ASSET_MANIFEST).flatMap(row=>[row.image,...(row.json?[row.json]:[])]);
 const firstBytes=initial.reduce((sum,file)=>sum+fs.statSync('assets/farm/'+file).size,0);
 const report={initialRequests:initial,initialBytes:firstBytes,baselineBootBytes:baselineAssets.reduce((sum,file)=>sum+fs.statSync('assets/farm/'+file).size,0),initialProgress:progress,checks:['images overlap membership','save overlaps images','no private access before membership','no 100 before safe save','missing breeds only','boss asset failure retry preserves roll and 60s','feature assets demand load and reuse','asset scene zero objects/timers','core/feature/engine failures retry safely','reduced motion','destroy during pending membership starts no later private reads'],errors};
 if(process.env.FARM_LOADING_RESULTS)fs.writeFileSync(process.env.FARM_LOADING_RESULTS,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
