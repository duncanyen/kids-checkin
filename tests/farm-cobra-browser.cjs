// Real Phaser + isolated persistent Firestore, including transaction retries and reloads.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8012',epoch=Date.now();
const seed=()=>({coins:300,hens:2,hensState:[{id:'h1',breed:'hen',laidAt:epoch},{id:'h2',breed:'hen',laidAt:epoch}],coopLevel:2,eggsReady:2,readyEggs:{hen:2,silkie:0,bresse:0},poultryVersion:2,lastLayTime:epoch,inventoryEggs:0,warehouseLimit:99,cleanliness:0,equippedWeapon:'club',mace:1,battleaxe:1,shortbow:1,huntingbow:1,paladinbow:1,equippedBow:'paladinbow'});
const docs={'groups/A':{members:['self','neighbor'],farmVillageVisibility:'public'},'groups/B':{members:['visitor'],farmVillageVisibility:'public'},'groups/A/users/self':{farm:seed()},'groups/A/users/neighbor':{farm:seed()},'groups/B/users/visitor':{farm:seed()}};
const own=()=>docs['groups/A/users/self'].farm;
let commits=0;
const sdk=`
export const doc=(_, ...bits)=>({path:bits.join('/')}),collection=doc,query=ref=>ref,where=()=>({});
export const serverTimestamp=()=>Date.now();
const snap=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data),metadata:{fromCache:false,hasPendingWrites:false}});
export const getDoc=async ref=>snap(ref.path,await window.__cobraDB({kind:'get',path:ref.path}));
export const getDocs=async()=>({docs:[],empty:true,forEach:()=>{}});
const listeners=new Set();
export function onSnapshot(ref,callback){const item={ref,callback};listeners.add(item);getDoc(ref).then(callback);return()=>listeners.delete(item);}
async function notify(){for(const {ref,callback}of [...listeners])callback(await getDoc(ref));}
window.__cobraNotify=notify;
let queue=Promise.resolve();
export function runTransaction(_,callback){const result=queue.then(async()=>{
 if(window.__failCobraTransaction){window.__failCobraTransaction=false;throw Error('Simulated offline');}
 const attempt=async()=>{const writes=[];const value=await callback({get:ref=>{if(writes.length)throw Error('Read after write');return getDoc(ref);},set:(ref,data)=>writes.push({path:ref.path,data,merge:false}),update:(ref,data)=>writes.push({path:ref.path,data,merge:true})});return {value,writes};};
 if(window.__retryCobraTransaction){window.__retryCobraTransaction=false;await attempt();}
 const done=await attempt();await window.__cobraDB({kind:'commit',writes:done.writes});if(done.writes.length)await notify();return done.value;
 });queue=result.catch(()=>{});return result;}
export const setDoc=async(ref,data)=>{await window.__cobraDB({kind:'commit',writes:[{path:ref.path,data,merge:false}]});await notify();};
export const updateDoc=async(ref,data)=>{await window.__cobraDB({kind:'commit',writes:[{path:ref.path,data,merge:true}]});await notify();};
export const addDoc=async(ref,data)=>{const id=crypto.randomUUID();await setDoc({path:ref.path+'/'+id},data);return{id};};
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__cobraDB',op=>{
  if(op.kind==='get')return structuredClone(docs[op.path]);
  if(op.kind!=='commit')throw Error('Unknown operation');
  if(op.writes.length)commits++;
  for(const write of op.writes){const value=write.merge?structuredClone(docs[write.path]||{}):{};for(const [key,data]of Object.entries(write.data)){let target=value;const bits=key.split('.');for(const bit of bits.slice(0,-1))target=target[bit]??={};target[bits.at(-1)]=structuredClone(data);}docs[write.path]=value;}
 });
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('/tmp/kids-phaser.js','utf8')}));
 await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.route('**/js/farm/mail-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmMail(){}'}));
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await page.addInitScript(epoch=>{
  localStorage.setItem('lastGroupId','A');sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',name:'測試玩家'}));
  window.__cobraNow=Number(sessionStorage.getItem('cobra-clock')||epoch);Date.now=()=>window.__cobraNow;
  Math.random=()=>.99; // Keep unrelated encounters out of the test.
 },epoch);
 const ready=()=>page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').farmData);
 const home=()=>page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene'));
 const notify=()=>page.evaluate(()=>window.__cobraNotify());
 const clock=async now=>page.evaluate(now=>{window.__cobraNow=now;sessionStorage.setItem('cobra-clock',String(now));},now);
 const scene=async(key,data)=>{
  await page.evaluate(({key,data})=>{const current=__farmGame.scene.getScenes(true).find(s=>['MyFarmScene','ShopScene','WarehouseScene','VisitScene'].includes(s.sys.settings.key));current.scene.start(key,data);},{key,data});
  await page.waitForFunction(key=>{const s=__farmGame.scene.getScene(key);return s.sys.isActive()&&(key==='ShopScene'?s.buyContainer?.scene===s:key==='VisitScene'?!!s.targetFarmData:!!s.farmData);},key);
 };
 const bossReady=key=>page.waitForFunction(key=>!!__farmGame.scene.getScene(key).cobraEncounter,key);
 await page.goto(base+'/farmgame.html');await ready();
 // Cold download failure never reserves a milestone or starts its clock.
 own().combatKills={wolf:35,tiger:34,eagle:31};await notify();
 await page.route('**/assets/farm/cobra-sheet.png',r=>r.abort());
 await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').harvestEgg());
 await page.locator('[data-farm-loading][data-failed=true]').waitFor();
 assert.equal(own().cobraChallenge,undefined);assert.equal(own().cobraLastMilestone,undefined);
 await page.unroute('**/assets/farm/cobra-sheet.png');
 await page.locator('[data-loading-retry]').click();await bossReady('MyFarmScene');
 const first=structuredClone(own().cobraChallenge);assert.equal(first.milestone,100);assert.equal(first.deadline-first.startedAt,50000);
 await page.evaluate(()=>{
  const s=__farmGame.scene.getScene('MyFarmScene'),b=s.cobraEncounter;
  if(b.sprite.x<=390||b.config.flightMs!==8000)throw Error('Cobra must approach from right');
  for(let i=0;i<64;i++)if(!s.textures.get('cobra').has(String(i)))throw Error('Missing animation frame '+i);
  for(const action of ['idle','walk','back','poison','sweep','hit','stun','dead'])if(s.anims.get('cobra_'+action).frames.length!==8)throw Error('Incomplete animation');
 });
 // Original absolute deadline survives leaving, re-entry and full browser reload.
 await clock(epoch+5000);await scene('WarehouseScene');await scene('MyFarmScene');await bossReady('MyFarmScene');
 assert.equal(own().cobraChallenge.id,first.id);assert.equal(own().cobraChallenge.deadline,first.deadline);
 await page.reload();await ready();await bossReady('MyFarmScene');assert.equal(own().cobraChallenge.id,first.id);
 await clock(epoch+8000);await page.evaluate(()=>{const b=__farmGame.scene.getScene('MyFarmScene').cobraEncounter;b.startFire();b.patrol();});
 const y=await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').cobra.y);
 await clock(epoch+12500);await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').cobraEncounter.patrol());
 const feint=await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');return {y:s.cobra.y,x:s.cobra.x,animation:s.cobra.anims.currentAnim.key,hens:s.hensGroup.length};});
 assert.ok(feint.y>y+60);assert.equal(feint.animation,'cobra_poison');assert.equal(feint.hens,2);
 await page.screenshot({path:'/tmp/farm-cobra-home.png'});
 // Harvest blocked until battle settlement.
 await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').harvestEgg());assert.equal(own().inventoryEggs,0);
 // A real mouse tap counts once, then 499 more club hits win.
 await clock(epoch+14000);await page.evaluate(()=>{const b=__farmGame.scene.getScene('MyFarmScene').cobraEncounter;b.motion&&b.scene.events.off('update',b.motion);b.sprite.setPosition(195,400);b.phase='test';});
 const target=await page.evaluate(()=>{const b=__farmGame.scene.getScene('MyFarmScene').cobra.getBounds();return {x:b.centerX,y:b.centerY};});
 await page.mouse.click(target.x,target.y);assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').cobraEncounter.health),5988);
 await page.evaluate(()=>{const b=__farmGame.scene.getScene('MyFarmScene').cobraEncounter;for(let i=0;i<498;i++)b.hit();if(b.result)throw Error('Club won before 500 hits');b.hit();});
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').cobraEncounter.settled);
 assert.equal(own().cobraFangs,1);assert.equal(own().coins,300);assert.equal(own().cobraChallenge,null);
 await page.evaluate(async id=>{const {settleCobraEncounter}=await import('/js/farm/cobra-store.js');await Promise.all([settleCobraEncounter(id,'win'),settleCobraEncounter(id,'loss')]);},first.id);
 assert.equal(own().cobraFangs,1);assert.equal(own().coins,300);
 // All remaining weapon paths exercise actual BossEncounter damage and settlement.
 for(const [weapon,hits]of [['mace',300],['battleaxe',200],['shortbow',60],['huntingbow',40],['paladinbow',20]]){
  const ranged=weapon.endsWith('bow');
  own().combatKills.wolf+=100;own().equippedWeapon=ranged?'club':weapon;own().equippedBow=ranged?weapon:'paladinbow';
  await notify();await scene('WarehouseScene');await scene('MyFarmScene');await bossReady('MyFarmScene');
  await page.evaluate(async({weapon,hits,ranged})=>{
   const s=__farmGame.scene.getScene('MyFarmScene'),b=s.cobraEncounter,{WEAPONS_CONFIG:W}=await import('/js/farm/combat-rules.js');
   if(ranged){b.archery.button.emit('pointerdown');const hp=b.health;b.hit();if(b.health!==hp)throw Error('Bow selection also caused a melee hit');}
   for(let i=0;i<hits-1;i++)ranged?b.arrowHit(W[weapon]):b.hit();
   if(b.result)throw Error(weapon+' defeated cobra one hit early');
   ranged?b.arrowHit(W[weapon]):b.hit();
  },{weapon,hits,ranged});
  await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').cobraEncounter.settled);
 }
 assert.equal(own().cobraFangs,6);
 // Forge a real drawn arrow and swept collision against the cobra, including Android safe area.
 own().combatKills.wolf+=100;own().equippedBow='paladinbow';await notify();await scene('WarehouseScene');await scene('MyFarmScene');await bossReady('MyFarmScene');
 await page.evaluate(()=>{const b=__farmGame.scene.getScene('MyFarmScene').cobraEncounter;b.flight.stop();b.sprite.setPosition(195,350);b.phase='test';b.archery.button.emit('pointerdown');});
 const bow=await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene'),a=s.cobraEncounter.archery;return{x:a.bow.x,y:a.bow.y};});
 await page.mouse.move(bow.x,bow.y);await page.mouse.down();await page.mouse.move(bow.x,bow.y+100,{steps:6});await page.mouse.up();
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').cobraEncounter.health===5700);
 await page.setViewportSize({width:360,height:740});await page.waitForTimeout(150);
 assert.ok(await page.evaluate(async()=>{const s=__farmGame.scene.getScene('MyFarmScene'),a=s.cobraEncounter.archery,{farmView}=await import('/js/farm/viewport.js'),v=farmView(s);return(v.top+v.height-a.bow.y-1050/9)*v.zoom>=79;}));
 await page.setViewportSize({width:390,height:844});
 // Cross-village resume: no new fight and only the challenger can lose money.
 await scene('VisitScene',{targetAccountId:'visitor',targetName:'外村鄰居',targetGroupId:'B'});await bossReady('VisitScene');
 const cross=structuredClone(own().cobraChallenge),neighborBefore=structuredClone(docs['groups/B/users/visitor'].farm);
 own().coins=80;await notify();await clock(cross.deadline);
 await page.evaluate(()=>__farmGame.scene.getScene('VisitScene').cobraEncounter.refresh());
 await page.waitForFunction(()=>__farmGame.scene.getScene('VisitScene').cobraEncounter.settled);
 assert.equal(own().coins,0);assert.equal(own().cobraFangs,6);assert.deepEqual(docs['groups/B/users/visitor'].farm,neighborBefore);
 assert.equal(own().eggsReady,2);
 // Expired encounter after closing the browser is settled once on next entry.
 own().coins=300;own().combatKills.wolf+=100;await notify();await scene('MyFarmScene');await bossReady('MyFarmScene');
 const expired=structuredClone(own().cobraChallenge);await scene('WarehouseScene');await clock(expired.deadline+1);
 await page.reload();await ready();await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').farmData.cobraChallenge===null);
 assert.equal(own().coins,100);await page.reload();await ready();assert.equal(own().coins,100);
 // Own Lv.1 never qualifies even at a higher-level neighbor; own Lv.2 does at a Lv.1 neighbor.
 own().coopLevel=1;own().combatKills.wolf+=100;await notify();
 await scene('VisitScene',{targetAccountId:'neighbor',targetName:'同村鄰居',targetGroupId:'A'});await page.waitForTimeout(100);
 assert.equal(own().cobraChallenge,null);
 own().coopLevel=2;docs['groups/A/users/neighbor'].farm.coopLevel=1;await notify();await scene('WarehouseScene');
 await scene('VisitScene',{targetAccountId:'neighbor',targetName:'同村鄰居',targetGroupId:'A'});await bossReady('VisitScene');
 // Transaction retries and concurrent claims share one milestone; full inventory never drops the fang.
 const id=own().cobraChallenge.id;own().warehouseLimit=1;own().inventoryEggs=10;await notify();
 await page.evaluate(async()=>{const {claimCobraEncounter}=await import('/js/farm/cobra-store.js');window.__retryCobraTransaction=true;const claims=await Promise.all([claimCobraEncounter(),claimCobraEncounter()]);if(claims[0].challenge.id!==claims[1].challenge.id)throw Error('Concurrent claim duplicated fight');});
 await page.evaluate(async id=>{const {settleCobraEncounter}=await import('/js/farm/cobra-store.js');window.__retryCobraTransaction=true;const r=await settleCobraEncounter(id,'win');if(!r.overflow)throw Error('Full warehouse flag missing');},id);
 assert.equal(own().cobraFangs,7);
 // Warehouse icon and actual sale price through the normal shop transaction.
 await scene('WarehouseScene');await page.evaluate(()=>{const s=__farmGame.scene.getScene('WarehouseScene');if(!s.allConfigItems.some(i=>i.key==='cobraFangs'&&i.icon==='cobra_fang'))throw Error('Missing fang inventory row');});
 await scene('ShopScene');const beforeSale=own().coins;
 await page.evaluate(async()=>{const s=__farmGame.scene.getScene('ShopScene');if(!s.catalog.sell.some(r=>r[0]==='cobraFangs'&&r[2].includes('600')))throw Error('Missing fang sale');await s.executeSellItem('cobraFangs',600,'眼鏡蛇王毒牙',1);});
 assert.equal(own().coins,beforeSale+600);assert.equal(own().cobraFangs,6);
 await page.evaluate(()=>__farmGame.scene.getScene('ShopScene').weaponGuide.setVisible(true));await page.screenshot({path:'/tmp/farm-cobra-guide.png'});
 // Predator and eagle kills record even when their normal loot is sold or inventory full.
 own().cobraLastMilestone=10000;await notify();await scene('VisitScene',{targetAccountId:'neighbor',targetName:'鄰居',targetGroupId:'A'});
 const killsBefore={...own().combatKills};
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('VisitScene');s.spawnWolfEvent();s.defeatWolf();});
 await page.waitForFunction(wolf=>__farmGame.scene.getScene('VisitScene').myFarmData.combatKills.wolf===wolf,killsBefore.wolf+1);
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('VisitScene');s.spawnTigerEvent();s.defeatTiger();});
 await page.waitForFunction(tiger=>__farmGame.scene.getScene('VisitScene').myFarmData.combatKills.tiger===tiger,killsBefore.tiger+1);
 await page.evaluate(async()=>{const {settleEagleEncounter}=await import('/js/farm/eagle.js');await settleEagleEncounter('counter-eagle','win','neighbor');await settleEagleEncounter('counter-eagle','win','neighbor');});
 assert.equal(own().combatKills.eagle,killsBefore.eagle+1);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,commits,checks:['cold-load retry','100-kill threshold','8 animations × 8 frames','right entry and 5s feint','reload keeps absolute 50s deadline','six exact hit counts','mouse melee and drawn arrow','Android safe area','cross-village personal penalty','expired fight settles once','own coop level','concurrent claim and transaction retry','full warehouse reward','fang shop sale 600','wolf/tiger/eagle kill counters']},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
