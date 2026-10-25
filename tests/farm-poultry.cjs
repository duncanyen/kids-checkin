// Run with a local static server: FARM_BASE_URL=http://127.0.0.1:8006 node tests/farm-gorilla.cjs
// All Firestore reads, transactions and listeners use an isolated in-memory database.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const base = process.env.FARM_BASE_URL || 'http://127.0.0.1:8012';
const firestore = `
const prefix='groups/dragon-test/users/';
const seed={coins:150,hens:2,coopLevel:3,eggsReady:2,lastLayTime:Date.now(),cleanliness:0,warehouseLimit:10,hensState:[{},{}],equippedWeapon:'club',mace:1};
const docs={'groups/dragon-test':{members:['self','neighbor']},[prefix+'self']:{farm:structuredClone(seed)},[prefix+'neighbor']:{farm:{...structuredClone(seed),eggsReady:5}}};
const listeners=new Map();
const snapshot=ref=>({exists:()=>!!docs[ref.path],data:()=>structuredClone(docs[ref.path])});
function notify(){for(const [path,cbs] of listeners)for(const cb of cbs)cb(snapshot({path}));}
export const doc=(_, ...parts)=>({path:parts.join('/')});
export const collection=doc,query=doc,where=doc;
export function onSnapshot(ref,cb){if(!listeners.has(ref.path))listeners.set(ref.path,new Set());listeners.get(ref.path).add(cb);queueMicrotask(()=>cb(snapshot(ref)));return()=>listeners.get(ref.path).delete(cb);}
export const getDoc=async ref=>snapshot(ref);
export const getDocs=async()=>({forEach:()=>{}});
const deny=()=>{throw Error('Unexpected write outside a mocked transaction');};
export const setDoc=deny,updateDoc=deny,addDoc=deny,serverTimestamp=deny;
let queue=Promise.resolve();
export function runTransaction(_,callback){const run=queue.then(async()=>{
 if(window.__farmTest.failNext){window.__farmTest.failNext=false;throw Error('Simulated offline');}
 const writes=[];
 const result=await callback({get:async ref=>snapshot(ref),update:(ref,values)=>writes.push([ref,values])});
 for(const [ref,values] of writes) for(const [key,value] of Object.entries(values)){
  const bits=key.split('.');let object=docs[ref.path];for(const bit of bits.slice(0,-1))object=object[bit]??={};object[bits.at(-1)]=structuredClone(value);
 }
 if(writes.length){window.__farmTest.commits++;notify();}
 return result;
 });queue=run.catch(()=>{});return run;}
window.__farmTest={docs,commits:0,patch:(who,values)=>{Object.assign(docs[prefix+who].farm,values);notify();}};
`;
(async () => {
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const phaser=require('node:fs').existsSync('/tmp/kids-phaser.js')?require('node:fs').readFileSync('/tmp/kids-phaser.js','utf8'):execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:firestore}));
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','window.__farmGame =')});});
 await page.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',groupId:'dragon-test',name:'測試玩家'})));
 await page.goto(base+'/farmgame.html');
 await page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').hensGroup?.length===2);


 const checks=[];
 await page.evaluate(()=>{window.__farmTest.patch('self',{coins:30000,warehouseLimit:99,coopLevel:1});window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene');});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('ShopScene'),f=()=>window.__farmTest.docs['groups/dragon-test/users/self'].farm;
  s.openTradeModal('buy','silkie','烏骨雞',2000);if(s.currentMaxQty!==1)throw Error('Shared coop limit wrong');s.dialogContainer.setVisible(false);
  await s.executeBuyHen(1,'silkie');if(f().coins!==28000||f().hens!==3||f().hensState.filter(h=>h.breed==='silkie').length!==1)throw Error('Silkie purchase wrong');
  await s.executeBuyHen(1,'bresse');if(f().coins!==28000||f().hens!==3)throw Error('Overfilled coop');
  await s.executeTradePoultry('hen',1,'sell');if(f().coins!==28500||f().hens!==2)throw Error('Original hen half-price sale wrong');
  await s.executeBuyHen(1,'bresse');if(f().coins!==24500||f().hens!==3||f().hensState.filter(h=>h.breed==='bresse').length!==1)throw Error('Bresse purchase wrong');
  for(const breed of ['hen','silkie','bresse'])for(const action of ['idle','walk'])if(s.anims.get(breed+'_'+action).frames.length!==8)throw Error('Missing breed animation');
  if(s.catalog.buy.length<=6||s.catalog.sell.length<=12)throw Error('Catalog missing items');
  s.changeShopPage(1);if(s.pageText.text!=='2 / 2')throw Error('Shop pagination broken');
  s.poultryGuide.setVisible(true);
 });
 await page.screenshot({path:'/tmp/farm-poultry-guide.png'});
 checks.push('silkie 2000/bresse 4000 purchases, mother hen 500 sale, shared coop capacity, paged catalog and breed guide, 8 idle +8 walk frames');
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('ShopScene');s.scene.start('MyFarmScene');});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').hensGroup?.length===3);
 await page.evaluate(()=>{
  const s=window.__farmGame.scene.getScene('MyFarmScene');
  if(s.hensGroup.map(h=>h.texture.key).sort().join(',')!=='bresse,hen,silkie')throw Error('Wrong home breed textures');
  s.isHenSitting=false;s.hensGroup.forEach((h,i)=>{s.tweens.killTweensOf(h);h.walkTimer?.remove();h.setPosition(95+i*100,450);h.play(h.hState.breed+'_idle');});
 });
 await page.screenshot({path:'/tmp/farm-poultry-home.png'});
 await page.evaluate(()=>{
  const f=window.__farmTest.docs['groups/dragon-test/users/self'].farm;
  window.__farmTest.patch('self',{hensState:f.hensState.map(h=>({...h,laidAt:Date.now()-24*3600000,pausedFull:false})),readyEggs:{hen:0,silkie:0,bresse:0},eggsReady:0,cleanliness:0});
 });
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').farmData.eggsReady===16);
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('MyFarmScene');Phaser.Math.Between=(_,max)=>max;
  const ready=s.farmData.readyEggs;if(ready.hen!==6||ready.silkie!==6||ready.bresse!==4)throw Error('Wrong 24h yields');
  await s.harvestEgg();const f=window.__farmTest.docs['groups/dragon-test/users/self'].farm;
  if(f.inventoryEggs!==6||f.silkieEggs!==6||f.bresseEggs!==4||f.eggsReady!==0)throw Error('Collection lost breed types');
  const {getUsedSpace}=await import('/js/farm/constants.js');if(getUsedSpace(f)!==17)throw Error('Breed eggs missing from warehouse space');
  // Prepare a feedable mixed flock, without making any breed due yet.
  window.__farmTest.patch('self',{worms:3,earthworms:3,hensState:f.hensState.map(h=>({...h,laidAt:Date.now()-(h.breed==='bresse'?5:3.5)*3600000,pausedFull:false})),cleanliness:0});
  s.scene.start('WarehouseScene');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene')&&window.__farmGame.scene.getScene('WarehouseScene').farmData);
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('WarehouseScene'),f=()=>window.__farmTest.docs['groups/dragon-test/users/self'].farm;
  if(Math.abs(s.hen.displayWidth-96)>1||s.hen.texture.key!=='hen')throw Error('Hen preview not normalized for atlas');
  for(const key of ['silkieEggs','bresseEggs'])if(!s.allConfigItems.some(i=>i.key===key))throw Error('Warehouse missing egg breed');
  await s.feedItem('worms');if(!s.feedPicker.visible||f().worms!==3)throw Error('Mixed feed did not ask first');
  s.feedBreedButtons.silkie.button.emit('pointerdown');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('WarehouseScene').farmData.worms===2);
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('WarehouseScene'),f=()=>window.__farmTest.docs['groups/dragon-test/users/self'].farm;
  if(f().readyEggs.silkie!==1||f().readyEggs.hen!==0||f().readyEggs.bresse!==0)throw Error('Feed affected wrong breed');
  await s.feedItem('earthworms','bresse');if(f().readyEggs.bresse!==1||f().earthworms!==2)throw Error('Earthworm boost wrong');
  const b=f().hensState.find(h=>h.breed==='bresse');window.__farmTest.patch('self',{hens:1,hensState:[{...b,laidAt:Date.now()-5*3600000}],readyEggs:{hen:0,silkie:0,bresse:0},eggsReady:0});
  await s.feedItem('earthworms');if(s.feedPicker.visible||f().readyEggs.bresse!==1||f().earthworms!==1)throw Error('Single breed should feed directly');
  window.__farmTest.patch('self',{hensState:[{...b,laidAt:Date.now(),pausedFull:true}],readyEggs:{hen:0,silkie:0,bresse:4},eggsReady:4});
  await s.feedItem('worms','bresse');if(f().worms!==2)throw Error('Consumed feed for full breed');
  s.scene.start('ShopScene');
 });
 checks.push('24h 6/6/4 eggs, typed collection and warehouse capacity, mixed breed feeding picker, 30/60 minute selected boost, direct single breed feeding, full-target no consumption');
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('ShopScene'),f=()=>window.__farmTest.docs['groups/dragon-test/users/self'].farm;const before=f().coins;
  await s.executeSellItem('inventoryEggs',10,'雞蛋',1);await s.executeSellItem('silkieEggs',30,'烏骨雞蛋',1);await s.executeSellItem('bresseEggs',60,'布雷斯雞蛋',1);
  if(f().coins!==before+100||f().silkieEggs!==5||f().bresseEggs!==3)throw Error('Egg sale price/count wrong');
  await s.executeTradePoultry('bresse',1,'sell');if(f().coins!==before+2100||f().hens!==0||f().readyEggs.bresse!==4)throw Error('Bresse sale lost mature eggs or not half price');
  await s.executeBuyHen(1,'silkie');await s.executeTradePoultry('silkie',1,'sell');if(f().coins!==before+1100||f().hens!==0)throw Error('Silkie half price sale wrong');
  s.scene.start('MyFarmScene');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').farmData?.hens===0);
 await page.evaluate(()=>{if(window.__farmGame.scene.getScene('MyFarmScene').hensGroup.length)throw Error('Phantom free hen after selling all');});
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');if(!s.coopEgg.visible||!s.coopEgg.input)throw Error('Empty coop eggs not collectible');s.coopEgg.emit('pointerdown');});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').farmData.eggsReady===0);
 await page.evaluate(()=>{if(window.__farmTest.docs['groups/dragon-test/users/self'].farm.bresseEggs!==7)throw Error('Cannot harvest after selling last bird');});
 checks.push('egg prices 10/30/60; bresse sale 2000 and silkie sale 1000; mature eggs retained and no phantom hen after selling all');
 await page.evaluate(()=>{
  const now=Date.now(),f=window.__farmTest.docs['groups/dragon-test/users/neighbor'].farm;
  window.__farmTest.patch('neighbor',{poultryVersion:2,coopLevel:3,hens:3,hensState:['hen','silkie','bresse'].map((breed,i)=>({id:'n'+i,breed,laidAt:now,isSick:false})),readyEggs:{hen:0,silkie:1,bresse:0},eggsReady:1});
  window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetAccountId:'neighbor',targetName:'鄰居'});
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('VisitScene')&&window.__farmGame.scene.getScene('VisitScene').hasRolledEncounter);
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('VisitScene');if(s.hensGroup.map(h=>h.texture.key).sort().join(',')!=='bresse,hen,silkie')throw Error('Wrong visit textures');
  Math.random=()=>0;await s.attemptSteal();const own=window.__farmTest.docs['groups/dragon-test/users/self'].farm,target=window.__farmTest.docs['groups/dragon-test/users/neighbor'].farm;
  if(own.silkieEggs!==6||target.eggsReady!==0||target.readyEggs.silkie!==0)throw Error('Stolen egg converted/lost');
  window.__farmTest.patch('neighbor',{readyEggs:{hen:2,silkie:3,bresse:4},eggsReady:9});
  const {settleGorillaEncounter}=await import('/js/farm/gorilla.js');await settleGorillaEncounter('poultry-loss','loss','neighbor');
  if(target.eggsReady!==0||Object.values(target.readyEggs).some(Boolean)||own.silkieEggs!==6)throw Error('Boss loss did not clear only target coop eggs');
 });
 checks.push('visit shows each breed, stealing retains silkie egg type, boss loss clears every target breed without touching warehouse');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
