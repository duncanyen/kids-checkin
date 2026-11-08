// Real UI, scenes and transactions against an isolated persistent database.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {MemoryDB}=require('../game-admin/tests/memory-db.cjs'),{createService}=require('../game-admin/functions/service.cjs');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8012';
const epoch=Date.now(),DAY=86400000;
const seed=()=>({coins:5000,hens:0,hensState:[],coopLevel:1,eggsReady:3,readyEggs:{hen:3,silkie:0,bresse:0},poultryVersion:2,lastLayTime:0,inventoryEggs:0,warehouseLimit:100,cleanliness:0,moral:100});
const docs={'groups/A':{members:['owner','thief','friend'],farmVillageVisibility:'public'},'groups/B':{members:['neighbor'],farmVillageVisibility:'public'},
 'groups/A/users/owner':{farm:seed()},'groups/A/users/thief':{farm:seed()},'groups/A/users/friend':{farm:seed()},'groups/B/users/neighbor':{farm:seed()},
 'groups/A/settings/gameConfig':{targetRoomId:'room-A'},'groups/B/settings/gameConfig':{targetRoomId:'room-B'},'rooms/room-A':{groupId:'A'},'rooms/room-B':{groupId:'B'}};
const clone=x=>x===undefined?undefined:structuredClone(x);
const sdk=`
export const doc=(_, ...bits)=>({path:bits.join('/')}),collection=doc,query=ref=>ref,where=()=>({});
export const serverTimestamp=()=>Date.now();
const snap=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data),metadata:{fromCache:false,hasPendingWrites:false}});
export const getDoc=async ref=>snap(ref.path,await window.__dogDB({kind:'get',path:ref.path}));
export const getDocs=async()=>({docs:[],empty:true,forEach:()=>{}});
const listeners=new Set();
export function onSnapshot(ref,callback){const item={ref,callback};listeners.add(item);getDoc(ref).then(callback);return()=>listeners.delete(item);}
export async function notify(){for(const {ref,callback}of [...listeners])callback(await getDoc(ref));}
let queue=Promise.resolve();
export function runTransaction(_,callback){const result=queue.then(async()=>{
 const attempt=async()=>{const writes=[];const value=await callback({get:ref=>{if(writes.length)throw Error('Read after write');return getDoc(ref);},set:(ref,data)=>writes.push({path:ref.path,data,merge:false}),update:(ref,data)=>writes.push({path:ref.path,data,merge:true})});return {value,writes};};
 if(window.__retryDogTransaction){window.__retryDogTransaction=false;await attempt();}
 const done=await attempt();await window.__dogDB({kind:'commit',writes:done.writes});await notify();return done.value;
 });queue=result.catch(()=>{});return result;}
export const setDoc=async(ref,data)=>{await window.__dogDB({kind:'commit',writes:[{path:ref.path,data,merge:false}]});await notify();};
export const updateDoc=async(ref,data)=>{await window.__dogDB({kind:'commit',writes:[{path:ref.path,data,merge:true}]});await notify();};
export const addDoc=async(ref,data)=>{const id=crypto.randomUUID();await setDoc({path:ref.path+'/'+id},data);return{id};};
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
 await page.exposeFunction('__dogDB',op=>{
  if(op.kind==='get')return clone(docs[op.path]);
  if(op.kind!=='commit')throw Error('Unknown operation');
  for(const write of op.writes){const value=write.merge?clone(docs[write.path]||{}):{};for(const [key,data]of Object.entries(write.data)){let target=value;const bits=key.split('.');for(const bit of bits.slice(0,-1))target=target[bit]??={};target[bits.at(-1)]=clone(data);}docs[write.path]=value;}
 });
 const backendDB=new MemoryDB();let backendNow=epoch,rpcQueue=Promise.resolve();
 const backendService=createService({db:backendDB,auth:{getUser:async()=>({disabled:false})},now:()=>backendNow});
 await page.exposeFunction('__guardDogAPI',op=>{
  const call=rpcQueue.then(async()=>{
   backendNow=op.now;backendDB.data=new Map(Object.entries(docs).map(([path,data])=>[path,clone(data)]));
   for(const id of ['owner','thief','friend','neighbor'])backendDB.data.set('users/'+id,{accountId:id,role:'member'});
   try{return await backendService.guardDog({auth:{uid:op.accountId,token:{photoAccountId:op.accountId,photoGroupId:op.groupId}},data:{action:op.action,...op.payload,groupId:op.groupId,requestId:op.requestId}});}
   finally{for(const [path,data]of backendDB.data)docs[path]=clone(data);}
  });rpcQueue=call.catch(()=>{});return call;
 });
 await page.route('**/js/farm/operations-client.js*',r=>r.fulfill({contentType:'text/javascript',body:`
 import {notify} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
 export function createGameOperationsClient(context){return{guardDog:async(action,payload={})=>{
 const user=JSON.parse(sessionStorage.getItem('familyCheckInUser'));const result=await window.__guardDogAPI({action,payload,accountId:user.accountId,groupId:context.groupId,now:Date.now(),requestId:crypto.randomUUID()});await notify();return result;}};}
 `}));
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('/tmp/kids-phaser.js','utf8')}));
 await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.route('**/js/farm/mail-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmMail(){}'}));
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await page.addInitScript(epoch=>{
  localStorage.setItem('lastGroupId','A');if(!sessionStorage.getItem('familyCheckInUser'))sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'owner',name:'主人'}));
  window.__dogNow=Number(sessionStorage.getItem('guard-clock')||epoch);Date.now=()=>window.__dogNow;
 },epoch);
 const ready=()=>page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').farmData);
 const scene=async(key,data)=>{await page.evaluate(({key,data})=>new Promise(resolve=>{const current=__farmGame.scene.getScenes(true).find(s=>['MyFarmScene','ShopScene','WarehouseScene','VisitScene'].includes(s.sys.settings.key));if(current.sys.settings.key===key&&key!=='VisitScene'){resolve(true);return;}__farmGame.scene.getScene(key).events.once('create',()=>resolve(true));current.scene.start(key,data);}),{key,data});await page.waitForFunction(key=>{const s=__farmGame.scene.getScene(key);return s.sys.isActive()&&(key==='ShopScene'?s.buyContainer?.scene===s:key==='VisitScene'?!!s.targetFarmData:!!s.farmData);},key);};
 const clock=async now=>page.evaluate(now=>{window.__dogNow=now;sessionStorage.setItem('guard-clock',String(now));},now);
 const identity=async(accountId,name)=>{await page.evaluate(({accountId,name})=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId,name})),{accountId,name});await page.reload();await ready();};
 const rent=async(days,breedId='pyrenees')=>{await scene('ShopScene');await page.evaluate(breedId=>{const s=__farmGame.scene.getScene('ShopScene');s.selectShopCategory('dogs');s.catalog.buy.find(row=>row[0]===`guard:${breedId}`)[3]();},breedId);if(await page.getByLabel('租用天數').isEnabled())await page.getByLabel('租用天數').fill(String(days));};
 await page.goto(base+'/farmgame.html');await ready();
 await scene('WarehouseScene');assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').categoryTabs.tabs.get('dogs').background.visible),false);
 await rent(8);await page.getByText('8 天 · 480 金幣',{exact:true}).waitFor();await page.screenshot({path:'/tmp/guard-dog-rental.png',fullPage:true});await page.getByRole('button',{name:'確認租用',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 assert.equal(docs['groups/A/users/owner'].farm.coins,4520);let dog=docs['groups/A/users/owner'].farm.guardDogs[0];assert.equal(dog.startedAt,null);
 await clock(epoch+3*DAY);await rent(1);await page.getByRole('button',{name:'確認租用',exact:true}).click();await page.getByRole('alert').filter({hasText:'同一品種'}).waitFor();assert.equal(docs['groups/A/users/owner'].farm.coins,4520);await page.getByRole('button',{name:'取消',exact:true}).click();
 await scene('WarehouseScene');await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').selectWarehouseCategory('dogs'));await page.screenshot({path:'/tmp/guard-dog-warehouse.png',fullPage:true});await page.evaluate(()=>{const s=__farmGame.scene.getScene('WarehouseScene');s.handleItemClick('guard:pyrenees','大白熊犬');});
 await page.getByRole('button',{name:'開始護衛',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 dog=docs['groups/A/users/owner'].farm.guardDogs[0];assert.equal(dog.startedAt,epoch+3*DAY);assert.equal(dog.expiresAt,epoch+11*DAY);
 await scene('MyFarmScene');await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').guardDog?.getData('guardActivity')==='rest');
 await page.screenshot({path:'/tmp/guard-dog-home.png',fullPage:true});
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');Math.random=()=>.99;s.time.timeScale=30;});
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').guardDog?.getData('guardActivity')==='walk');
 await page.evaluate(()=>{__farmGame.scene.getScene('MyFarmScene').time.timeScale=1;});
 await identity('thief','小偷');await scene('VisitScene',{targetAccountId:'owner',targetName:'主人',targetGroupId:'A'});
 await page.waitForFunction(()=>!!__farmGame.scene.getScene('VisitScene').guardDog);
 await page.evaluate(async()=>{window.__retryDogTransaction=true;Math.random=()=>0;await __farmGame.scene.getScene('VisitScene').attemptSteal();});
 assert.equal(docs['groups/A/users/owner'].farm.eggsReady,3);assert.equal(docs['groups/A/users/thief'].farm.inventoryEggs,0);
 const block=Object.values(docs['groups/A/users/thief'].farm.villageStealBlockedUntil)[0];assert.equal(block,epoch+3*DAY+4*3600000);
 const notices=()=>Object.keys(docs).filter(path=>path.startsWith('messages/guard-'));
 assert.equal(notices().length,1);assert.equal(docs[notices()[0]].roomId,'room-A');assert.equal(Object.keys(docs).filter(p=>p.startsWith('groups/A/users/owner/farm_notifications/guard-')).length,1);
 await page.evaluate(()=>__farmGame.scene.getScene('VisitScene').attemptSteal());assert.equal(notices().length,1);
 await clock(block);await page.evaluate(async()=>{Math.random=()=>.99;await __farmGame.scene.getScene('VisitScene').attemptSteal();});assert.equal(docs['groups/A/users/owner'].farm.eggsReady,2);assert.equal(docs['groups/A/users/thief'].farm.inventoryEggs,1);
 assert.equal(Math.max(...Object.values(docs['groups/A/users/thief'].farm.villageStealBlockedUntil)),block+3600000);
 await scene('VisitScene',{targetAccountId:'friend',targetName:'朋友',targetGroupId:'A'});await page.evaluate(async()=>{Math.random=()=>0;await __farmGame.scene.getScene('VisitScene').attemptSteal();});assert.equal(docs['groups/A/users/friend'].farm.eggsReady,2);assert.equal(docs['groups/A/users/thief'].farm.inventoryEggs,2);
 docs['groups/B/users/neighbor'].farm.guardDogs=[{id:'neighbor-dog',breedId:'pyrenees',days:7,startedAt:epoch,expiresAt:epoch+30*DAY}];
 await scene('VisitScene',{targetAccountId:'neighbor',targetName:'鄰居',targetGroupId:'B'});await page.evaluate(()=>__farmGame.scene.getScene('VisitScene').attemptSteal());
 assert.equal(notices().length,2);assert.equal(docs[notices().at(-1)].roomId,'room-B');assert.equal(docs[notices().at(-1)].groupId,'B');assert.equal(docs['groups/B/users/neighbor'].farm.eggsReady,3);
 // A channel from another group is never used; the owner's inbox is retained.
 docs['groups/B/settings/gameConfig'].targetRoomId='room-A';await clock(block+4*3600000);
 await page.evaluate(()=>__farmGame.scene.getScene('VisitScene').attemptSteal());assert.equal(notices().length,2);
 assert.equal(Object.keys(docs).filter(p=>p.startsWith('groups/B/users/neighbor/farm_notifications/guard-')).length,2);
 // Expiry is effective even before the offline owner opens their warehouse.
 await clock(dog.expiresAt);await scene('VisitScene',{targetAccountId:'owner',targetName:'主人',targetGroupId:'A'});
 await page.evaluate(()=>__farmGame.scene.getScene('VisitScene').attemptSteal());assert.equal(docs['groups/A/users/owner'].farm.eggsReady,1);
 await identity('owner','主人');await scene('WarehouseScene');
 await page.waitForFunction(()=>!__farmGame.scene.getScene('WarehouseScene').categoryTabs.tabs.get('dogs').background.visible);await page.waitForTimeout(1200);assert.equal(docs['groups/A/users/owner'].farm.guardDogs.length,0);
 await rent(1);await page.getByRole('button',{name:'確認租用',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 await scene('WarehouseScene');await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').handleItemClick('guard:pyrenees','大白熊犬'));await page.getByRole('button',{name:'開始護衛',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 const coins=docs['groups/A/users/owner'].farm.coins;
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').handleItemClick('guard:pyrenees','大白熊犬'));await page.getByRole('button',{name:'解除護衛並放棄租期',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 assert.equal(docs['groups/A/users/owner'].farm.guardDogs.length,0);assert.equal(docs['groups/A/users/owner'].farm.coins,coins);
 // Concurrent requests use the same transactional uniqueness and activation rules.
 const concurrency=await page.evaluate(async()=>{
  const store=await import('/js/farm/guard-dog-store.js'),core=await import('/js/farm/guard-dog-core.js');
  const rents=await Promise.allSettled([store.rentDog('pyrenees',1),store.rentDog('pyrenees',1)]);
  core.GUARD_DOG_BREEDS.future={...core.GUARD_DOG_BREEDS.pyrenees,name:'未來犬種'};
  try{
   try{await store.rentDog('future',1);throw Error('Untrusted breed accepted');}catch(error){if(!error.message.includes('找不到此護衛犬'))throw error;}
   await store.rentDog('beagle',1);
   const {getDoc}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'),{myFarmRef}=await import('/js/farm/constants.js');
   const dogs=(await getDoc(myFarmRef)).data().farm.guardDogs;
   const activations=await Promise.allSettled(dogs.map(d=>store.activateDog(d.id)));
   const farm=(await getDoc(myFarmRef)).data().farm,active=core.activeGuardDog(farm);
   await store.releaseDog(active.id);
   const other=dogs.find(d=>d.id!==active.id);await store.activateDog(other.id);await store.releaseDog(other.id);
   return {rent:rents.map(r=>r.status),activate:activations.map(r=>r.status)};
  }finally{delete core.GUARD_DOG_BREEDS.future;}
 });
 assert.equal(concurrency.rent.filter(s=>s==='fulfilled').length,1);assert.equal(concurrency.activate.filter(s=>s==='fulfilled').length,1);
 assert.equal(docs['groups/A/users/owner'].farm.coins,coins-100);assert.equal(docs['groups/A/users/owner'].farm.guardDogs.length,0);
 // The real second breed uses its own quote, art, interception and notification.
 await rent(8,'beagle');await page.getByRole('heading',{name:'租用米格魯',exact:true}).waitFor();
 await page.getByText('8 天 · 120 金幣',{exact:true}).waitFor();
 await page.getByText('攔截小偷 33% · 對該雞舍禁偷 2 小時',{exact:true}).waitFor();
 assert.ok((await page.getByRole('dialog').textContent()).includes('20 金幣／天、100 金幣／週'));
 await page.screenshot({path:'/tmp/beagle-rental.png',fullPage:true});
 await page.getByRole('button',{name:'確認租用',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 await rent(1);await page.getByRole('button',{name:'確認租用',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 assert.equal(docs['groups/A/users/owner'].farm.coins,coins-300);assert.equal(docs['groups/A/users/owner'].farm.guardDogs.length,2);
 await scene('WarehouseScene');await page.evaluate(()=>{const s=__farmGame.scene.getScene('WarehouseScene');s.selectWarehouseCategory('dogs');s.handleItemClick('guard:beagle','米格魯');});
 await page.getByRole('button',{name:'開始護衛',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 const beagle=docs['groups/A/users/owner'].farm.guardDogs.find(d=>d.breedId==='beagle');assert.equal(beagle.expiresAt,beagle.startedAt+8*DAY);
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').handleItemClick('guard:pyrenees','大白熊犬'));
 assert.equal(await page.getByRole('button',{name:'開始護衛',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'取消',exact:true}).click();
 await scene('MyFarmScene');await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').guardDog?.texture.key==='guard_beagle');
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');for(const action of ['rest','walk','run','guard'])if(s.anims.get('guard_beagle_'+action).frames.some(f=>f.textureKey!=='guard_beagle'))throw Error('Beagle reused another breed artwork');});
 await page.screenshot({path:'/tmp/beagle-home.png',fullPage:true});
 await clock(beagle.startedAt+3600000);await identity('thief','小偷');await scene('VisitScene',{targetAccountId:'owner',targetName:'主人',targetGroupId:'A'});
 await page.waitForFunction(()=>__farmGame.scene.getScene('VisitScene').guardDog?.texture.key==='guard_beagle');
 const eggsBefore=docs['groups/A/users/owner'].farm.eggsReady,inventoryBefore=docs['groups/A/users/thief'].farm.inventoryEggs;
 await page.evaluate(async()=>{window.__retryDogTransaction=true;Math.random=()=>.32999;await __farmGame.scene.getScene('VisitScene').attemptSteal();});
 const beagleBlock=Math.max(...Object.values(docs['groups/A/users/thief'].farm.villageStealBlockedUntil));
 assert.equal(beagleBlock,beagle.startedAt+3*3600000);assert.equal(docs['groups/A/users/owner'].farm.eggsReady,eggsBefore);
 const beagleNotice=docs[notices().at(-1)];assert.ok(beagleNotice.text.includes('米格魯'));assert.ok(beagleNotice.text.includes('2 小時'));assert.ok(!beagleNotice.text.includes('4 小時'));
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('VisitScene');if(!s.children.list.some(o=>o.text?.includes('禁偷 2 小時')))throw Error('Wrong beagle cooldown label');});
 await clock(beagleBlock);await page.evaluate(async()=>{Math.random=()=>.33;await __farmGame.scene.getScene('VisitScene').attemptSteal();});
 assert.equal(docs['groups/A/users/owner'].farm.eggsReady,eggsBefore-1);assert.equal(docs['groups/A/users/thief'].farm.inventoryEggs,inventoryBefore+1);
 await identity('owner','主人');await scene('WarehouseScene');await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').handleItemClick('guard:beagle','米格魯'));
 await page.getByRole('button',{name:'解除護衛並放棄租期',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').handleItemClick('guard:pyrenees','大白熊犬'));await page.getByRole('button',{name:'開始護衛',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 await scene('MyFarmScene');await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').guardDog?.texture.key==='guard_dog');
 assert.equal(docs['groups/A/users/owner'].farm.coins,coins-300);
 // Dense mixed flock: dog rest, walking/running, returning and nesting stay separated.
 await page.evaluate(async()=>{
  const {updateDoc,doc}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
  await updateDoc(doc({},'groups','A','users','owner'),{'farm.hens':10,'farm.coopLevel':3,
   'farm.hensState':Array.from({length:10},(_,i)=>({id:'flock-'+i,breed:'hen',laidAt:Date.now(),isSick:false}))});
 });
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').hensGroup.length===10);
 for(const viewport of [{width:390,height:900},{width:1440,height:900},{width:844,height:390}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(200);
  await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');s.time.timeScale=30;s.tweens.timeScale=8;Math.random=()=>.99;});
  for(let sample=0;sample<12;sample++){
   await page.waitForTimeout(150);
   await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene'),dog=s.guardDog.getBounds();
    for(const hen of s.hensGroup)if(dog.bottom>hen.getBounds().top)throw Error('Dog and hen body lanes overlap');
   });
  }
  await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');s.time.timeScale=1;s.tweens.timeScale=1;s.prepareToLayEgg();});
  await page.waitForTimeout(2200);
  await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene'),dog=s.guardDog.getBounds();for(const hen of s.hensGroup)if(dog.bottom>hen.getBounds().top)throw Error('Nesting hen overlaps dog');});
  await page.screenshot({path:'/tmp/farm-dog-spacing-'+viewport.width+'.png',fullPage:true});
 }
 // Closed collie is still visible with correct prices; UI and trusted API reject new rentals.
 await page.setViewportSize({width:390,height:900});await rent(1,'collie');
 await page.getByText('1 天 · 200 金幣',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'日租尚未開放',exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'週租尚未開放',exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'尚未開放',exact:true}).isDisabled(),true);
 await page.screenshot({path:'/tmp/collie-closed-rental.png',fullPage:true});
 for(const size of [{width:390,height:900},{width:1440,height:900}]){await page.setViewportSize(size);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.getByRole('button',{name:'日租尚未開放',exact:true}).isDisabled(),true);}
 await page.screenshot({path:'/tmp/collie-closed-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:900});
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('ShopScene'),card=s.buyContainer.list.find(o=>o.catalogKey==='guard:collie'&&o.input);if(!card.visible||!card.getData('rentalDisabled'))throw Error('Closed collie card must remain visible');});
 const beforeClosed=JSON.stringify(docs['groups/A/users/owner'].farm);
 const rejected=await page.evaluate(async()=>{
  const {GUARD_DOG_BREEDS}=await import('/js/farm/guard-dog-core.js'),{rentDog}=await import('/js/farm/guard-dog-store.js');
  GUARD_DOG_BREEDS.collie.rentable=true;
  try{await rentDog('collie',1);return 'unexpected success';}catch(error){return error.message;}finally{GUARD_DOG_BREEDS.collie.rentable=false;}
 });
 assert.match(rejected,/尚未開放/);assert.equal(JSON.stringify(docs['groups/A/users/owner'].farm),beforeClosed);
 // Existing leases remain usable; this fixture represents an earlier legitimate rental.
 docs['groups/A/users/owner'].farm.guardDogs.push({id:'legacy-collie',breedId:'collie',days:1,paid:200000,rentedAt:epoch,startedAt:null,expiresAt:null});
 let collie=docs['groups/A/users/owner'].farm.guardDogs.find(d=>d.breedId==='collie');
 await page.evaluate(async()=>{const {notify}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');await notify();});
 await scene('WarehouseScene');await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').handleItemClick('guard:collie','邊境牧羊犬'));
 assert.equal(await page.getByRole('button',{name:'開始護衛',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').handleItemClick('guard:pyrenees','大白熊犬'));await page.getByRole('button',{name:'解除護衛並放棄租期',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').handleItemClick('guard:collie','邊境牧羊犬'));await page.getByRole('button',{name:'開始護衛',exact:true}).click();await page.locator('[data-guard-dog-dialog]').waitFor({state:'detached'});
 collie=docs['groups/A/users/owner'].farm.guardDogs.find(d=>d.breedId==='collie');assert.equal(collie.expiresAt,collie.startedAt+DAY);
 await scene('MyFarmScene');await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').guardDog?.texture.key==='guard_collie');
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').guardDog?.getData('guardActivity')==='run');
 await page.waitForTimeout(1800);await page.screenshot({path:'/tmp/collie-flock-patrol.png',fullPage:true});
 await page.evaluate(async()=>{
  const s=__farmGame.scene.getScene('MyFarmScene'),dog=s.guardDog;
  const {getThreatZones,pointIsSafe}=await import('/js/farm/hen-navigation.js');
  const zones=getThreatZones(s);if(!zones.some(z=>z.friendlyGuard)||pointIsSafe({x:dog.x,y:dog.y-30},zones))throw Error('Collie must be a friendly hen obstacle');
  for(const hen of s.hensGroup){s.tweens.killTweensOf(hen);hen.walkTimer?.remove();hen.walkPath=[];hen.setPosition(dog.x,dog.y-30);}
  s.avoidPredators();if(s.hensGroup.some(h=>!h.isEvading))throw Error('Hens must evade the roaming collie');
  dog.setData('guardPatrolStartedAt',s.time.now-19000);s.events.emit('farm-viewport-resize');
  if(dog.getData('guardActivity')!=='rest')throw Error('Collie should return/rest in its 40 percent phase');
  dog.setData('guardPatrolStartedAt',s.time.now);s.events.emit('farm-viewport-resize');
  if(dog.getData('guardActivity')!=='run')throw Error('Collie should run in its 60 percent phase');
 });
 // The new dog must not disable the existing timed egg-laying visit.
 await page.evaluate(async()=>{
  const s=__farmGame.scene.getScene('MyFarmScene'),{BREEDS}=await import('/js/farm/poultry.js');
  s.farmData.hensState.forEach(h=>{h.laidAt=Date.now()-BREEDS.hen.interval+5000;});s.layingVisit.update();
  if(!s.layingVisit.task)throw Error('Friendly collie must not suppress coop-door laying');
 });
 await identity('thief','小偷');await clock(collie.startedAt+5*3600000);await scene('VisitScene',{targetAccountId:'owner',targetName:'主人',targetGroupId:'A'});
 await page.waitForFunction(()=>__farmGame.scene.getScene('VisitScene').guardDog?.texture.key==='guard_collie');
 const collieEggs=docs['groups/A/users/owner'].farm.eggsReady;
 await page.evaluate(async()=>{Math.random=()=>.79999;await __farmGame.scene.getScene('VisitScene').attemptSteal();});
 assert.equal(docs['groups/A/users/owner'].farm.eggsReady,collieEggs);assert.ok(docs[notices().at(-1)].text.includes('邊境牧羊犬'));
 const collieBlock=Math.max(...Object.values(docs['groups/A/users/thief'].farm.villageStealBlockedUntil));assert.equal(collieBlock,collie.startedAt+9*3600000);
 const {settlePoultry}=await import('../js/farm/poultry.js');
 const readyAtRelease=Object.values(settlePoultry(docs['groups/A/users/owner'].farm,collieBlock).ready).reduce((sum,count)=>sum+count,0);
 await clock(collieBlock);await page.evaluate(async()=>{Math.random=()=>.8;await __farmGame.scene.getScene('VisitScene').attemptSteal();});assert.equal(docs['groups/A/users/owner'].farm.eggsReady,readyAtRelease-1);
 await clock(collie.expiresAt);await page.waitForFunction(()=>!__farmGame.scene.getScene('VisitScene').guardDog);
 assert.deepEqual(errors,[]);console.log('PASS: arbitrary rental price, duplicate protection, pending clock, warehouse activation, resting/walking dog, 70% interception with retry-safe owner/channel notification, 4h/1h cooldowns, unguarded theft, cross-group routing, expiry and irreversible release; beagle 33%/2h, 20/100 pricing, breed-specific art/text and real two-breed switching; 10-hen body separation while patrolling, nesting and resizing; collie visible at 200/1000 but UI and server reject new rentals despite client tampering; existing collie 80%/4h, activation/expiry, 60% patrol, hen avoidance and normal laying');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
