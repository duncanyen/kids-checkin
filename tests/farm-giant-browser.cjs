// Real Phaser + isolated persistent Firestore, including transaction retries and reloads.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8012',epoch=Date.now();
const seed=()=>({coins:300,hens:2,hensState:[{id:'h1',breed:'hen',laidAt:epoch},{id:'h2',breed:'hen',laidAt:epoch}],coopLevel:3,eggsReady:2,readyEggs:{hen:2,silkie:0,bresse:0},poultryVersion:2,lastLayTime:epoch,inventoryEggs:0,warehouseLimit:99,cleanliness:0,equippedWeapon:'club',ironhammer:1,cobraLastMilestone:10000,mace:1,battleaxe:1,shortbow:1,huntingbow:1,paladinbow:1,equippedBow:'paladinbow'});
const docs={'groups/A':{members:['self','neighbor'],farmVillageVisibility:'public'},'groups/B':{members:['visitor'],farmVillageVisibility:'public'},'groups/A/users/self':{farm:seed()},'groups/A/users/neighbor':{farm:seed()},'groups/B/users/visitor':{farm:seed()}};
const own=()=>docs['groups/A/users/self'].farm;
let commits=0;
const sdk=`
export const doc=(_, ...bits)=>({path:bits.join('/')}),collection=doc,query=ref=>ref,where=()=>({});
export const serverTimestamp=()=>Date.now();
const snap=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data),metadata:{fromCache:false,hasPendingWrites:false}});
export const getDoc=async ref=>snap(ref.path,await window.__giantDB({kind:'get',path:ref.path}));
export const getDocs=async()=>({docs:[],empty:true,forEach:()=>{}});
const listeners=new Set();
export function onSnapshot(ref,callback){const item={ref,callback};listeners.add(item);getDoc(ref).then(callback);return()=>listeners.delete(item);}
async function notify(){for(const {ref,callback}of [...listeners])callback(await getDoc(ref));}
window.__giantNotify=notify;
let queue=Promise.resolve();
export function runTransaction(_,callback){const result=queue.then(async()=>{
 if(window.__failGiantTransaction){window.__failGiantTransaction=false;throw Error('Simulated offline');}
 const attempt=async()=>{const writes=[];const value=await callback({get:ref=>{if(writes.length)throw Error('Read after write');return getDoc(ref);},set:(ref,data)=>writes.push({path:ref.path,data,merge:false}),update:(ref,data)=>writes.push({path:ref.path,data,merge:true})});return {value,writes};};
 if(window.__retryGiantTransaction){window.__retryGiantTransaction=false;await attempt();}
 const done=await attempt();await window.__giantDB({kind:'commit',writes:done.writes});if(done.writes.length)await notify();return done.value;
 });queue=result.catch(()=>{});return result;}
export const setDoc=async(ref,data)=>{await window.__giantDB({kind:'commit',writes:[{path:ref.path,data,merge:false}]});await notify();};
export const updateDoc=async(ref,data)=>{await window.__giantDB({kind:'commit',writes:[{path:ref.path,data,merge:true}]});await notify();};
export const addDoc=async(ref,data)=>{const id=crypto.randomUUID();await setDoc({path:ref.path+'/'+id},data);return{id};};
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__giantDB',op=>{
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
  window.__giantNow=Number(sessionStorage.getItem('giant-clock')||epoch);Date.now=()=>window.__giantNow;
  Math.random=()=>.99; // Keep unrelated encounters out of the test.
 },epoch);
 const ready=()=>page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').farmData);
 const home=()=>page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene'));
 const notify=()=>page.evaluate(()=>window.__giantNotify());
 const clock=async now=>page.evaluate(now=>{window.__giantNow=now;sessionStorage.setItem('giant-clock',String(now));},now);
 const scene=async(key,data)=>{
  await page.evaluate(({key,data})=>{const current=__farmGame.scene.getScenes(true).find(s=>['MyFarmScene','ShopScene','WarehouseScene','VisitScene'].includes(s.sys.settings.key));current.scene.start(key,data);},{key,data});
  await page.waitForFunction(key=>{const s=__farmGame.scene.getScene(key);return s.sys.isActive()&&(key==='ShopScene'?s.buyContainer?.scene===s:key==='VisitScene'?!!s.targetFarmData:!!s.farmData);},key);
 };
 const bossReady=key=>page.waitForFunction(key=>!!__farmGame.scene.getScene(key).giantEncounter,key);
 await page.goto(base+'/farmgame.html');await ready();
 // Exact threshold on entry, asset retry does not consume the milestone.
 own().combatKills={wolf:24,tiger:25,eagle:1000};await notify();await page.reload();await ready();
 assert.equal(own().giantChallenge,undefined);
 own().combatKills.tiger=26;await notify();
 await page.route('**/assets/farm/giant-sheet.png',r=>r.abort());
 await page.reload();await ready();
 await page.locator('[data-farm-loading][data-failed=true]').waitFor();
 assert.equal(own().giantChallenge,undefined);assert.equal(own().giantLastMilestone,undefined);
 await page.unroute('**/assets/farm/giant-sheet.png');await page.locator('[data-loading-retry]').click();await bossReady('MyFarmScene');
 const first=structuredClone(own().giantChallenge);assert.equal(first.milestone,50);assert.equal(first.deadline-first.startedAt,70000);
 await page.evaluate(()=>{
  const s=__farmGame.scene.getScene('MyFarmScene'),b=s.giantEncounter;
  if(b.sprite.x<=390||b.config.flightMs!==7000||b.sprite.y>300)throw Error('Giant must enter from upper right');
  for(const key of ['mace','battleaxe','ironhammer'])if(!s.textures.exists(key))throw Error('Missing melee art '+key);
  for(const action of ['idle','walk','smash','throw','hit','dead'])if(!s.anims.exists('giant_'+action))throw Error('Missing '+action);
 });
 await clock(epoch+4000);await scene('WarehouseScene');await scene('MyFarmScene');await bossReady('MyFarmScene');
 assert.equal(own().giantChallenge.id,first.id);assert.equal(own().giantChallenge.deadline,first.deadline);
 await page.reload();await ready();await bossReady('MyFarmScene');assert.equal(own().giantChallenge.id,first.id);
 await clock(epoch+7000);await page.evaluate(()=>{const b=__farmGame.scene.getScene('MyFarmScene').giantEncounter;b.startFire();b.patrol();});
 await page.waitForFunction(()=>!__farmGame.scene.getScene('MyFarmScene').preparingGiant);
 await page.screenshot({path:'/tmp/farm-ancient-giant.png'});
 await clock(epoch+12000);await page.evaluate(()=>{const b=__farmGame.scene.getScene('MyFarmScene').giantEncounter;b.patrol();if(b.sprite.anims.currentAnim.key!=='giant_smash')throw Error('Missing ground smash');});
 await clock(epoch+13500);await page.evaluate(()=>{const b=__farmGame.scene.getScene('MyFarmScene').giantEncounter;b.patrol();if(b.sprite.anims.currentAnim.key!=='giant_throw')throw Error('Missing boulder throw');b.arrivalTimer.remove();b.flight.stop();b.phase='test';b.sprite.setPosition(195,400);});
 const target=await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene'),r=s.giant.getBounds(),p=s.cameras.main.matrix.transformPoint(r.centerX-s.cameras.main.scrollX,r.centerY-s.cameras.main.scrollY),c=s.game.canvas.getBoundingClientRect();return{x:c.x+p.x/s.scale.width*c.width,y:c.y+p.y/s.scale.height*c.height};});
 await page.mouse.click(target.x,target.y);
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').giantEncounter.health),35960);
 await page.evaluate(()=>{const b=__farmGame.scene.getScene('MyFarmScene').giantEncounter;b.sprite.setPosition(b.archery.bow.x,350);b.archery.button.emit('pointerdown');});
 const bow=await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene'),a=s.giantEncounter.archery,p=s.cameras.main.matrix.transformPoint(a.bow.x-s.cameras.main.scrollX,a.bow.y-s.cameras.main.scrollY),c=s.game.canvas.getBoundingClientRect();return{x:c.x+p.x/s.scale.width*c.width,y:c.y+p.y/s.scale.height*c.height};});
 await page.mouse.move(bow.x,bow.y);await page.mouse.down();await page.mouse.move(bow.x,bow.y+100,{steps:6});await page.mouse.up();
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').giantEncounter.health===35720);

 const hens=structuredClone(own().hensState),eggs=own().eggsReady;
 // Shared health supports all seven exact hit counts without affecting other enemies.
 for(const [weapon,hits]of Object.entries({club:900,mace:800,battleaxe:600,ironhammer:400,shortbow:300,huntingbow:200,paladinbow:150})){
  await page.evaluate(async({weapon,hits})=>{
   const s=__farmGame.scene.getScene('MyFarmScene'),b=s.giantEncounter,{WEAPONS_CONFIG:W}=await import('/js/farm/combat-rules.js');
   b.health=b.config.health;b.weapon=W[weapon];b.damage=W[weapon].damageByEnemy.giant;
   b.archery.selected=!!W[weapon].ranged;
   for(let i=0;i<hits-1;i++)W[weapon].ranged?b.arrowHit(W[weapon]):b.hit();
   if(b.health!==W[weapon].damageByEnemy.giant||b.result)throw Error('Wrong hit count '+weapon);
  },{weapon,hits});
 }
 await page.evaluate(()=>{const b=__farmGame.scene.getScene('MyFarmScene').giantEncounter;window.__failGiantTransaction=true;b.arrowHit(b.weapon);});
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').giantEncounter.warning.text.includes('重試'));
 assert.equal(own().ancientStones,undefined);
 await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').giantEncounter.settle());
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').giantEncounter.settled);
 assert.equal(own().ancientStones,1);assert.deepEqual(own().hensState,hens);assert.equal(own().eggsReady,eggs);
 await page.evaluate(async id=>{const {settleGiantEncounter}=await import('/js/farm/giant-store.js');await settleGiantEncounter(id,'win');},first.id);
 assert.equal(own().ancientStones,1);
 // Full inventory still receives the next stone, concurrent claims reuse one fight.
 own().combatKills.wolf=74;await notify();await scene('WarehouseScene');await scene('MyFarmScene');await bossReady('MyFarmScene');
 const second=structuredClone(own().giantChallenge);assert.equal(second.milestone,100);
 await page.evaluate(async()=>{const {claimGiantEncounter}=await import('/js/farm/giant-store.js');window.__retryGiantTransaction=true;const [a,b]=await Promise.all([claimGiantEncounter(),claimGiantEncounter()]);if(a.challenge.id!==b.challenge.id)throw Error('Duplicate challenge');});
 own().warehouseLimit=1;await notify();
 await page.evaluate(async id=>{const {settleGiantEncounter}=await import('/js/farm/giant-store.js');const r=await settleGiantEncounter(id,'win');if(!r.overflow)throw Error('Missing overflow');},second.id);
 assert.equal(own().ancientStones,2);
 await scene('WarehouseScene');await page.evaluate(()=>{const s=__farmGame.scene.getScene('WarehouseScene');if(!s.allConfigItems.some(i=>i.key==='ancientStones'&&i.icon==='ancient_stone'))throw Error('Missing stone inventory');});
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').selectWarehouseCategory('other'));
 await page.screenshot({path:'/tmp/farm-ancient-stone-warehouse.png'});
 await scene('ShopScene');const coins=own().coins;
 await page.evaluate(async()=>{const s=__farmGame.scene.getScene('ShopScene');if(!s.catalog.sell.some(row=>row[0]==='ancientStones'&&row[2].includes('600')))throw Error('Missing sale');await s.executeSellItem('ancientStones',600,'遠古巨石',1);});
 assert.equal(own().coins,coins+600);assert.equal(own().ancientStones,1);
 await page.evaluate(()=>__farmGame.scene.getScene('ShopScene').weaponGuide.setVisible(true));
 await page.screenshot({path:'/tmp/farm-giant-weapon-guide.png'});
 // Low funds cannot become negative; re-entry after timeout settles exactly once.
 own().combatKills.wolf=124;own().coins=200;await notify();await scene('MyFarmScene');await bossReady('MyFarmScene');
 const third=structuredClone(own().giantChallenge);await scene('WarehouseScene');await clock(third.deadline+1);
 await page.reload();await ready();await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').farmData.giantChallenge===null);
 assert.equal(own().coins,0);await page.reload();await ready();assert.equal(own().coins,0);
 // Own Lv.2 is ineligible even at a Lv.3 neighbor. A pending monster blocks the milestone.
 own().coopLevel=2;own().combatKills.wolf=174;await notify();await scene('WarehouseScene');await scene('MyFarmScene');assert.equal(own().giantChallenge,null);
 own().coopLevel=3;own().cobraChallenge={id:'pending-snake',milestone:100,approachEndsAt:third.deadline+8000,deadline:third.deadline+50000};
 await notify();await page.evaluate(async()=>{const {claimGiantEncounter}=await import('/js/farm/giant-store.js');if(await claimGiantEncounter())throw Error('Overlapping persistent monster');});
 delete own().cobraChallenge;await notify();
 // Visit qualification uses the player's own coop; defeat penalizes only the visitor.
 docs['groups/A/users/neighbor'].farm.coopLevel=1;own().coins=500;
 await scene('VisitScene',{targetAccountId:'neighbor',targetName:'鄰居',targetGroupId:'A'});await bossReady('VisitScene');
 const neighborCoins=docs['groups/A/users/neighbor'].farm.coins;
 await page.evaluate(()=>__farmGame.scene.getScene('VisitScene').giantEncounter.resolve('loss'));
 await page.waitForFunction(()=>__farmGame.scene.getScene('VisitScene').giantEncounter.settled);
 assert.equal(own().coins,200);assert.equal(docs['groups/A/users/neighbor'].farm.coins,neighborCoins);
 assert.deepEqual(errors,[]);console.log('PASS giant: 50-kill entry, art download retry, upper-right approach, 6 animations, 70s absolute reload deadline, 7 exact weapon hit counts, settlement retry/idempotency, full warehouse loot, 600-coin sale, timeout floor, own level, exclusivity and visitor-only penalty.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
