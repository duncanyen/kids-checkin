// Run with a local static server: FARM_BASE_URL=http://127.0.0.1:8006 node tests/farm-dragon.cjs
// All Firestore reads, transactions and listeners use an isolated in-memory database.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const base = process.env.FARM_BASE_URL || 'http://127.0.0.1:8000';
const firestore = `
const prefix='groups/dragon-test/users/';
const seed={coins:150,hens:2,coopLevel:2,eggsReady:2,lastLayTime:Date.now(),cleanliness:0,warehouseLimit:10,hensState:[{},{}],equippedWeapon:'club',mace:1};
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
window.__farmTest={docs,commits:0,patch:(who,values)=>{const farm=docs[prefix+who].farm;Object.assign(farm,values);if(farm.poultryVersion===2&&'eggsReady' in values&&!('readyEggs' in values))farm.readyEggs={hen:values.eggsReady,silkie:0,bresse:0};notify();}};
`;
(async () => {
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const phaser=execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:firestore}));
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','window.__farmGame =')});});
 await page.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',groupId:'dragon-test',name:'測試玩家'})));
 await page.goto(base+'/farmgame.html');
 await page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').hensGroup?.length===2);
 const checks=[];
 // Home encounters use a separate exact 1/20 roll, only on valid collection attempts.
 await page.evaluate(async()=>{
  const {rollHomeDragonEncounter}=await import('/js/farm/dragon.js');
  for(const level of [2,3]){
   let wins=0;for(let n=1;n<=20;n++)if(rollHomeDragonEncounter(level,(_,max)=>{if(max!==20)throw Error('Wrong home odds');return n;}))wins++;
   if(wins!==1)throw Error('Home chance must be exactly 1/20');
  }
  if(rollHomeDragonEncounter(1,()=>{throw Error('Level 1 must not roll');}))throw Error('Level 1 dragon');
 });
 async function homeHarvest(roll=1){
  await page.evaluate(async roll=>{
   const old=Phaser.Math.Between;window.__homeRolls=0;
   Phaser.Math.Between=(min,max)=>{if(max===20){window.__homeRolls++;return roll;}return max;};
   try{await window.__farmGame.scene.getScene('MyFarmScene').harvestEgg();}finally{Phaser.Math.Between=old;}
  },roll);
 }
 await page.evaluate(()=>window.__farmTest.patch('self',{coopLevel:1}));
 await homeHarvest();
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');if(s.dragonEncounter||window.__homeRolls||s.farmData.inventoryEggs!==2)throw Error('Level 1 home harvest failed');});
 await homeHarvest();
 await page.evaluate(()=>{if(window.__homeRolls)throw Error('Empty coop must not roll');window.__farmTest.patch('self',{coopLevel:2,eggsReady:2,inventoryEggs:0,equippedWeapon:'mace'});});
 await homeHarvest(20);
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');if(s.dragonEncounter||window.__homeRolls!==1||s.farmData.inventoryEggs!==2)throw Error('Non-encounter harvest failed');window.__farmTest.patch('self',{eggsReady:2,inventoryEggs:0});});
 await homeHarvest();
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('MyFarmScene'),b=s.dragonEncounter;
  if(!b||b.damage!==10||b.targetAccountId!=='self'||s.farmData.eggsReady!==2||s.farmData.inventoryEggs)throw Error('Home encounter did not protect uncollected eggs');
  await s.harvestEgg();if(s.farmData.eggsReady!==2||s.dragonEncounter!==b)throw Error('Repeated click bypassed defense');
  const {henRouteIsSafe}=await import('/js/farm/hen-navigation.js');
  const hen=s.hensGroup[0];b.flight.pause();b.sprite.setPosition(hen.x+40,hen.y+20);s.avoidPredators();
  if(!henRouteIsSafe(s,hen))throw Error('Home hen route crosses dragon');
  for(let n=0;n<60;n++)b.hit();
 });
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').dragonEncounter?.settled);
 await homeHarvest();
 await page.evaluate(()=>{
  const s=window.__farmGame.scene.getScene('MyFarmScene');
  if(window.__homeRolls||s.dragonEncounter||s.farmData.eggsReady||s.farmData.inventoryEggs!==2||s.farmData.dragonScales!==1)throw Error('Victory must allow next collection without another roll');
  window.__farmTest.patch('self',{eggsReady:3,inventoryEggs:0,coins:50});
 });
 await homeHarvest();
 await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').dragonEncounter.resolve('loss'));
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').dragonEncounter.settled);
 await page.evaluate(()=>{
  const docs=window.__farmTest.docs;
  if(docs['groups/dragon-test/users/self'].farm.coins!==0||docs['groups/dragon-test/users/self'].farm.eggsReady!==0||docs['groups/dragon-test/users/neighbor'].farm.eggsReady!==5)throw Error('Home loss must affect only home farm');
  window.__farmTest.patch('self',{eggsReady:2,inventoryEggs:0,coins:150,equippedWeapon:'club'});
 });
 checks.push('home: exact 1/20 at Lv.2+, real collection trigger, no empty/repeated rolls, mace damage, hen avoidance, victory collection and own-only loss');
 // Exhaust all 30 dragon rolls; preserve existing events for ineligible farms.
 await page.evaluate(async()=>{
  const {rollVisitEncounter}=await import('/js/farm/dragon.js');
  for(const level of [2,3]){
   let dragons=0;for(let n=1;n<=30;n++){let first=true;const value=rollVisitEncounter(level,(_,max)=>{if(first){first=false;return n;}return max;});if(value==='dragon')dragons++;}
   if(dragons!==1)throw Error('Encounter chance must be exactly 1/30');
  }
  if(rollVisitEncounter(1,()=>1)!=='tiger')throw Error('Level 1 must retain old events, never dragon');
  const {getUsedSpace}=await import('/js/farm/constants.js');if(getUsedSpace({dragonScales:3,worms:2})!==5)throw Error('Dragon loot missing from capacity');
 });
 checks.push('level gate, exact 1/30 chance, inventory capacity');
 async function visit(weapon='club'){
  await page.evaluate(weapon=>{
   window.__farmTest.patch('self',{equippedWeapon:weapon,[weapon]:1});
   window.__savedBetween=Phaser.Math.Between;Phaser.Math.Between=(_,max)=>max;
   const game=window.__farmGame;
   game.scene.getScene('VisitScene').hasRolledEncounter=false;
   const active=game.scene.getScenes(true)[0];active.scene.start('VisitScene',{targetAccountId:'neighbor',targetName:'鄰居'});
  },weapon);
  await page.waitForFunction(()=>window.__farmGame.scene.isActive('VisitScene')&&window.__farmGame.scene.getScene('VisitScene').hasRolledEncounter);
  await page.evaluate(()=>{Phaser.Math.Between=window.__savedBetween;const s=window.__farmGame.scene.getScene('VisitScene');if(s.dragon)throw Error('Maximum roll should not spawn an event');s.spawnDragonEvent();});
 }
 for(const [weapon,hits] of [['club',600],['mace',60]]){
  await visit(weapon);
  await page.evaluate(hits=>{
   const s=window.__farmGame.scene.getScene('VisitScene'),b=s.dragonEncounter;
   if(b.sprite.displayWidth!==176||b.sprite.frame.width!==256)throw Error('Wrong dragon display size');
   for(const name of ['fly','fire','hit','dead'])if(s.anims.get('dragon_'+name).frames.length!==8)throw Error('Missing animation frames');
   window.__beforeLoot=window.__farmTest.docs['groups/dragon-test/users/self'].farm.dragonScales||0;
   for(let i=0;i<hits-1;i++)b.sprite.emit('pointerdown',{x:b.sprite.x,y:b.sprite.y});
   if(b.result||b.health!==b.damage)throw Error('Dragon defeated before required hits');
   b.sprite.emit('pointerdown',{x:b.sprite.x,y:b.sprite.y});
   b.sprite.emit('pointerdown',{});b.resolve('loss');b.resolve('win');
   if(b.result!=='win'||b.sprite.input.enabled||b.sprite.anims.currentAnim.key!=='dragon_dead')throw Error('Victory did not lock input');
  },hits);
  await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').dragonEncounter.settled);
  await page.evaluate(async()=>{
   const s=window.__farmGame.scene.getScene('VisitScene'),b=s.dragonEncounter;
   const {settleDragonEncounter}=await import('/js/farm/dragon.js');
   await Promise.all([settleDragonEncounter(b.id,'win','neighbor'),settleDragonEncounter(b.id,'loss','neighbor')]);
   const docs=window.__farmTest.docs;
   if(docs['groups/dragon-test/users/self'].farm.dragonScales!==window.__beforeLoot+1)throw Error('Duplicate or missing loot');
   if(docs['groups/dragon-test/users/neighbor'].farm.eggsReady!==5)throw Error('Victory removed neighbor eggs');
  });
  checks.push(weapon+': exactly '+hits+' hits, one guaranteed reward, replay safe');
 }
 // Future weapons use their configured damage without another enemy-specific table.
 await page.evaluate(async()=>{const {WEAPONS_CONFIG}=await import('/js/farm/constants.js');WEAPONS_CONFIG.testWeapon={name:'測試武器',damage:20,icon:'mace'};});
 await visit('testWeapon');
 await page.evaluate(()=>{const b=window.__farmGame.scene.getScene('VisitScene').dragonEncounter;for(let i=0;i<29;i++)b.hit();if(b.result||b.health!==20)throw Error('Future weapon damage ignored');b.hit();});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').dragonEncounter.settled);
 checks.push('future weapon configuration');
 // One accelerated real scene-clock battle verifies 10 seconds flight + 30 fire,
 // including hits in both phases without postponing the deadline.
 await page.evaluate(()=>window.__farmTest.patch('self',{coins:150}));
 await visit();
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene'),b=s.dragonEncounter;if(b.sprite.x!==58||b.sprite.y<600)throw Error('Flight must start bottom-left');s.time.timeScale=10;s.tweens.timeScale=10;b.hit();});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').dragonEncounter.phase==='fire');
 await page.evaluate(()=>{
  const s=window.__farmGame.scene.getScene('VisitScene'),b=s.dragonEncounter;
  if(!b.flame.visible||b.sprite.flipX||Math.abs(b.sprite.x-b.destination.x)>1||b.sprite.x>=s.coop.x)throw Error('Dragon must breathe right from left of coop');
  const remaining=b.deadlineTimer.getRemaining();if(remaining>30000||remaining<27000)throw Error('Fire phase must begin at 10 seconds');
  b.hit();if(b.deadlineTimer.getRemaining()!==remaining)throw Error('Hit delayed combat');
 });
 if(process.env.FARM_SCREENSHOTS)await page.screenshot({path:process.env.FARM_SCREENSHOTS+'/dragon-fire.png'});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').dragonEncounter.settled);
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('VisitScene'),b=s.dragonEncounter,own=window.__farmTest.docs['groups/dragon-test/users/self'].farm;
  if(b.result!=='loss'||own.coins!==50||window.__farmTest.docs['groups/dragon-test/users/neighbor'].farm.eggsReady!==0||own.eggsReady!==2)throw Error('Timeout must burn target eggs and deduct 100 visitor coins');
  const {settleDragonEncounter}=await import('/js/farm/dragon.js');await settleDragonEncounter(b.id,'loss','neighbor');
  if(window.__farmTest.docs['groups/dragon-test/users/self'].farm.coins!==50)throw Error('Repeated penalty');
  s.time.timeScale=1;s.tweens.timeScale=1;
 });
 checks.push('10s flight + 30s fire, hits never postpone 40s deadline, atomic loss and no duplicate penalty');
 await visit();
 await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').dragonEncounter.resolve('loss'));
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').dragonEncounter.settled);
 await page.evaluate(()=>{if(window.__farmTest.docs['groups/dragon-test/users/self'].farm.coins!==0)throw Error('Coins must floor at zero');});
 // Full warehouse must never discard a boss reward; transient failures are retryable.
 await page.evaluate(()=>window.__farmTest.patch('self',{worms:10,warehouseLimit:10}));
 await visit('mace');
 await page.evaluate(()=>{window.__farmTest.failNext=true;const b=window.__farmGame.scene.getScene('VisitScene').dragonEncounter;window.__beforeLoot=window.__farmTest.docs['groups/dragon-test/users/self'].farm.dragonScales;b.health=10;b.hit();});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').dragonEncounter.warning.text.includes('重試'));
 await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').dragonEncounter.warning.emit('pointerdown'));
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').dragonEncounter.settled);
 await page.evaluate(()=>{const b=window.__farmGame.scene.getScene('VisitScene').dragonEncounter;if(!b.warning.text.includes('倉庫已滿')||window.__farmTest.docs['groups/dragon-test/users/self'].farm.dragonScales!==window.__beforeLoot+1)throw Error('Full warehouse lost guaranteed loot');});
 checks.push('zero coin floor, full warehouse loot, failed settlement retry');
 // Warehouse presentation and the real shop modal / transaction callback.
 await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('WarehouseScene'));
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('WarehouseScene').farmData?.dragonScales>0);
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('WarehouseScene');if(!s.itemsPanel.list.some(o=>o.texture?.key==='dragon_scale'))throw Error('Warehouse icon absent');s.handleItemClick('dragonScales','龍麟');if(s.actionPanel.visible)throw Error('Scale must not open feed action');s.scene.start('ShopScene');});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene')&&window.__farmGame.scene.getScene('ShopScene').farmData?.dragonScales>0);
 await page.evaluate(()=>{
  const s=window.__farmGame.scene.getScene('ShopScene');if(!s.sellContainer.list.some(o=>o.texture?.key==='dragon_scale'))throw Error('Shop icon absent');
  const farm=window.__farmTest.docs['groups/dragon-test/users/self'].farm;
  window.__sale={coins:farm.coins,count:farm.dragonScales};
  s.openTradeModal('sell','dragonScales','龍麟',200);if(!s.dialogContainer.visible||s.currentMaxQty!==farm.dragonScales)throw Error('Sell modal quantity wrong');s.confirmTradeCallback(1);
 });
 await page.waitForFunction(()=>window.__farmTest.docs['groups/dragon-test/users/self'].farm.coins===window.__sale.coins+200);
 await page.evaluate(()=>{if(window.__farmTest.docs['groups/dragon-test/users/self'].farm.dragonScales!==window.__sale.count-1)throw Error('Sale did not consume loot');});
 checks.push('warehouse icon, shop sale consumes one scale and grants 200 coins');
 // Exercise real snapshot-driven encounter creation and ensure later updates do not reroll.
 for(const level of [1,2,3]){
  await page.evaluate(level=>{
   window.__farmTest.patch('neighbor',{coopLevel:level,eggsReady:5});
   window.__savedBetween=Phaser.Math.Between;Phaser.Math.Between=(min,max)=>max===30?(level>=3?2:1):max;
   const game=window.__farmGame;game.scene.getScene('VisitScene').hasRolledEncounter=false;
   game.scene.getScenes(true)[0].scene.start('VisitScene',{targetAccountId:'neighbor',targetName:'鄰居'});
  },level);
  await page.waitForFunction(()=>window.__farmGame.scene.isActive('VisitScene')&&window.__farmGame.scene.getScene('VisitScene').hasRolledEncounter);
  await page.evaluate(level=>{
   Phaser.Math.Between=window.__savedBetween;
   const s=window.__farmGame.scene.getScene('VisitScene');
   if(level===1){if(s.dragon||!s.tiger.active)throw Error('Level 1 encounter gate failed');}
   else{
    const b=s.dragonEncounter;if(!b||b.arrivalTimer.delay!==10000||b.deadlineTimer.delay!==40000)throw Error('Eligible dragon encounter not initialized');
    window.__farmTest.patch('neighbor',{eggsReady:4});
    if(s.dragonEncounter!==b)throw Error('Snapshot rerolled encounter');
    // A click on the expiry boundary must lose even before the timeout callback runs.
    if(level===3){b.health=b.damage;b.deadlineTimer.elapsed=40000;b.hit();if(b.result!=='loss')throw Error('Late hit won an expired battle');}
   }
  },level);
  if(level===3)await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').dragonEncounter.settled);
 }
 checks.push('snapshot level gate, one roll per visit, 40-second expiry boundary');
 await visit();
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');window.__oldBattle=s.dragonEncounter;window.__commits=window.__farmTest.commits;s.scene.start('MyFarmScene');});
 await page.waitForTimeout(500);
 await page.evaluate(()=>{const b=window.__oldBattle;if(!b.destroyed||b.sprite.active||b.flame.active)throw Error('Shutdown retained dragon objects');b.resolve('loss');b.hit();if(window.__farmTest.commits!==window.__commits)throw Error('Exited battle wrote a delayed result');});
 checks.push('scene shutdown removes battle and prevents delayed writes');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks,errors}));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
