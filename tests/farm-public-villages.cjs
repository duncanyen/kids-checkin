// FARM_BASE_URL=http://127.0.0.1:8009 node tests/farm-public-villages.cjs
// Every database operation uses a persistent in-memory mock, never production.
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8000';
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
const writes=[],reads=[];let serial=0;
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
  if(operation.kind==='transaction'){for(const item of operation.pending)write(item.path,item.data,item.merge);return;}
  throw Error('Unsupported mock operation');
 });
 const phaser=execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','window.__farmGame =')});});
 await page.addInitScript(()=>{localStorage.setItem('lastGroupId','A');sessionStorage.setItem('familyCheckInUser',JSON.stringify({name:'Player',accountId:'player',groupId:'stale',role:'admin'}));});
 const checks=[];
 async function openLobby(){await page.goto(base+'/farmgame.html');await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.farmData);await page.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('LobbyScene'));await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='A');}
 async function patch(path,data){await page.evaluate(async({path,data})=>{const {db}=await import('/js/firebase-config.js');const {doc,updateDoc}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');await updateDoc(doc(db,...path.split('/')),data);},{path,data});}
 async function publicList(){await page.evaluate(()=>window.__farmGame.scene.getScene('LobbyScene').showPublic());await page.waitForFunction(()=>{const s=window.__farmGame.scene.getScene('LobbyScene');return s.mode==='public'&&!s.loadingText.visible;});}
 async function visit(groupId){await page.evaluate(async groupId=>{const s=window.__farmGame.scene.getScene('LobbyScene');await s.showVillage(groupId);window.__savedBetween=Phaser.Math.Between;Phaser.Math.Between=(_,max)=>max;s.content.list.find(object=>object.texture?.key==='coop').emit('pointerdown');},groupId);await page.waitForFunction(()=>window.__farmGame.scene.isActive('VisitScene')&&window.__farmGame.scene.getScene('VisitScene').hasRolledEncounter);await page.evaluate(()=>{Phaser.Math.Between=window.__savedBetween;});}
 await openLobby();
 await page.evaluate(async()=>{const s=window.__farmGame.scene.getScene('LobbyScene');if(s.publicEnabled||s.searchRoot.style.display!=='none'||s.titleText.text!=='自己的小屋村落')throw Error('Default village must be closed and named');const {readVillageAccess}=await import('/js/farm/villages.js');let denied=false;try{await readVillageAccess('A','B','player');}catch{denied=true;}if(!denied)throw Error('Closed source entered public village');});
 checks.push('default closed, own-group title, closed-source access denied');
 // Save the setting through the actual admin UI, scoped to the selected group A.
 await page.goto(base+'/admin.html');await page.waitForFunction(()=>document.getElementById('userListContainer')?.textContent.includes('Player'));
 await page.click('#btnToggleGamePanel');await page.waitForFunction(()=>!document.getElementById('villageVisibility').disabled);
 assert.equal(await page.inputValue('#villageVisibility'),'closed');
 await page.selectOption('#villageVisibility','public');await page.waitForFunction(()=>document.getElementById('villageVisibilityStatus').textContent.startsWith('已儲存'));
 assert.equal(docs['groups/A'].farmVillageVisibility,'public');assert.equal(docs['groups/closed'].farmVillageVisibility,'closed');
 checks.push('admin UI saves public/closed setting for selected group only');
 await openLobby();
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('LobbyScene');if(!s.publicEnabled||s.mode!=='own'||s.titleText.text!=='自己的小屋村落')throw Error('Public village must start at home roster');});
 // Swipe using actual canvas coordinates; the right-arrow button is also present.
 const canvas=await page.locator('canvas').boundingBox();
 await page.mouse.move(canvas.x+260*canvas.width/390,canvas.y+680*canvas.height/844);await page.mouse.down();await page.mouse.move(canvas.x+110*canvas.width/390,canvas.y+680*canvas.height/844,{steps:6});await page.mouse.up();
 await page.waitForFunction(()=>{const s=window.__farmGame.scene.getScene('LobbyScene');return s.mode==='public'&&!s.loadingText.visible;});
 const first=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('LobbyScene');return s.content.list.map(object=>object.getData('villageGroupId')).filter(Boolean);});
 assert.equal(first.length,10);assert.ok(!first.includes('A')&&!first.includes('closed'));
 await page.evaluate(()=>window.__farmGame.scene.getScene('LobbyScene').pager.list.find(object=>object.getData('page')===2).emit('pointerdown'));
 const second=await page.evaluate(()=>window.__farmGame.scene.getScene('LobbyScene').content.list.map(object=>object.getData('villageGroupId')).filter(Boolean));
 assert.equal(second.length,10);assert.ok(second.every(id=>!first.includes(id)));
 await page.evaluate(()=>window.__farmGame.scene.getScene('LobbyScene').pager.list.find(object=>object.getData('page')===3).emit('pointerdown'));
 assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('LobbyScene').content.list.filter(object=>object.getData('villageGroupId')).length),6);
 checks.push('home default, swipe and right-arrow navigation, only other public groups, numbered 10/10/6 pagination');
 if(process.env.FARM_SCREENSHOTS)await page.screenshot({path:process.env.FARM_SCREENSHOTS+'/public-villages.png'});
 const search=page.getByRole('combobox',{name:'搜尋公開村落'});
 await search.fill('太陽');await page.getByRole('option',{name:'太陽花村落',exact:true}).waitFor();
 assert.equal(await page.getByRole('option',{name:'太陽秘密村落'}).count(),0);
 await search.press('ArrowDown');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').titleText.text==='太陽花村落');
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('LobbyScene');if(s.content.list.filter(object=>object.texture?.key==='coop').length!==1)throw Error('Only established member farms should appear');});
 checks.push('keyword autocomplete and keyboard selection, group-name title, excludes unestablished farms');
 if(process.env.FARM_SCREENSHOTS)await page.screenshot({path:process.env.FARM_SCREENSHOTS+'/public-village-farms.png'});
 await visit('B');
 await page.evaluate(async()=>{Math.random=()=>0;const s=window.__farmGame.scene.getScene('VisitScene');if(s.targetGroupId!=='B')throw Error('Wrong target group');await s.attemptSteal();await s.attemptSteal();});
 assert.equal(docs['groups/B/users/neighbor'].farm.eggsReady,5);assert.equal(docs['groups/A/users/player'].farm.inventoryEggs,1);assert.equal(docs['groups/A/users/neighbor'].farm.eggsReady,6);
 await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('LobbyScene',{targetGroupId:'C'}));
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='C');await visit('C');
 await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').attemptSteal());
 assert.equal(docs['groups/C/users/neighbor'].farm.eggsReady,5);assert.equal(docs['groups/A/users/player'].farm.inventoryEggs,2);
 checks.push('cross-group egg transfer goes to original warehouse; repeated theft blocked; same account in another group has separate cooldown');
 // Dragon penalties must use the visited group while charging the original player.
 await page.evaluate(async()=>{const {settleDragonEncounter}=await import('/js/farm/dragon.js');await settleDragonEncounter('public-loss','loss','neighbor','C');await settleDragonEncounter('public-win','win','neighbor','B');});
 assert.equal(docs['groups/C/users/neighbor'].farm.eggsReady,0);assert.equal(docs['groups/A/users/player'].farm.coins,150);assert.equal(docs['groups/A/users/player'].farm.dragonScales,1);assert.equal(docs['groups/A/users/neighbor'].farm.eggsReady,6);
 checks.push('cross-group dragon loss and reward keep source and target farms separate');
 // Failure is a committed attempt: the target egg remains, cooldown and moral cost persist.
 await patch('groups/A/users/player',{'farm.villageStealCooldowns':{},'farm.moral':100});
 await page.evaluate(async()=>{Math.random=()=>0.99;const s=window.__farmGame.scene.getScene('VisitScene');s.targetFarmData.eggsReady=1;});
 await patch('groups/C/users/neighbor',{'farm.eggsReady':2});
 await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').attemptSteal());
 assert.equal(docs['groups/C/users/neighbor'].farm.eggsReady,2);assert.equal(docs['groups/A/users/player'].farm.moral,95);assert.equal(Object.keys(docs['groups/A/users/player'].farm.villageStealCooldowns).length,1);
 checks.push('failed theft commits cooldown and moral cost without taking an egg');
 // Close a village during a visit; the live listener returns the player home.
 await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('LobbyScene',{targetGroupId:'B'}));
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B');await visit('B');
 await patch('groups/B',{farmVillageVisibility:'closed'});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('LobbyScene')&&window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='A');
 const before=writes.length;
 await page.evaluate(async()=>{const {settleDragonEncounter}=await import('/js/farm/dragon.js');let denied=false;try{await settleDragonEncounter('closed-loss','loss','neighbor','B');}catch{denied=true;}if(!denied)throw Error('Closed village accepted a transaction');});
 assert.equal(writes.length,before);
 await publicList();await search.fill('太陽');assert.equal(await page.getByRole('option',{name:'太陽花村落',exact:true}).count(),0);
 await search.fill('不存在');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').content.list.some(object=>object.text==='找不到符合的公開村落'));
 checks.push('live closure returns home, removed from directory/search, denied transaction writes nothing, empty search state');
 // Close source A via admin UI and verify its next visit exposes no public browser.
 await page.goto(base+'/admin.html');await page.waitForFunction(()=>document.getElementById('userListContainer')?.textContent.includes('Player'));await page.click('#btnToggleGamePanel');await page.waitForFunction(()=>!document.getElementById('villageVisibility').disabled);await page.selectOption('#villageVisibility','closed');await page.waitForFunction(()=>document.getElementById('villageVisibilityStatus').textContent.startsWith('已儲存'));
 assert.equal(docs['groups/A'].farmVillageVisibility,'closed');await openLobby();
 await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('LobbyScene');if(s.publicEnabled||s.searchRoot.style.display!=='none')throw Error('Closed source still exposes public browser');s.scene.start('MyFarmScene');});
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene'));
 assert.equal(await page.getByRole('combobox',{name:'搜尋公開村落'}).count(),0);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
