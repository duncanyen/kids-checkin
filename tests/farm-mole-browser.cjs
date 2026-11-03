// Real Phaser + isolated persistent Firestore, including transaction retries and reloads.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8012',epoch=Date.now();
const seed=()=>({coins:300,hens:2,hensState:[{id:'h1',breed:'hen',laidAt:epoch},{id:'h2',breed:'hen',laidAt:epoch}],coopLevel:2,eggsReady:2,readyEggs:{hen:2,silkie:0,bresse:0},poultryVersion:2,lastLayTime:epoch,inventoryEggs:0,warehouseLimit:99,cleanliness:0,gardenCatchCount:29,ironhammer:1,equippedWeapon:'ironhammer',mace:1,battleaxe:1,shortbow:1,huntingbow:1,paladinbow:1,equippedBow:'paladinbow'});
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
 const challengeReady=()=>page.waitForFunction(()=>!!__farmGame.scene.getScene('MyFarmScene').moleEncounter);
 const tapGarden=()=>page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');return s.searchCabbage(s.gardenPlants[0]);});
 // Force a successful thirtieth catch using the normal transaction path.
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');s.__roll=Phaser.Math.Between;Phaser.Math.Between=()=>1;});
 await tapGarden();await challengeReady();
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');Phaser.Math.Between=s.__roll;});
 assert.equal(own().gardenCatchCount,30);assert.equal(own().earthworms,1);
 assert.equal(own().moleLastMilestone,30);assert.equal(own().moleChallenge.deadline-epoch,60000);
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');s.moleEncounter.startFire();});
 const before=structuredClone(own());
 await page.evaluate(async()=>{const s=__farmGame.scene.getScene('MyFarmScene');for(let i=0;i<20;i++)await s.searchCabbage(s.gardenPlants[i]);});
 assert.equal(own().gardenCatchCount,before.gardenCatchCount);assert.equal(own().worms,before.worms);
 const bounds=await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene'),m=s.moleEncounter;return{garden:s.gardenBounds,x:m.sprite.x,y:m.sprite.y,w:m.sprite.displayWidth,h:m.sprite.displayHeight,damage:m.damage};});
 assert.equal(bounds.damage,6);assert.ok(bounds.x>=bounds.garden.left&&bounds.x<=bounds.garden.right);
 await page.screenshot({path:'/tmp/kids-mole-mobile.png'});
 const oldCell=await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').moleEncounter.cell);
 await clock(epoch+1500);
 await page.waitForFunction(old=>__farmGame.scene.getScene('MyFarmScene').moleEncounter.cell!==old,oldCell);
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(200);
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene'),m=s.moleEncounter,b=s.gardenBounds;for(const sprite of m.moles)if(sprite.x<b.left||sprite.x>b.right||sprite.y<b.top||sprite.y>b.bottom)throw Error('Mole escaped garden after resize');});
 await page.setViewportSize({width:390,height:844});
 own().warehouseLimit=1;await notify();
 await page.evaluate(()=>{const m=__farmGame.scene.getScene('MyFarmScene').moleEncounter;if(m.moles.length!==3 || new Set(m.cells).size!==3)throw Error('Expected three distinct moles');for(let i=0;i<99;i++)m.moles[i%3].emit('pointerdown');if(m.health!==6||m.result)throw Error('Wrong cumulative 99-hit health');m.moles[0].emit('pointerdown');});
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').moleEncounter.settled);
 assert.equal(own().sweetPotatoes,1);assert.equal(own().moleChallenge,null);assert.equal(own().coins,300);
 // A resumed timed-out fight costs only the challenger's balance, never target eggs.
 own().gardenCatchCount=60;own().coins=70;await notify();
 await tapGarden();assert.equal(own().moleLastMilestone,60);
 await clock(own().moleChallenge.deadline+1);
 await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').moleEncounter.refresh());
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').moleEncounter.settled);
 assert.equal(own().coins,0);assert.equal(own().eggsReady,2);assert.equal(own().sweetPotatoes,1);
 // Shop: authoritative prices, sale and own/equip behavior.
 own().warehouseLimit=99;own().coins=20000;await notify();await scene('ShopScene');
 await page.evaluate(async()=>{const s=__farmGame.scene.getScene('ShopScene');await s.executeBuyWeapon('ironhammer',1,1);});
 assert.equal(own().coins,5000);assert.equal(own().ironhammer,2);
 await page.evaluate(async()=>{const s=__farmGame.scene.getScene('ShopScene');await s.executeSellItem('sweetPotatoes',300,'地瓜',1);});
 assert.equal(own().coins,5300);assert.equal(own().sweetPotatoes,0);
 own().equippedWeapon='club';await notify();
 await page.evaluate(async()=>{const s=__farmGame.scene.getScene('ShopScene');await s.executeSellItem('ironhammer',1,'大鐵槌',1);});
 assert.equal(own().coins,12800);assert.equal(own().ironhammer,1);
 const icons=await page.evaluate(()=>{const s=__farmGame.scene.getScene('ShopScene');return ['sweet_potato','ironhammer'].map(k=>{const f=s.textures.get(k).get();return {x:f.cutX,y:f.cutY,w:f.cutWidth,h:f.cutHeight};});});
 assert.deepEqual(icons,[{x:0,y:940,w:314,h:314},{x:314,y:940,w:313,h:314}]);
 await page.screenshot({path:'/tmp/kids-mole-shop.png'});
 await scene('WarehouseScene');
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').toggleEquipWeapon('ironhammer',false));
 assert.equal(own().equippedWeapon,'ironhammer');
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').toggleEquipWeapon('ironhammer',true));
 assert.equal(own().equippedWeapon,'club');
 // A claimed fight survives leaving/reloading with the original deadline.
 own().gardenCatchCount=90;await notify();await scene('MyFarmScene');await tapGarden();
 const retained=structuredClone(own().moleChallenge);assert.equal(retained.milestone,90);
 await page.reload();await ready();await challengeReady();assert.equal(own().moleChallenge.deadline,retained.deadline);
 // Visits charge only the challenger, and entry monsters delay a due mole.
 await scene('VisitScene',{targetAccountId:'neighbor',targetGroupId:'A',targetName:'鄰居'});
 await page.waitForFunction(()=>!!__farmGame.scene.getScene('VisitScene').moleEncounter);
 const targetCoins=docs['groups/A/users/neighbor'].farm.coins;
 await clock(retained.deadline+1);
 await page.waitForFunction(()=>__farmGame.scene.getScene('VisitScene').moleEncounter.settled);
 assert.equal(docs['groups/A/users/neighbor'].farm.coins,targetCoins);
 own().gardenCatchCount=120;await notify();
 await page.evaluate(async()=>{const s=__farmGame.scene.getScene('VisitScene');s.spawnWolfEvent();const {maybeStartMole}=await import('/js/farm/mole.js');if(await maybeStartMole(s))throw Error('Mole overlaps wolf');});
 assert.equal(own().moleChallenge,null);assert.equal(own().moleLastMilestone,90);
 assert.deepEqual(errors,[]);console.log('PASS mole: thirtieth catch, 30/60/90 milestones, garden lock, random cells and resize, 100 cumulative hits across three moles, full-warehouse loot, timeout, own-only penalty, shop trade, equip, reload deadline and monster exclusion');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
