// Run with a local static server: FARM_BASE_URL=http://127.0.0.1:8006 node tests/farm-gorilla.cjs
// All Firestore reads, transactions and listeners use an isolated in-memory database.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const base = process.env.FARM_BASE_URL || 'http://127.0.0.1:8012';
const firestore = `
const prefix='groups/dragon-test/users/';
const seed={coins:150,hens:2,coopLevel:3,eggsReady:2,lastLayTime:Date.now(),cleanliness:0,warehouseLimit:10,hensState:[{},{}],equippedWeapon:'club'};
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
 async function patch(data){await page.evaluate(data=>window.__farmTest.patch('self',data),data);}
 async function start(weapon='club'){
  await patch({coopLevel:3,eggsReady:2,inventoryEggs:0,coins:150,warehouseLimit:99,worms:0,equippedWeapon:weapon});
  await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');s.gorillaEncounter?.destroy();s.gorillaEncounter=null;s.gorilla=null;s.dragonEncounter?.destroy();s.dragonEncounter=null;s.dragon=null;const old=Phaser.Math.Between;Phaser.Math.Between=(min,max)=>max===60?1:max;try{await s.harvestEgg();}finally{Phaser.Math.Between=old;}});
  await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter);
 }
 for(const [weapon,hits]of [['club',1000],['mace',200]]){
  await start(weapon);
  await page.evaluate(async hits=>{
   const s=window.__farmGame.scene.getScene('MyFarmScene'),b=s.gorillaEncounter;
   if(b.health!==1000||Math.abs(b.sprite.displayWidth-208)>1||(b.sprite.frame.width<313||b.sprite.frame.width>314))throw Error('Wrong boss health/size/texture');
   for(const action of ['run','attack','hit','dead'])if(s.anims.get('gorilla_'+action).frames.length!==4)throw Error('Missing animation');
   if(b.sprite.flipX||b.sprite.y<600||b.destination.x>=s.coop.x||b.destination.x<90)throw Error('Wrong approach route');
   await s.harvestEgg();if(s.gorillaEncounter!==b||s.farmData.eggsReady!==2)throw Error('Collection bypassed active boss');
   window.__lootBefore=s.farmData.gorillaFangs||0;
   const {henRouteIsSafe}=await import('/js/farm/hen-navigation.js');const hen=s.hensGroup[0];b.flight.pause();b.sprite.setPosition(hen.x+25,hen.y+20);s.avoidPredators();if(!henRouteIsSafe(s,hen))throw Error('Hens cross gorilla');
   for(let i=0;i<hits-1;i++)b.hit();if(b.result||b.health!==b.damage)throw Error('Early victory');
   b.hit();b.hit();b.resolve('loss');if(b.result!=='win'||b.sprite.input.enabled)throw Error('Boss not locked on win');
  },hits);
  await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter.settled);
  await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),b=s.gorillaEncounter;const {settleGorillaEncounter}=await import('/js/farm/gorilla.js');await Promise.all([settleGorillaEncounter(b.id,'win'),settleGorillaEncounter(b.id,'loss')]);if(s.farmData.gorillaFangs!==window.__lootBefore+1)throw Error('Missing/duplicated reward');});
  await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');const old=Phaser.Math.Between;Phaser.Math.Between=()=>1;try{await s.harvestEgg();}finally{Phaser.Math.Between=old;}if(s.gorillaEncounter||s.dragonEncounter||s.farmData.inventoryEggs!==2||s.farmData.eggsReady)throw Error('Victory did not permit collection without another roll');});
  checks.push(weapon+': '+hits+' hits, mutual exclusion, hen avoidance, one reward/replay protection and collection after victory');
 }
 // Real scene clock accelerated equally for timers/tweens: 10s approach +30s attack.
 await start();
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');s.time.timeScale=8;s.tweens.timeScale=8;s.gorillaEncounter.hit();});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter.phase==='attack');
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),b=s.gorillaEncounter;const remaining=b.deadlineTimer.getRemaining();if(remaining>30000||remaining<26000)throw Error('Attack did not start at 10 sec');if(Math.abs(b.sprite.x-b.destination.x)>1||b.sprite.flipX||!b.flame.visible||!b.sprite.frame.customPivot)throw Error('Wrong right-facing coop attack');b.hit();if(b.deadlineTimer.getRemaining()!==remaining)throw Error('Hit extended timeout');});
 await page.screenshot({path:'/tmp/gorilla-attack.png',fullPage:true});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter.settled);
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');if(s.gorillaEncounter.result!=='loss'||s.farmData.coins!==50||s.farmData.eggsReady!==0)throw Error('Timeout penalty incorrect');if(window.__farmTest.docs['groups/dragon-test/users/neighbor'].farm.eggsReady!==5)throw Error('Neighbor affected');s.time.timeScale=1;s.tweens.timeScale=1;});
 checks.push('10s run +30s rightward attack, deadline unchanged by hits, atomic own-only egg loss and -100 coins');
 await start();await patch({coins:30});await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter.resolve('loss'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter.settled);
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),b=s.gorillaEncounter;const {settleGorillaEncounter}=await import('/js/farm/gorilla.js');await settleGorillaEncounter(b.id,'loss');if(s.farmData.coins!==0)throw Error('Coins not floored/replay applied');let denied=false;try{await settleGorillaEncounter('foreign','loss','neighbor','closed-group');}catch{denied=true;}if(!denied)throw Error('Inaccessible village mutation allowed');});
 // Full inventory still gets guaranteed boss loot; failed settlement can be retried.
 await start('mace');await patch({warehouseLimit:1,worms:1});await page.evaluate(()=>{window.__farmTest.failNext=true;const b=window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter;b.health=5;b.hit();});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter.warning.text.includes('重試'));
 await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter.warning.emit('pointerdown'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter.settled);
 await page.evaluate(()=>{const b=window.__farmGame.scene.getScene('MyFarmScene').gorillaEncounter;if(!b.warning.text.includes('倉庫已滿'))throw Error('Full inventory loot not reported');});
 // Warehouse recognizes the new item as a trophy, and shop pays 300 each.
 await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('WarehouseScene'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('WarehouseScene').farmData);
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('WarehouseScene');if(!s.allConfigItems.some(i=>i.key==='gorillaFangs'&&i.icon==='gorilla_fang'))throw Error('Loot absent from warehouse');s.handleItemClick('gorillaFangs','猩猩尖牙');if(s.actionPanel.visible)throw Error('Trophy offered as hen food');const {getUsedSpace}=await import('/js/farm/constants.js');if(getUsedSpace({gorillaFangs:3})!==3)throw Error('Capacity excludes trophy');});
 await page.screenshot({path:'/tmp/gorilla-warehouse.png',fullPage:true});
 await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').scene.start('ShopScene'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData);
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('ShopScene');const before=s.farmData.coins,fangs=s.farmData.gorillaFangs;s.sellContainer.setVisible(true);s.buyContainer.setVisible(false);s.openTradeModal('sell','gorillaFangs','猩猩尖牙',300);await s.confirmTradeCallback(1);});
 await page.waitForFunction(()=>!window.__farmGame.scene.getScene('ShopScene').isProcessing);
 const sold=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('ShopScene');return{coins:s.farmData.coins,fangs:s.farmData.gorillaFangs};});
 if(sold.coins!==450||sold.fangs!==2)throw Error('Wrong sale payout or quantity: '+JSON.stringify(sold));
 checks.push('low coin floor, village access guard, full-inventory reward, retry, warehouse trophy behavior, 300-coin sale');
 // A scene change removes every boss object and timer.
 await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('MyFarmScene'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').farmData);await start();
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');window.__oldGorilla=s.gorillaEncounter;s.scene.start('ShopScene');});
 await page.waitForFunction(()=>window.__oldGorilla.destroyed);assert.deepEqual(errors,[]);
 checks.push('scene shutdown cleanup');
 // A Lv.1 visitor still meets gorillas at a Lv.3 target coop, once per visit.
 await patch({coopLevel:1,coins:150,inventoryEggs:0,warehouseLimit:99,equippedWeapon:'mace'});
 await page.evaluate(()=>{
  window.__farmTest.patch('neighbor',{coopLevel:3,eggsReady:7});
  window.__visitRolls=0;Phaser.Math.Between=(min,max)=>{if(max===30){window.__visitRolls++;return 1;}return max;};
  window.__farmGame.scene.getScene('ShopScene').scene.start('VisitScene',{targetAccountId:'neighbor',targetName:'鄰居'});
 });
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').gorillaEncounter);
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('VisitScene'),b=s.gorillaEncounter;
  if(b.targetAccountId!=='neighbor'||b.targetGroupId!=='dragon-test'||s.dragonEncounter||window.__visitRolls!==1)throw Error('Visit target/one-roll gate incorrect');
  window.__farmTest.patch('neighbor',{eggsReady:7});if(window.__visitRolls!==1||s.gorillaEncounter!==b)throw Error('Snapshot respawned gorilla');
  const commits=window.__farmTest.commits;await s.attemptSteal();if(window.__farmTest.commits!==commits||s.myFarmData.inventoryEggs!==0)throw Error('Stealing bypassed fight');
  window.__visitLoot=s.myFarmData.gorillaFangs;b.health=5;b.hit();
 });
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').gorillaEncounter.settled);
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('VisitScene');if(s.myFarmData.gorillaFangs!==window.__visitLoot+1||s.targetFarmData.eggsReady!==7)throw Error('Visit loot saved to wrong farm');Math.random=()=>0;await s.attemptSteal();if(s.myFarmData.inventoryEggs!==1||s.targetFarmData.eggsReady!==6)throw Error('Cannot steal after victory');});
 checks.push('Lv.3 target eligibility independent of player level, one boss per visit, blocks stealing until victory, own reward and post-victory theft');
 // Across public villages: burn target eggs, charge source player, preserve all other farms.
 await page.evaluate(()=>{
  const docs=window.__farmTest.docs;docs['groups/dragon-test'].farmVillageVisibility='public';
  docs['groups/other']={farmVillageVisibility:'public',members:['neighbor','self']};
  docs['groups/other/users/neighbor']={farm:{...structuredClone(docs['groups/dragon-test/users/neighbor'].farm),eggsReady:5,coins:777}};
  docs['groups/other/users/self']={farm:{coins:999,eggsReady:9}};
  window.__farmGame.scene.getScene('VisitScene').scene.restart({targetGroupId:'other',targetAccountId:'neighbor',targetName:'其他村落鄰居'});
 });
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').gorillaEncounter?.targetGroupId==='other');
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');window.__ownEggs=s.myFarmData.eggsReady;s.gorillaEncounter.resolve('loss');});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').gorillaEncounter.settled);
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('VisitScene'),b=s.gorillaEncounter,docs=window.__farmTest.docs;
  const {settleGorillaEncounter}=await import('/js/farm/gorilla.js');await settleGorillaEncounter(b.id,'loss','neighbor','other');
  if(s.myFarmData.coins!==50||s.myFarmData.eggsReady!==window.__ownEggs||s.targetFarmData.eggsReady!==0||s.targetFarmData.coins!==777)throw Error('Cross-group penalty ownership wrong');
  if(docs['groups/dragon-test/users/neighbor'].farm.eggsReady!==6||docs['groups/other/users/self'].farm.coins!==999||docs['groups/other/users/self'].farm.eggsReady!==9)throw Error('Unrelated farm changed');
  docs['groups/other'].farmVillageVisibility='closed';const before=window.__farmTest.commits;let denied=false;try{await settleGorillaEncounter('denied','loss','neighbor','other');}catch{denied=true;}if(!denied||window.__farmTest.commits!==before)throw Error('Closed village accepted settlement');
 });
 checks.push('cross-group target egg loss/source coins, own eggs/other accounts untouched, idempotent retry, closed-village rejection');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
