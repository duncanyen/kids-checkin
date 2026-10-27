// FARM_BASE_URL=http://127.0.0.1:8008 node tests/game-group-isolation.cjs
// A persistent in-memory Firestore survives navigation. No production requests/writes.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {execFileSync} = require('node:child_process');
const base = process.env.FARM_BASE_URL || 'http://127.0.0.1:8000';
const clone = value => value === undefined ? undefined : structuredClone(value);
const today = (()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;})();
const farm = {coins:450,hens:1,coopLevel:1,eggsReady:2,inventoryEggs:1,lastLayTime:Date.now(),cleanliness:0,warehouseLimit:10,hensState:[{}],equippedWeapon:'club'};
const docs = {
 'groups/A':{members:['same','onlyA','both']}, 'groups/B':{members:['same','onlyB','both']}, 'groups/C':{members:['onlyA']},
 'users/self':{accountId:'same',name:'Player',groupId:'A'},
 'users/a':{accountId:'onlyA',name:'Only A',groupId:'A'},
 'users/b':{accountId:'onlyB',name:'Only B',groupId:'B'},
 'users/both':{accountId:'both',name:'Both groups',groupId:'A'},
 'game_records/A_Player':{groupId:'A',accountId:'same',userName:'Player',totalScore:80,currentStreak:0,maxStreak:3,lastPlayDate:today},
 'game_records_2048/A_Player':{groupId:'A',accountId:'same',userName:'Player',bestScore:512},
 'game_permissions/A_Player':{rps:false,g2048:true,farm:true},
 'game_permissions/B_Player':{rps:true,g2048:true,farm:true},
 'groups/A/users/same':{farm:clone(farm)},
 'groups/B/users/onlyB':{farm:clone(farm)},
 'groups/B/users/both':{farm:clone(farm)},
 'settings/gameConfig':{targetRoomId:'roomA'},
 'groups/B/settings/gameConfig':{targetRoomId:'roomB'},
 'rooms/roomA':{groupId:'A',name:'A chat'}, 'rooms/roomB':{groupId:'B',name:'B chat'},
};
const writes=[], reads=[];let id=0;
function apply(path, data, merge){
 const next=merge?clone(docs[path]||{}):{};
 for(const [key,value] of Object.entries(data)){
  let object=next;const keys=key.split('.');for(const bit of keys.slice(0,-1))object=object[bit]??={};object[keys.at(-1)]=clone(value);
 }
 docs[path]=next;writes.push({path,data:clone(data)});
}
const mock = `
export const doc=(_, ...parts)=>({path:parts.join('/')});export const collection=doc;
export const where=(field,op,value)=>({field,op,value});export const orderBy=(field,order)=>({orderField:field,order});export const limit=value=>({limit:value});
export const query=(ref,...filters)=>({...ref,filters});
const listeners=new Map();
const snap=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data)});
async function notify(){for(const [path,cbs] of listeners){const data=await window.__dbCall({kind:'get',path});for(const cb of cbs)cb(snap(path,data));}}
export function onSnapshot(ref,cb){if(!listeners.has(ref.path))listeners.set(ref.path,new Set());listeners.get(ref.path).add(cb);window.__dbCall({kind:'get',path:ref.path}).then(data=>cb(snap(ref.path,data)));return()=>listeners.get(ref.path).delete(cb);}
export const getDoc=async ref=>snap(ref.path,await window.__dbCall({kind:'get',path:ref.path}));
export const getDocs=async ref=>{const rows=await window.__dbCall({kind:'query',...ref});return{forEach:cb=>rows.forEach(row=>cb(snap(row.path,row.data))),docs:rows.map(row=>snap(row.path,row.data)),empty:rows.length===0};};
export async function setDoc(ref,data,options={}){await window.__dbCall({kind:'set',path:ref.path,data,merge:!!options.merge});await notify();}
export const updateDoc=(ref,data)=>setDoc(ref,data,{merge:true});
export async function addDoc(ref,data){const path=await window.__dbCall({kind:'add',path:ref.path,data});return{path};}
export const serverTimestamp=()=>Date.now();
export async function runTransaction(_,callback){const pending=[];const result=await callback({get:getDoc,update:(ref,data)=>pending.push({kind:'set',path:ref.path,data,merge:true})});await window.__dbCall({kind:'transaction',pending});await notify();return result;}
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const phaser=execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 await context.exposeFunction('__dbCall',async operation=>{
  if(operation.kind==='get'){reads.push(operation.path);return clone(docs[operation.path]);}
  if(operation.kind==='set'){apply(operation.path,operation.data,operation.merge);return;}
  if(operation.kind==='add'){const path=operation.path+'/test'+(++id);apply(path,operation.data,false);return path;}
  if(operation.kind==='transaction'){for(const write of operation.pending)apply(write.path,write.data,write.merge);return;}
  if(operation.kind==='query'){
   reads.push({path:operation.path,filters:operation.filters});
   let rows=Object.entries(docs).filter(([path])=>path.startsWith(operation.path+'/')&&path.split('/').length===operation.path.split('/').length+1).map(([path,data])=>({path,data:clone(data)}));
   for(const f of operation.filters||[]){if(f.op==='==')rows=rows.filter(row=>row.data[f.field]===f.value);if(f.op==='in')rows=rows.filter(row=>f.value.includes(row.data[f.field]));if(f.orderField)rows.sort((a,b)=>f.order==='desc'?(b.data[f.orderField]||0)-(a.data[f.orderField]||0):(a.data[f.orderField]||0)-(b.data[f.orderField]||0));if(f.limit)rows=rows.slice(0,f.limit);}
   return rows;
  }
  throw Error('Unknown operation');
 });
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await context.route('**/group-switch-test.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Group switch fixture</title>'}));
 await context.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 const page=await context.newPage(),errors=[],dialogs=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
 // Keep a stale groupId=A in the profile throughout. The actively selected group is B.
 await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'same',name:'Player',groupId:'A'}));});
 await page.goto(base+'/group-switch-test.html');
 await page.evaluate(()=>localStorage.setItem('lastGroupId','B'));
 await page.goto(base+'/games.html');
 await page.waitForFunction(()=>typeof window.selectGame==='function'&&document.getElementById('gameTotalScore').innerText==='0');
 await page.evaluate(()=>{Math.random=()=>0;selectGame('rps');return playGame(1);});
 assert.equal(docs['game_records/B_Player'].totalScore,1);
 assert.equal(docs['game_records/A_Player'].totalScore,80);
 assert.ok(writes.some(write=>write.path.startsWith('scores/')&&write.data.groupId==='B'&&write.data.accountId==='same'));
 await page.evaluate(()=>selectGame('g2048'));await page.keyboard.press('ArrowLeft');
 await page.waitForFunction(()=>document.getElementById('g2048BestScore').innerText==='4');
 assert.equal(docs['game_records_2048/B_Player'].bestScore,4);
 assert.equal(docs['game_records_2048/A_Player'].bestScore,512);
 await page.evaluate(()=>openLeaderboard('rps'));
 await page.waitForFunction(()=>document.getElementById('lbList').innerText.includes('Player'));
 assert.ok(reads.some(read=>read.path==='game_records'&&read.filters.some(filter=>filter.field==='groupId'&&filter.value==='B')));
 await page.evaluate(()=>selectGame('farm'));
 await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.coins===0);
 assert.equal(docs['groups/B/users/same'].farm.coins,0);
 assert.equal(docs['groups/B/users/same'].farm.hens,1);
 assert.equal(docs['groups/A/users/same'].farm.coins,450);
 // Make and collect B eggs, then sell one. These exercise the actual game transactions.
 await page.evaluate(async()=>{
  const {db}=await import('/js/firebase-config.js');const {doc,updateDoc}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
  await updateDoc(doc(db,'groups','B','users','same'),{'farm.eggsReady':2});
  const s=window.__farmGame.scene.getScene('MyFarmScene');await s.harvestEgg();s.scene.start('ShopScene');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData?.inventoryEggs===2);
 await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').executeSellItem('inventoryEggs',10,'雞蛋',1));
 assert.equal(docs['groups/B/users/same'].farm.coins,10);
 assert.equal(docs['groups/B/users/same'].farm.inventoryEggs,1);
 await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').scene.start('LobbyScene'));
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').content.list.filter(child=>child.texture?.key==='coop').length===2);
 const names=await page.evaluate(()=>window.__farmGame.scene.getScene('LobbyScene').content.list.filter(child=>child.type==='Text').map(child=>child.text));
 assert.ok(names.includes('Only B'));assert.ok(names.includes('Both groups'));assert.ok(!names.includes('Only A'));
 // Open the actual group-B neighbor and verify broadcast configuration is group-specific.
 await page.evaluate(()=>{window.__savedBetween=Phaser.Math.Between;Phaser.Math.Between=(_,max)=>max;window.__farmGame.scene.getScene('LobbyScene').scene.start('VisitScene',{targetAccountId:'onlyB',targetName:'Only B'});});
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').hasRolledEncounter);
 await page.evaluate(async()=>{Phaser.Math.Between=window.__savedBetween;await window.__farmGame.scene.getScene('VisitScene').sendSystemNotification('隔離測試');});
 assert.ok(writes.some(write=>write.path.startsWith('messages/')&&write.data.roomId==='roomB'&&write.data.groupId==='B'));
 docs['groups/B/settings/gameConfig'].targetRoomId='roomA';const messageCount=writes.filter(write=>write.path.startsWith('messages/')).length;
 await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').sendSystemNotification('不得送到A'));
 assert.equal(writes.filter(write=>write.path.startsWith('messages/')).length,messageCount);
 assert.ok(!reads.includes('settings/gameConfig'));
 // Return to A: scores and farm are retained, not overwritten by B.
 await page.goto(base+'/group-switch-test.html');await page.evaluate(()=>localStorage.setItem('lastGroupId','A'));await page.goto(base+'/games.html');
 await page.waitForFunction(()=>document.getElementById('gameTotalScore').innerText==='80'&&document.getElementById('g2048BestScore').innerText==='512');
 await page.evaluate(()=>selectGame('rps'));assert.ok(dialogs.some(text=>text.includes('禁止')));
 await page.evaluate(()=>selectGame('farm'));
 await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.coins===450);
 // A group switch in another tab reloads the old live farm into B.
 const switcher=await context.newPage();await switcher.goto(base+'/group-switch-test.html');
 await switcher.evaluate(()=>localStorage.setItem('lastGroupId','B'));
 await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.coins===10);
 assert.deepEqual(docs['groups/A/users/same'].farm,farm);
 // Browser Back may restore a cached game; it must resolve the newly selected group.
 await switcher.close();
 await page.goto(base+'/group-switch-test.html');
 await page.evaluate(()=>localStorage.setItem('lastGroupId','A'));
 await page.goBack();
 await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData?.coins===450);
 assert.ok(!reads.some(read=>typeof read==='string'&&read.includes('default_group')));
 assert.deepEqual(errors,[]);
 await page.close();
 // A stale or invalid selection cannot create game records for a non-member.
 const outsider=await context.newPage();outsider.on('dialog',dialog=>dialog.dismiss());
 await outsider.goto(base+'/group-switch-test.html');await outsider.evaluate(()=>localStorage.setItem('lastGroupId','C'));
 const beforeUnauthorized=writes.length;
 for(const entry of ['games.html','farmgame.html']){
  await outsider.goto(base+'/'+entry);await outsider.waitForURL('**/index.html');
 }
 assert.equal(writes.length,beforeUnauthorized);
 assert.ok(!reads.some(read=>typeof read==='string'&&(read.startsWith('groups/C/users/')||read.startsWith('game_records/C_'))));
 await outsider.close();
 // No selected or legacy group must stop before any game database read/write.
 const invalid=await context.newPage();invalid.on('dialog',dialog=>dialog.dismiss());
 await invalid.goto(base+'/group-switch-test.html');
 await invalid.evaluate(()=>{localStorage.removeItem('lastGroupId');sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'same',name:'Player'}));});
 const before=writes.length;
 await invalid.evaluate(async()=>{const {readGameContext}=await import('/js/game-context.js');try{readGameContext();}catch{}}).catch(()=>{});
 await invalid.waitForURL('**/index.html');assert.equal(writes.length,before);
 console.log(JSON.stringify({passed:true,checks:['stale profile group overridden by selection','B starts fresh','RPS, 2048, reward points and permissions isolated','farm collection and shop writes scoped to B','multi-group roster uses groups.members','broadcast settings and room checked per group','A progress preserved after B play','cross-tab switch and browser Back reload old farm','non-member blocked before game records','missing group blocks instead of default_group'],errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
