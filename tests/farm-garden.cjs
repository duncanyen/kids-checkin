// FARM_BASE_URL=http://127.0.0.1:8012 node tests/farm-garden.cjs
// Every database operation uses a persistent in-memory mock, never production.
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8012';
const clone=value=>value===undefined?undefined:structuredClone(value);
const farm={coins:250,hens:2,coopLevel:1,eggsReady:6,inventoryEggs:0,lastLayTime:Date.now(),cleanliness:0,warehouseLimit:30,hensState:[{},{}],equippedWeapon:'mace',moral:100};
const docs={
 'groups/A':{name:'自己的小屋',members:['player','neighbor']},
 'groups/B':{name:'太陽花',members:['neighbor','newbie'],farmVillageVisibility:'public'},
 'groups/C':{name:'月光',members:['neighbor'],farmVillageVisibility:'public'},
 'groups/closed':{name:'太陽秘密',members:['neighbor'],farmVillageVisibility:'closed'},
 'users/player':{name:'Player',accountId:'player',groupId:'A',role:'admin'},
 'users/neighbor':{name:'鄰居',accountId:'neighbor',groupId:'B'},
 'users/newbie':{name:'未啟用',accountId:'newbie',groupId:'B'},
 'groups/A/users/player':{farm:clone(farm)},'groups/A/users/neighbor':{farm:clone(farm)},
 'groups/B/users/neighbor':{farm:clone(farm)},'groups/C/users/neighbor':{farm:clone(farm)},
};
for(let index=1;index<=24;index++)docs['groups/public'+index]={name:'公開'+String(index).padStart(2,'0'),members:[],farmVillageVisibility:'public'};
const writes=[],reads=[];let serial=0,failCommit=false,holdCommit=false,releaseCommit=null,commitArrived=null;
const mock=`
export const initializeApp=()=>({});export const getFirestore=()=>({});
export const doc=(_, ...parts)=>({path:parts.join('/')});export const collection=doc;
export const where=(field,op,value)=>({field,op,value});export const orderBy=(field,order)=>({orderField:field,order});export const limit=value=>({limit:value});export const query=(ref,...filters)=>({...ref,filters});
const listeners=new Map();
const snapshot=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data)});
export const getDoc=async ref=>snapshot(ref.path,await window.__db({kind:'get',path:ref.path}));
export const getDocs=async ref=>{const rows=await window.__db({kind:'query',...ref});return{empty:!rows.length,docs:rows.map(row=>snapshot(row.path,row.data)),forEach:cb=>rows.forEach(row=>cb(snapshot(row.path,row.data)))};};
export function onSnapshot(ref,callback){const key=JSON.stringify(ref);if(!listeners.has(key))listeners.set(key,{ref,callbacks:new Set()});listeners.get(key).callbacks.add(callback);getDoc(ref).then(callback);return()=>listeners.get(key)?.callbacks.delete(callback);}
async function notify(){for(const {ref,callbacks} of [...listeners.values()]){const snap=await getDoc(ref);for(const cb of [...callbacks])cb(snap);}}
export async function setDoc(ref,data,options={}){await window.__db({kind:'write',path:ref.path,data,merge:!!options.merge});await notify();}
export const updateDoc=(ref,data)=>setDoc(ref,data,{merge:true});
export const addDoc=async(ref,data)=>({path:await window.__db({kind:'add',path:ref.path,data})});
export const serverTimestamp=()=>Date.now();
export async function runTransaction(_,callback){const pending=[];const result=await callback({get:getDoc,update:(ref,data)=>pending.push({path:ref.path,data,merge:true})});await window.__db({kind:'transaction',pending});await notify();return result;}
`;
function write(path,data,merge){const next=merge?clone(docs[path]||{}):{};for(const [key,value] of Object.entries(data)){const keys=key.split('.');let object=next;for(const bit of keys.slice(0,-1))object=object[bit]??={};object[keys.at(-1)]=clone(value);}docs[path]=next;writes.push({path,data:clone(data)});}
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await page.exposeFunction('__db',operation=>{
  if(operation.kind==='get'){reads.push(operation.path);return clone(docs[operation.path]);}
  if(operation.kind==='query'){
   let rows=Object.entries(docs).filter(([path])=>path.startsWith(operation.path+'/')&&path.split('/').length===operation.path.split('/').length+1).map(([path,data])=>({path,data:clone(data)}));
   for(const filter of operation.filters||[]){if(filter.op==='==')rows=rows.filter(row=>row.data[filter.field]===filter.value);if(filter.op==='in')rows=rows.filter(row=>filter.value.includes(row.data[filter.field]));if(filter.orderField)rows.sort((a,b)=>(a.data[filter.orderField]||0)-(b.data[filter.orderField]||0));}
   return rows;
  }
  if(operation.kind==='write'){write(operation.path,operation.data,operation.merge);return;}
  if(operation.kind==='add'){const path=operation.path+'/mock'+(++serial);write(path,operation.data,false);return path;}
  if(operation.kind==='transaction'){if(failCommit)throw Error('simulated save failure');if(holdCommit)return new Promise(resolve=>{releaseCommit=()=>{for(const item of operation.pending)write(item.path,item.data,item.merge);resolve();};commitArrived?.();});for(const item of operation.pending)write(item.path,item.data,item.merge);return;}
  throw Error('Unsupported mock operation');
 });
 const phaser=require('node:fs').existsSync('/tmp/kids-phaser.js')?require('node:fs').readFileSync('/tmp/kids-phaser.js','utf8'):execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await page.addInitScript(()=>{localStorage.setItem('lastGroupId','A');sessionStorage.setItem('familyCheckInUser',JSON.stringify({name:'Player',accountId:'player',groupId:'stale',role:'admin'}));});
 const checks=[];
 await page.goto(base+'/farmgame.html');await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData);
 async function patch(path,data){await page.evaluate(async({path,data})=>{const {doc,updateDoc}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');await updateDoc(doc({},...path.split('/')),data);},{path,data});}
 async function search(key,roll){await page.evaluate(async({key,roll})=>{const s=window.__farmGame.scene.getScene(key),old=Phaser.Math.Between;Phaser.Math.Between=(min,max)=>max===150?roll:old(min,max);try{await s.searchCabbage(s.gardenPlants[0]);}finally{Phaser.Math.Between=old;}},{key,roll});}
 const own='groups/A/users/player';
 for(const key of ['MyFarmScene','VisitScene']){
  if(key==='VisitScene'){
   await page.evaluate(()=>{Phaser.Math.Between=(min,max)=>max;window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetGroupId:'A',targetAccountId:'neighbor',targetName:'Neighbor'});});
   await page.waitForFunction(()=>window.__farmGame.scene.isActive('VisitScene')&&window.__farmGame.scene.getScene('VisitScene').targetFarmData&&window.__farmGame.scene.getScene('VisitScene').myFarmData);
  }
  const before=clone(docs[own].farm), neighbor=clone(docs['groups/A/users/neighbor']);
  await search(key,150);await page.waitForTimeout(230);
  assert.equal(docs[own].farm.worms||0,before.worms||0);
  assert.equal(await page.evaluate(key=>window.__farmGame.scene.getScene(key).gardenFeedback.roots.size,key),0);
  await search(key,4);
  assert.equal(docs[own].farm.worms,(before.worms||0)+1);
  await page.waitForFunction(key=>window.__farmGame.scene.getScene(key).children.list.some(o=>o.getData?.('gardenFind')?.type==='worms'),key);
  await page.waitForTimeout(430);
  const banner=await page.evaluate(key=>{const s=window.__farmGame.scene.getScene(key),card=s.children.list.find(o=>o.getData?.('gardenFind'));return{alpha:card.alpha,width:card.list.find(o=>o.texture?.key==='ui_parchment').displayWidth,text:card.list.filter(o=>o.type==='Text').map(o=>o.text),interactive:!!card.input};},key);
  assert.ok(banner.alpha>.95);assert.equal(banner.width,308);assert.ok(banner.text.includes('抓到菜蟲！'));assert.ok(banner.text.includes('+1'));assert.equal(banner.interactive,false);
  if(key==='MyFarmScene')await page.screenshot({path:'/tmp/farm-garden-worm.png',fullPage:true});
  await page.waitForFunction(key=>window.__farmGame.scene.getScene(key).gardenFeedback.roots.size===0,key);
  await search(key,1);assert.equal(docs[own].farm.earthworms,(before.earthworms||0)+1);
  if(key==='MyFarmScene'){await page.waitForTimeout(430);await page.screenshot({path:'/tmp/farm-garden-earthworm.png',fullPage:true});}
  await page.waitForFunction(key=>window.__farmGame.scene.getScene(key).gardenFeedback.roots.size===0,key);
  // A stale local capacity estimate must not overflow the real warehouse.
  await patch(own,{'farm.warehouseLimit':1});
  await page.evaluate(key=>{const s=window.__farmGame.scene.getScene(key);(key==='MyFarmScene'?s.farmData:s.myFarmData).warehouseLimit=99;},key);
  const storedCount=docs[own].farm.worms;await search(key,4);assert.equal(docs[own].farm.worms,storedCount);
  assert.equal(await page.evaluate(key=>window.__farmGame.scene.getScene(key).gardenFeedback.roots.size,key),0);
  await page.waitForTimeout(230);await patch(own,{'farm.warehouseLimit':99});
  failCommit=true;await search(key,4);failCommit=false;assert.equal(docs[own].farm.worms,storedCount);
  assert.equal(await page.evaluate(key=>window.__farmGame.scene.getScene(key).gardenFeedback.roots.size,key),0);
  await page.waitForTimeout(230);
  if(key==='VisitScene')assert.deepEqual(docs['groups/A/users/neighbor'],neighbor);
  checks.push(key+': no-find, committed quantities, prominent non-blocking banner, automatic cleanup, real capacity recheck, failed save has no success animation');
 }
 // Rapid finds coalesce without dropping any reported quantity.
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.gardenFeedback.show('worms',100,660);for(let i=0;i<4;i++)s.gardenFeedback.show('earthworms',130,660);for(let i=0;i<3;i++)s.gardenFeedback.show('worms',160,660);});
 const queued=await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').gardenFeedback.queue);
 assert.deepEqual(queued,[{type:'earthworms',count:4},{type:'worms',count:3}]);
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').gardenFeedback.roots.size===0,{},{timeout:12000});
 // Leaving during a pending commit must not animate on the next scene.
 holdCommit=true;const waiting=new Promise(resolve=>commitArrived=resolve);
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');window.__oldFeedback=s.gardenFeedback;Phaser.Math.Between=(min,max)=>max===150?4:max;window.__pendingFind=s.searchCabbage(s.gardenPlants[0]);});
 await waiting;
 await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('MyFarmScene'));
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').farmData);
 holdCommit=false;releaseCommit();await page.evaluate(()=>window.__pendingFind);
 assert.equal(await page.evaluate(()=>window.__oldFeedback.alive),false);
 assert.equal(await page.evaluate(()=>window.__oldFeedback.roots.size),0);
 assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').gardenFeedback.roots.size),0);
 assert.deepEqual(errors,[]);
 checks.push('coalesced quantities, cleanup on scene exit, late commit does not show in a different scene');
 console.log(JSON.stringify({passed:true,checks,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
