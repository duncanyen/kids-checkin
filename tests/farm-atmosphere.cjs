// FARM_BASE_URL=http://127.0.0.1:8012 node tests/farm-atmosphere.cjs
// Requires Playwright, curl, and system Chromium. All Firebase operations are mocked.
// Firebase writes are recorded locally; production Firebase is never contacted.
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');

(async()=>{
 const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const phaser=fs.existsSync('/tmp/kids-phaser.js')?fs.readFileSync('/tmp/kids-phaser.js','utf8'):execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 const p=await b.newPage({viewport:{width:390,height:960}}); const errors=[]; p.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
 await p.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 p.setDefaultTimeout(10000);
 await p.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db = {};'}));
 await p.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:`
 const farm={coins:100,hens:2,coopLevel:1,eggsReady:0,lastLayTime:Date.now(),hensState:[{isSick:false},{isSick:true}],cleanliness:0,warehouseLimit:10};
 export const doc=(...args)=>({args}); export const collection=doc; export const query=doc; export const where=doc;
 export function onSnapshot(ref,cb){queueMicrotask(()=>cb({exists:()=>true,data:()=>ref.args.length===3&&ref.args[1]==='groups'?{farmVillageVisibility:'public',members:['render-test','neighbor-1','neighbor-2']}:{farm}}));return ()=>{};}
 export const getDoc=async ref=>({exists:()=>true,data:()=>ref.args.length===3&&ref.args[1]==='groups'?{farmVillageVisibility:'public',members:['render-test','neighbor-1','neighbor-2']}:{farm}});
 export const getDocs=async()=>({forEach:cb=>[{accountId:'render-test',name:'Self'},{accountId:'neighbor-1',name:'鄰居一'},{accountId:'neighbor-2',name:'鄰居二'}].forEach(data=>cb({data:()=>data}))});
 const record=(...args)=>{(window.__mockWrites||=[]).push(args);return Promise.resolve({id:'mock'});};
 export const setDoc=record,updateDoc=record,addDoc=record,serverTimestamp=()=>Date.now();
 export const runTransaction=async()=>{window.__transactionCount=(window.__transactionCount||0)+1;return false;};
 `}));
 await p.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await p.emulateMedia({reducedMotion:'reduce'});
 await p.addInitScript(()=>{
  sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'render-test',groupId:'render-test',name:'Test'}));
  localStorage.setItem('nexus-farm-atmosphere:render-test',JSON.stringify({reduced:true,sound:true}));
 });
 let environmentAudioRequests=0;
 await p.route('**/js/farm/atmosphere-audio.js',r=>{environmentAudioRequests++;return r.abort();});
 await p.goto((process.env.FARM_BASE_URL || 'http://127.0.0.1:8000') + '/farmgame.html');
 await p.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.hensGroup?.length===2);

 const checks=[];
 if(await p.locator('#farm-atmosphere input, #farm-atmosphere details, #farm-atmosphere button').count())throw Error('Player atmosphere controls remain');
 const initialListeners=await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').events.listenerCount('update'));
 await p.clock.setFixedTime(new Date('2026-10-24T12:00:00+08:00'));
 await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').farmAtmosphere.refresh());
 const climate=p.locator('#farm-atmosphere');
 if(await climate.getAttribute('data-phase')!=='白晝')throw Error('Taiwan midday not applied');
 const model=await p.evaluate(async()=>{
  const {atmosphereAt,WEATHER_SLOT_MS}=await import('/js/farm/atmosphere-core.js');
  const base=Date.parse('2026-10-24T00:00:00+08:00');
  const dates={};
  for(let i=0;i<400;i++){const stamp=base+i*WEATHER_SLOT_MS+21000;const state=atmosphereAt(stamp,'render-test');if(!dates[state.weather])dates[state.weather]=stamp;}
  return dates;
 });
 for(const [kind,timestamp] of Object.entries(model)){
  await p.clock.setFixedTime(new Date(timestamp));
  await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').farmAtmosphere.refresh());
  if(await climate.getAttribute('data-weather')!==kind)throw Error('Weather model not applied: '+kind);
  if(kind==='rain'){
   const shelter=await p.evaluate(async()=>{const {getHenWalkArea,getHenWanderArea}=await import('/js/farm/scenery.js');const s=window.__farmGame.scene.getScene('MyFarmScene');return getHenWanderArea(s).bottom<getHenWalkArea(s).bottom;});
   if(!shelter)throw Error('Rain did not bias hens toward the coop clearing');
   const before=await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').children.list.find(o=>o.depth===12&&o.commandBuffer)?.commandBuffer.join(','));
   await p.clock.setFixedTime(new Date(timestamp+2000));
   await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').farmAtmosphere.refresh());
   const after=await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').children.list.find(o=>o.depth===12&&o.commandBuffer)?.commandBuffer.join(','));
   if(!before||before===after)throw Error('Built-in rain animation stopped or old preferences disabled effects');
  }
 }
 await p.clock.setFixedTime(new Date('2026-10-24T22:00:00+08:00'));
 await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').farmAtmosphere.refresh());
 if(await climate.getAttribute('data-phase')!=='夜晚')throw Error('Taiwan night not applied');
 await p.screenshot({path:'/tmp/farm-atmosphere-night.png',fullPage:true});
 checks.push('Taiwan day/night, all four weather types, built-in rain animation ignores old preferences, no player controls or environment audio');
 // Lighting and weather never intercept existing coop/plant hit zones.
 await p.evaluate(()=>{window.__farmGame.scene.getScene('MyFarmScene').farmData.cleanliness=20;});
 const box=await p.locator('canvas').boundingBox();
 await p.mouse.click(box.x+244*box.width/390,box.y+213*box.height/844);
 await p.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').dialogContainer.visible);
 await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').dialogContainer.setVisible(false));
 await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene'));
 await p.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 if(await climate.getAttribute('data-active')!=='false')throw Error('Climate not cleaned up on shutdown');
 await p.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('MyFarmScene'));
 await p.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene')?.farmAtmosphere);
 if(await p.locator('#farm-atmosphere input').count())throw Error('Controls returned after scene restart');
 const listeners=await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').events.listenerCount('update'));
 if(listeners!==initialListeners)throw Error('Duplicate update listener after scene restart');
 await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetAccountId:'neighbor-1',targetName:'Neighbor'}));
 await p.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.farmAtmosphere);
 if(await climate.getAttribute('data-group-id')!=='render-test')throw Error('Own group visit weather mismatch');
 // Verify a foreign village uses its target group, not the viewer group.
 await p.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.restart({targetGroupId:'other-village',targetAccountId:'neighbor-1',targetName:'Neighbor'}));
 await p.waitForFunction(()=>document.querySelector('#farm-atmosphere').dataset.groupId==='other-village');
 const correct=await p.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('VisitScene');
  const {atmosphereAt}=await import('/js/farm/atmosphere-core.js');
  return s.farmAtmosphere.state.weather===atmosphereAt(Date.now(),'other-village').weather;
 });
 if(!correct)throw Error('Cross-village weather mismatch');
 // Browser back/visibility restoration recalculates wall time rather than elapsed game time.
 await p.clock.setFixedTime(new Date('2026-10-25T06:00:00+08:00'));
 await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow')));
 if(await climate.getAttribute('data-phase')!=='晨光')throw Error('Restored page retained stale time');
 checks.push('coop interaction, scene cleanup/restart, target-village weather, restored page clock');
 if(environmentAudioRequests)throw Error('Removed environment audio was requested');
 if(errors.length)throw Error(JSON.stringify(errors));
 console.log(JSON.stringify({passed:true,checks,errors}));await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
