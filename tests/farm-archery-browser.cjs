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
 const writes=[];const sets=[];
 const result=await callback({get:async ref=>snapshot(ref),set:(ref,value)=>sets.push([ref,value]),update:(ref,values)=>writes.push([ref,values])});
 for(const [ref,value] of sets)docs[ref.path]=structuredClone(value);
 for(const [ref,values] of writes) for(const [key,value] of Object.entries(values)){
  const bits=key.split('.');let object=docs[ref.path];for(const bit of bits.slice(0,-1))object=object[bit]??={};object[bits.at(-1)]=structuredClone(value);
 }
 if(writes.length||sets.length){window.__farmTest.commits++;notify();}
 return result;
 });queue=run.catch(()=>{});return run;}
window.__farmTest={docs,commits:0,patch:(who,values)=>{const farm=docs[prefix+who].farm;Object.assign(farm,values);if(farm.poultryVersion===2&&'eggsReady' in values&&!('readyEggs' in values))farm.readyEggs={hen:values.eggsReady,silkie:0,bresse:0};notify();}};
`;
(async () => {
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const phaser=require('node:fs').existsSync('/tmp/kids-phaser.js')?require('node:fs').readFileSync('/tmp/kids-phaser.js','utf8'):execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:firestore}));
 // Mailbox subscriptions are covered separately by farm-mail-browser.cjs.
 await page.route('**/js/farm/mail-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmMail(){}'}));
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await page.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',groupId:'dragon-test',name:'測試玩家'})));
 await page.goto(base+'/farmgame.html');
 await page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').hensGroup?.length===2);
 const checks=[];
 const patch=async data=>page.evaluate(data=>window.__farmTest.patch('self',data),data);
 await patch({coins:20000,warehouseLimit:99,coopLevel:3,eggsReady:2,shortbow:0,huntingbow:0,equippedBow:null});
 await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene'));
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('ShopScene');
  await s.executeBuyWeapon('shortbow',1,1000);await s.executeBuyWeapon('huntingbow',1,5000);
  if(s.farmData.shortbow!==1||s.farmData.huntingbow!==1||s.farmData.coins!==14000)throw Error('Bow shop prices/inventory');
  s.scene.start('WarehouseScene');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('WarehouseScene');await s.toggleEquipWeapon('shortbow',false);
  if(s.farmData.equippedBow!=='shortbow'||s.farmData.equippedWeapon!=='club')throw Error('Independent bow equip slot');
  s.scene.start('ShopScene');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('ShopScene');await s.executeSellItem('shortbow',500,'短弓',1);if(s.farmData.shortbow!==1)throw Error('Sold equipped bow');s.scene.start('MyFarmScene');});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene'));
 checks.push('purchase both bows at exact prices, independent equipment slot, equipped sale blocked');
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');const old=Phaser.Math.Between;Phaser.Math.Between=(min,max)=>max===60?6:max;try{await s.harvestEgg();}finally{Phaser.Math.Between=old;}});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter);
 await page.evaluate(()=>{
  const b=window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter;
  if(b.sprite.x<195||b.config.flightMs!==10000||b.config.durationMs!==60000)throw Error('Eagle entry timing');
  const hp=b.health;b.hit();if(b.health!==hp)throw Error('Tap damaged flying enemy');
  const button=b.archery.button.getBounds(),bow=b.archery.bow.getBounds();if(button.right>=bow.left||button.bottom>800||button.centerX>=100)throw Error('Switch button overlaps bow or is not at lower left');b.archery.button.emit('pointerdown');if(!b.archery.selected||!b.archery.bow.visible)throw Error('Switch bow failed');
  b.flight.stop();b.sprite.setPosition(195,350);b.phase='test';
 });
 async function point(x,y){const box=await page.locator('#game-container canvas').boundingBox();return page.evaluate(({x,y,box})=>{const c=window.__farmGame.scene.getScene('MyFarmScene').cameras.main;return{x:box.x+c.width/2+(x-195)*c.zoom,y:box.y+c.height/2+(y-422)*c.zoom};},{x,y,box});}
 for(const viewport of [{width:390,height:844},{width:360,height:740},{width:320,height:568},{width:412,height:915},{width:844,height:390}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(150);
  const layout=await page.evaluate(()=>{
   const s=window.__farmGame.scene.getScene('MyFarmScene'),c=s.cameras.main,a=s.eagleEncounter.archery;
   const bottom=422+c.height/c.zoom/2;
   return {pullGap:(bottom-a.bow.y-1050/9)*c.zoom,buttonRight:a.button.getBounds().right,bowLeft:a.bow.getBounds().left};
  });
  assert.ok(layout.pullGap>=79,'full-power pull overlaps Android bottom controls');
  assert.ok(layout.buttonRight<layout.bowLeft,'switch button overlaps aiming');
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
 const dragOrigin=await page.evaluate(()=>{const b=window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.archery.bow;return{x:b.x,y:b.y};});
 const dragStart=await point(dragOrigin.x,dragOrigin.y);await page.mouse.move(dragStart.x,dragStart.y);await page.mouse.down();
 await page.setViewportSize({width:390,height:760});await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.archery.drag),null,'viewport resize must cancel the old aiming origin');
 await page.mouse.up();
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
 checks.push('five mobile portrait/landscape sizes reserve 80 screen pixels after full pull; browser resize cancels stale aim');
 // Resizing also reanchors farm actors; restore the stationary collision target.
 await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.sprite.setPosition(195,350));
 async function shoot(dx,dy){const origin=await page.evaluate(()=>{const b=window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.archery.bow;return{x:b.x,y:b.y};});const a=await point(origin.x,origin.y),b=await point(origin.x+dx,origin.y+dy);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});const dots=await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.archery.path.commandBuffer.length);if(!dots)throw Error('No aiming trajectory');await page.mouse.up();}
 await page.screenshot({path:'/tmp/eagle-archery.png'});
 await shoot(0,100);
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.health===180);
 const client=await page.context().newCDPSession(page);
 const origin=await page.evaluate(()=>{const b=window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.archery.bow;return{x:b.x,y:b.y};});
 const touchStart=await point(origin.x,origin.y),touchEnd=await point(origin.x,origin.y+100);
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touchStart]});
 await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touchEnd]});
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.health===160);
 await shoot(80,25);await page.waitForTimeout(750);
 assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.health),160);
 checks.push('real mouse and touchscreen drag draw trajectory, release launches arrow, swept hit deals damage; off-target arrow misses');
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),b=s.eagleEncounter;const before=b.health;b.hit();if(b.health!==before)throw Error('Click bypassed archery');for(let i=0;i<8;i++)b.arrowHit(b.archery.getBow());});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.settled);
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene'),b=s.eagleEncounter;const {settleEagleEncounter}=await import('/js/farm/eagle.js');await settleEagleEncounter(b.id,'win','self');if(s.farmData.eagleFeathers!==1||s.farmData.eggsReady!==2)throw Error('Reward/idempotence/eggs');});
 checks.push('shortbow 10 hits, guaranteed one feather, duplicate settlement no extra reward');
 await patch({coins:50});
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');s.eagleEncounter.destroy();const {EagleEncounter}=await import('/js/farm/eagle.js');s.eagleEncounter=new EagleEncounter(s);s.eagleEncounter.startFire();window.__hover={x:s.eagle.x,y:s.eagle.y};});
 await page.waitForTimeout(350);
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');if(s.eagle.x===window.__hover.x&&s.eagle.y===window.__hover.y)throw Error('No circling motion');const b=s.eagleEncounter;b.deadlineTimer.elapsed=14500;b.refresh();if(b.sprite.anims.currentAnim.key!=='eagle_dive')throw Error('No five-second dive');s.time.timeScale=100;s.tweens.timeScale=100;});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.settled);
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');s.time.timeScale=1;s.tweens.timeScale=1;if(s.eagleEncounter.result!=='loss'||s.farmData.coins!==0||s.farmData.eggsReady!==2)throw Error('Eagle loss must only floor own coins');s.eagleEncounter.destroy();s.eagleEncounter=null;});
 checks.push('smooth circling, five-second dive, automatic timeout preserves eggs and floors coins at zero');
 await patch({coins:1000,equippedBow:'huntingbow'});
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');const {DragonEncounter}=await import('/js/farm/dragon.js');s.dragonEncounter=new DragonEncounter(s);const b=s.dragonEncounter;b.hit();if(b.health!==600)throw Error('Dragon accepted melee');const {WEAPONS_CONFIG:W}=await import('/js/farm/combat-rules.js');for(let i=0;i<10;i++)b.arrowHit(W.huntingbow);});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').dragonEncounter.settled);
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');if(s.farmData.dragonScales!==1)throw Error('Dragon bow reward');s.dragonEncounter.destroy();s.dragonEncounter=null;});
 checks.push('dragon cannot be tapped, hunting bow 10 hits grants scale');
 // Actual visit hook, target lv3; timeout costs the visitor only.
 await page.evaluate(()=>{window.__oldRoll=Phaser.Math.Between;Phaser.Math.Between=(min,max)=>max===60?5:max;window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetAccountId:'neighbor',targetName:'鄰居',targetGroupId:'dragon-test'});});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').eagleEncounter);
 await page.evaluate(()=>{Phaser.Math.Between=window.__oldRoll;const s=window.__farmGame.scene.getScene('VisitScene');if(s.eagleEncounter.targetAccountId!=='neighbor')throw Error('Visit encounter target');s.eagleEncounter.resolve('loss');});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').eagleEncounter.settled);
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');if(s.myFarmData.coins!==900||s.targetFarmData.eggsReady!==5)throw Error('Visitor loss ownership');s.scene.start('WarehouseScene');});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('WarehouseScene');await s.toggleEquipWeapon('huntingbow',true);s.scene.start('ShopScene');});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('ShopScene');await s.executeSellItem('shortbow',500,'短弓',1);await s.executeSellItem('huntingbow',2500,'獵弓',1);await s.executeSellItem('eagleFeathers',300,'巨鷹羽毛',1);if(s.farmData.coins!==4200||s.farmData.shortbow||s.farmData.huntingbow||s.farmData.eagleFeathers)throw Error('Bow/feather resale amounts');});
 checks.push('visit encounter, own coins only penalty, unequipped bow resale 500/2500 and feather 300');
 await patch({coins:20000,paladinbow:0,equippedBow:null});
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('ShopScene');
  if(!s.catalog.buy.some(row=>row[0]==='paladinbow'&&row[2].includes('10000'))||!s.catalog.sell.some(row=>row[0]==='paladinbow'&&row[2].includes('5000')))throw Error('Paladin catalog prices');
  await s.executeBuyWeapon('paladinbow',1,1);
  if(s.farmData.coins!==10000||s.farmData.paladinbow!==1)throw Error('Paladin purchase must use configured 10000 price');
  s.selectShopCategory('weapons');s.weaponGuide.setVisible(true);
 });
 await page.screenshot({path:'/tmp/paladin-bow-guide.png'});
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('ShopScene');s.weaponGuide.setVisible(false);s.scene.start('WarehouseScene');});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('WarehouseScene');await s.toggleEquipWeapon('paladinbow',false);
  if(s.farmData.equippedBow!=='paladinbow'||s.farmData.equippedWeapon!=='club')throw Error('Paladin independent equip slot');
  s.scene.start('ShopScene');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('ShopScene');await s.executeSellItem('paladinbow',99999,'聖騎士弓',1);
  if(s.farmData.paladinbow!==1||s.farmData.coins!==10000)throw Error('Equipped paladin bow must not sell');
  s.scene.start('WarehouseScene');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('WarehouseScene');await s.toggleEquipWeapon('paladinbow',true);s.scene.start('ShopScene');});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('ShopScene');await s.executeSellItem('paladinbow',99999,'聖騎士弓',1);
  if(s.farmData.coins!==15000||s.farmData.paladinbow!==0)throw Error('Paladin resale must use configured 5000 price');
  await s.executeBuyWeapon('paladinbow',1,10000);s.scene.start('WarehouseScene');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('WarehouseScene');await s.toggleEquipWeapon('paladinbow',false);s.scene.start('MyFarmScene');});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('MyFarmScene');
  const {bossAssets,ensureAssets}=await import('/js/farm/assets.js');
  s.textures.remove('paladinbow');await ensureAssets(s,bossAssets('eagle'));
  if(!s.textures.exists('paladinbow'))throw Error('Cold boss bundle omitted paladin artwork');
  const {EagleEncounter}=await import('/js/farm/eagle.js');s.eagleEncounter=new EagleEncounter(s);
  const b=s.eagleEncounter;b.archery.button.emit('pointerdown');
  if(b.archery.bow.texture.key!=='paladinbow')throw Error('Equipped bow artwork not used while aiming');
  const {WEAPONS_CONFIG:W}=await import('/js/farm/combat-rules.js');
  b.arrowHit(W.paladinbow);b.arrowHit(W.paladinbow);
  if(b.health!==60||b.result)throw Error('Eagle must survive two paladin hits');
 });
 await page.screenshot({path:'/tmp/paladin-bow-equipped.png'});
 await page.evaluate(async()=>{const {WEAPONS_CONFIG:W}=await import('/js/farm/combat-rules.js');window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.arrowHit(W.paladinbow);});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').eagleEncounter.settled);
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('MyFarmScene');if(s.eagleEncounter.result!=='win'||s.farmData.eagleFeathers!==1)throw Error('Three paladin hits must win and award one feather');
  s.eagleEncounter.destroy();s.eagleEncounter=null;
  const {DragonEncounter}=await import('/js/farm/dragon.js');s.dragonEncounter=new DragonEncounter(s);
  const {WEAPONS_CONFIG:W}=await import('/js/farm/combat-rules.js');
  for(let i=0;i<4;i++)s.dragonEncounter.arrowHit(W.paladinbow);
  if(s.dragonEncounter.health!==120||s.dragonEncounter.result)throw Error('Dragon must survive four paladin hits');
  s.dragonEncounter.arrowHit(W.paladinbow);
 });
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').dragonEncounter.settled);
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');if(s.dragonEncounter.result!=='win'||s.farmData.dragonScales!==2)throw Error('Five paladin hits must win and award one scale');});
 checks.push('paladin buy 10000/sell 5000, equipped sale blocked, cold-loaded aiming artwork, eagle exactly 3 hits and dragon exactly 5 hits with rewards');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
