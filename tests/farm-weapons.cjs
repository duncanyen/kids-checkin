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
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await page.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',groupId:'dragon-test',name:'測試玩家'})));
 await page.goto(base+'/farmgame.html');
 await page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').hensGroup?.length===2);

 const checks=[];
 await page.evaluate(async()=>{
  const {WEAPONS_CONFIG,hitsToDefeat,equippedWeapon}=await import('/js/farm/combat-rules.js');
  const expected={club:[200,200,600,1000],mace:[20,20,60,200],battleaxe:[5,10,20,40]};
  for(const [key,hits] of Object.entries(expected))for(const [i,enemy] of ['wolf','tiger','dragon','gorilla'].entries())if(hitsToDefeat(WEAPONS_CONFIG[key],enemy)!==hits[i])throw Error('Wrong balance '+key+' '+enemy);
  if(equippedWeapon({equippedWeapon:'battleaxe',battleaxe:0})!==WEAPONS_CONFIG.club)throw Error('Unowned axe usable');
  window.__farmTest.patch('self',{coins:10000,mace:1,battleaxe:0,warehouseLimit:99});
  window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('ShopScene'),farm=()=>window.__farmTest.docs['groups/dragon-test/users/self'].farm;
  // Use real shop confirmation flow. Buying must not auto-equip.
  s.openTradeModal('buy','battleaxe','雙手斧',5000);if(!s.dialogContainer.visible||s.currentMaxQty!==2)throw Error('Axe unavailable in shop');
  s.dialogContainer.list.find(child=>child.type==='Rectangle'&&child.x===130&&child.y===505).emit('pointerdown');await new Promise(r=>setTimeout(r,50));
  if(farm().coins!==5000||farm().battleaxe!==1||farm().equippedWeapon!=='club')throw Error('Purchase wrong data/equipped automatically');
  window.__farmTest.patch('self',{warehouseLimit:2});await s.executeBuyWeapon('battleaxe',1,5000);if(farm().battleaxe!==1||farm().coins!==5000)throw Error('Overfilled warehouse');
  window.__farmTest.patch('self',{warehouseLimit:99,coins:4999});await s.executeBuyWeapon('battleaxe',1,5000);if(farm().battleaxe!==1||farm().coins!==4999)throw Error('Bought without coins');
  s.weaponGuide.setVisible(true);
 });
 await page.screenshot({path:'/tmp/farm-weapons-guide.png'});
 checks.push('shop purchase 5000, capacity and balance validation, no auto-equip, attack guide');
 await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('WarehouseScene'));
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene')&&window.__farmGame.scene.getScene('WarehouseScene').farmData);
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('WarehouseScene'),farm=()=>window.__farmTest.docs['groups/dragon-test/users/self'].farm;
  if(!s.allConfigItems.some(i=>i.key==='battleaxe'))throw Error('Axe absent from warehouse');
  s.handleItemClick('battleaxe','雙手斧');if(!s.actionPanel.visible||s.textFeed.text!=='配備')throw Error('Equip UI absent');
  await s.toggleEquipWeapon('battleaxe',false);if(farm().equippedWeapon!=='battleaxe')throw Error('Equip failed');
  await s.toggleEquipWeapon('battleaxe',true);if(farm().equippedWeapon!=='club')throw Error('Unequip failed');
  window.__farmTest.patch('self',{battleaxe:0});await s.toggleEquipWeapon('battleaxe',false);if(farm().equippedWeapon!=='club')throw Error('Equipped unowned weapon');
  window.__farmTest.patch('self',{battleaxe:1});await s.toggleEquipWeapon('mace',false);
 });
 await page.screenshot({path:'/tmp/farm-weapons-warehouse.png'});
 await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').scene.start('ShopScene'));
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('ShopScene'),farm=()=>window.__farmTest.docs['groups/dragon-test/users/self'].farm;
  const before=farm().coins;
  s.openTradeModal('sell','mace','狼牙棒',1000);if(s.dialogContainer.visible)throw Error('Selling equipped mace allowed');
  await s.executeSellItem('mace',1000,'狼牙棒',1);if(farm().mace!==1||farm().coins!==before)throw Error('Equipped sale bypass');
  window.__farmTest.patch('self',{equippedWeapon:'club'});s.openTradeModal('sell','mace','狼牙棒',1000);
  // Simulate another tab equipping after opening dialog: rechecked in transaction.
  window.__farmTest.patch('self',{equippedWeapon:'mace'});await s.executeSellItem('mace',1000,'狼牙棒',1);if(farm().mace!==1)throw Error('Stale modal sale bypass');
  window.__farmTest.patch('self',{equippedWeapon:'club'});await s.executeSellItem('mace',1000,'狼牙棒',1);
  if(farm().mace!==0||farm().coins!==before+1000)throw Error('Wrong sale amount');
  await s.executeSellItem('mace',1000,'狼牙棒',1);if(farm().coins!==before+1000)throw Error('Sold nonexistent mace');
 });
 checks.push('warehouse equip/unequip and unowned protection, equipped and stale-dialog sale blocked, unequipped mace sale exactly 1000');
 await page.evaluate(()=>{
  window.__farmTest.patch('self',{battleaxe:1,equippedWeapon:'battleaxe',coins:5000});
  Phaser.Math.Between=(_,max)=>max;
  window.__farmGame.scene.getScene('ShopScene').scene.start('VisitScene',{targetAccountId:'neighbor',targetName:'鄰居'});
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('VisitScene')&&window.__farmGame.scene.getScene('VisitScene').hasRolledEncounter);
 for(const [enemy,hits] of [['wolf',5],['tiger',10]]){
  await page.evaluate(({enemy,hits})=>{
   const s=window.__farmGame.scene.getScene('VisitScene'),cap=enemy[0].toUpperCase()+enemy.slice(1);
   s['spawn'+cap+'Event']();const a=s[enemy];
   for(let n=0;n<hits-1;n++)a.emit('pointerdown',{x:a.x,y:a.y});
   if(s['is'+cap+'Defeated'])throw Error('Early '+enemy+' defeat');
   a.emit('pointerdown',{x:a.x,y:a.y});if(!s['is'+cap+'Defeated'])throw Error('Wrong '+enemy+' axe hits');
  },{enemy,hits});
 }
 for(const [enemy,hits] of [['dragon',20],['gorilla',40]]){
  await page.evaluate(({enemy,hits})=>{
   const s=window.__farmGame.scene.getScene('VisitScene'),cap=enemy[0].toUpperCase()+enemy.slice(1);
   s['spawn'+cap+'Event']();const b=s[enemy+'Encounter'];
   if(b.weapon.name!=='雙手斧')throw Error('Wrong weapon');
   for(let n=0;n<hits-1;n++)b.hit();if(b.result||b.health!==b.damage)throw Error('Early boss win');
   b.hit();if(b.result!=='win')throw Error('Wrong boss axe hits');
  },{enemy,hits});
  await page.waitForFunction(enemy=>window.__farmGame.scene.getScene('VisitScene')[enemy+'Encounter'].settled,enemy);
  await page.evaluate(enemy=>window.__farmGame.scene.getScene('VisitScene')[enemy+'Encounter'].destroy(),enemy);
 }
 checks.push('real Phaser fights: axe wolf 5 / tiger 10 / dragon 20 / gorilla 40 hits');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
