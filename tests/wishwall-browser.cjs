// WISH_BASE_URL=http://127.0.0.1:8011 node tests/wishwall-browser.cjs
// Persistent in-memory Firestore with optimistic transaction retries; no production access.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.WISH_BASE_URL||'http://127.0.0.1:8011';
const clone=value=>value===undefined?undefined:structuredClone(value);
const settings={examRules:[{id:'exA',type:'小考',minScore:100,reqCount:1,points:2}],choreRules:[{id:'chA',name:'洗碗',points:1}],gifts:[{id:'giftA',name:'A圖書',icon:'🎁',points:8}]};
const docs={
 'groups/A':{name:'A群組',members:['admin','alice','bob']},'groups/B':{name:'B群組',members:['admin','alice','outsider']},'groups/C':{name:'非成員群組',members:['outsider']},
 'users/p-admin':{accountId:'admin',name:'管理者',role:'admin',groupId:'B'},
 'users/p-alice':{accountId:'alice',name:'同名成員',role:'child',groupId:'B'},
 'users/p-bob':{accountId:'bob',name:'同名成員',role:'child',groupId:'A'},
 'users/p-out':{accountId:'outsider',name:'其他群組成員',role:'child',groupId:'A'},
 'groups/A/settings/wishWall':clone(settings),
 'groups/B/settings/wishWall':{examRules:[],choreRules:[],gifts:[{id:'giftB',name:'B限定獎品',points:2}]},
 'groups/A/scores/alice-10':{groupId:'A',accountId:'alice',operator:'舊名字',category:'chore',choreName:'原有積分',points:10,date:'2026-01-01',timestamp:1},
 'groups/A/scores/bob-30':{groupId:'A',accountId:'bob',operator:'舊名字',category:'chore',choreName:'原有積分',points:30,date:'2026-01-01',timestamp:1},
 'groups/A/scores/unbound':{groupId:'A',operator:'同名成員',category:'chore',choreName:'舊積分',points:9,date:'2026-01-01',timestamp:1},
 'groups/A/scores/wrong-group':{groupId:'B',accountId:'alice',operator:'同名成員',points:999,date:'2026-01-01'},
 'groups/B/scores/alice-50':{groupId:'B',accountId:'alice',operator:'同名成員',points:50,date:'2026-01-01',timestamp:1},
};
const versions=new Map(),writes=[],queries=[];let retries=0;
function write(entry){
 if(entry.delete)delete docs[entry.path];
 else {const next=entry.merge?clone(docs[entry.path]||{}):{};for(const [key,value] of Object.entries(entry.data)){let object=next;const bits=key.split('.');for(const bit of bits.slice(0,-1))object=object[bit]??={};object[bits.at(-1)]=clone(value);}docs[entry.path]=next;}
 versions.set(entry.path,(versions.get(entry.path)||0)+1);writes.push(clone(entry));
}
const mock=`
export const doc=(_, ...parts)=>({path:parts.join('/'),kind:'doc'});export const collection=(_, ...parts)=>({path:parts.join('/'),kind:'query'});
export const where=(field,op,value)=>({field,op,value});export const query=(ref,...filters)=>({...ref,kind:'query',filters});export const serverTimestamp=()=>Date.now();
const snapshot=(path,row)=>({id:path.split('/').at(-1),exists:()=>row.data!==undefined,data:()=>structuredClone(row.data),version:row.version});
export const getDoc=async ref=>snapshot(ref.path,await window.__wishDb({kind:'get',path:ref.path}));
export const getDocs=async ref=>{const rows=await window.__wishDb({kind:'query',...ref});return{docs:rows.map(row=>snapshot(row.path,row)),forEach:cb=>rows.forEach(row=>cb(snapshot(row.path,row)))};};
const listeners=new Set();async function emit(listener){const snap=listener.ref.kind==='query'?await getDocs(listener.ref):await getDoc(listener.ref);if(listeners.has(listener))listener.callback(snap);}
export function onSnapshot(ref,callback,error){const listener={ref,callback,error};listeners.add(listener);emit(listener).catch(e=>error?.(e));return()=>listeners.delete(listener);}
async function notify(){for(const listener of [...listeners])if(listeners.has(listener))await emit(listener);}
export async function updateDoc(ref,data){await window.__wishDb({kind:'commit',expected:[],pending:[{path:ref.path,data,merge:true}]});await notify();}
export async function runTransaction(_,callback){for(let attempt=0;attempt<10;attempt++){
 const pending=[],expected=[];
 const result=await callback({get:async ref=>{const snap=await getDoc(ref);expected.push([ref.path,snap.version]);return snap;},set:(ref,data,options={})=>pending.push({path:ref.path,data,merge:!!options.merge}),update:(ref,data)=>pending.push({path:ref.path,data,merge:true}),delete:ref=>pending.push({path:ref.path,delete:true})});
 try{await window.__wishDb({kind:'commit',expected,pending});await notify();return result;}catch(error){if(!error.message.includes('ABORTED')||attempt===9)throw error;}
 }}
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Taipei'}),errors=[],alerts=[];
 await context.exposeFunction('__wishDb',operation=>{
  if(operation.kind==='get')return{data:clone(docs[operation.path]),version:versions.get(operation.path)||0};
  if(operation.kind==='query'){
   queries.push(clone(operation));let rows=Object.entries(docs).filter(([path])=>path.startsWith(operation.path+'/')&&path.split('/').length===operation.path.split('/').length+1).map(([path,data])=>({path,data:clone(data),version:versions.get(path)||0}));
   for(const filter of operation.filters||[]){if(filter.op==='==')rows=rows.filter(row=>row.data[filter.field]===filter.value);if(filter.op==='in')rows=rows.filter(row=>filter.value.includes(row.data[filter.field]));}return rows;
  }
  if(operation.kind==='commit'){
   if(operation.expected.some(([path,version])=>(versions.get(path)||0)!==version)){retries++;throw Error('ABORTED');}
   for(const entry of operation.pending)write(entry);return;
  }
  throw Error('Unsupported mock call');
 });
 await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 async function open(accountId){const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{alerts.push(dialog.message());await dialog.accept(dialog.type()==='prompt'?'測試書籍／取消理由':undefined);});await page.addInitScript(accountId=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId,name:'過期名稱',role:'admin',groupId:'B'}));if(!localStorage.getItem('lastGroupId'))localStorage.setItem('lastGroupId','A');},accountId);await page.goto(base+'/wishwall.html');await page.waitForFunction(()=>window.NexusWishWall?.ready);return page;}
 async function storeFor(page){await page.evaluate(async()=>{const {WishWallStore}=await import('/js/wishwall-store.js');const user=JSON.parse(sessionStorage.getItem('familyCheckInUser'));window.__store=new WishWallStore({user,groupId:localStorage.getItem('lastGroupId'),accountId:user.accountId});await window.__store.loadMembers();});}
 async function patch(page,path,data){await page.evaluate(async({path,data})=>{const {db}=await import('/js/firebase-config.js');const {doc,updateDoc}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');await updateDoc(doc(db,...path.split('/')),data);},{path,data});}
 const checks=[],admin=await open('admin');
 assert.equal(await admin.locator('#memberPointsContainer [data-account-id]').count(),3);
 assert.equal(await admin.locator('#memberPointsContainer [data-account-id="outsider"]').count(),0);
 assert.match(await admin.locator('[data-account-id="alice"]').innerText(),/10 點/);assert.match(await admin.locator('[data-account-id="bob"]').innerText(),/30 點/);
 assert.match(await admin.locator('#wishGroupLabel').innerText(),/A群組/);
 assert.ok(queries.filter(q=>q.path==='users').every(q=>q.filters[0].field==='accountId'));
 checks.push('selected group overrides stale profile; members from groups.members; same names keep separate account balances; mismatched group ignored');
 // Edit each setting through the existing admin form.
 await admin.fill('#setExamMinScore','95');await admin.fill('#setExamReqCount','2');await admin.fill('#setExamPoints','4');await admin.evaluate(()=>addSetting('examRules'));
 await admin.fill('#setChoreName','整理玩具');await admin.fill('#setChorePoints','2');await admin.evaluate(()=>addSetting('choreRules'));
 await admin.fill('#setGiftName','親子旅行');await admin.fill('#setGiftPoints','4');await admin.evaluate(()=>addSetting('gifts'));
 const saved=docs['groups/A/settings/wishWall'];assert.equal(saved.groupId,'A');assert.equal(saved.accountId,'admin');assert.equal(saved.updatedByAccountId,'admin');
 for(const [kind,length] of [['examRules',2],['choreRules',2],['gifts',2]]){assert.equal(saved[kind].length,length);assert.equal(saved[kind].at(-1).groupId,'A');assert.equal(saved[kind].at(-1).accountId,'admin');}
 assert.equal(docs['groups/B/settings/wishWall'].gifts[0].name,'B限定獎品');
 checks.push('exam rules, chore rules and gift settings save groupId and author accountId without changing B');
 // Unbound records are not guessed by name; admin explicitly assigns a current account.
 await admin.locator('#adminScoreListWrapper').evaluate(element=>element.style.display='block');
 const legacy=admin.locator('[data-record-id="unbound"]');await legacy.getByRole('combobox').selectOption('bob');await legacy.getByRole('button',{name:'確認歸屬'}).click();
 await admin.waitForFunction(()=>window.NexusWishWall.scores.find(record=>record.id==='unbound')?.accountId==='bob');
 assert.equal(docs['groups/A/scores/unbound'].accountId,'bob');assert.match(await admin.locator('[data-account-id="bob"]').innerText(),/39 點/);assert.match(await admin.locator('[data-account-id="alice"]').innerText(),/10 點/);
 checks.push('legacy ownership requires explicit admin binding; homonymous member never receives guessed credit');
 const alice=await open('alice');assert.equal(await alice.locator('#adminView').isVisible(),false);assert.match(await alice.locator('#userPointsDisplay').innerText(),/10 點/);
 await alice.fill('#examScore','100');await alice.click('#btnSubmitScore');await alice.waitForFunction(()=>window.NexusWishWall.scores.some(record=>record.category==='exam'));
 await alice.selectOption('#choreSelect','chA');await alice.click('#btnSubmitChore');await alice.waitForFunction(()=>window.NexusWishWall.scores.some(record=>record.choreId==='chA'));
 const ownScores=Object.entries(docs).filter(([path,record])=>path.startsWith('groups/A/scores/')&&record.accountId==='alice');assert.equal(ownScores.length,4); // includes a quarantined mismatched-group fixture
 for(const [path,score] of ownScores.filter(([path])=>!['groups/A/scores/alice-10','groups/A/scores/wrong-group'].includes(path))){assert.equal(score.groupId,'A');assert.equal(score.accountId,'alice');assert.equal(score.createdByAccountId,'alice');}
 assert.match(await alice.locator('#userPointsDisplay').innerText(),/13 點/);
 await patch(alice,'users/p-alice',{name:'改名成員'});await alice.waitForFunction(()=>document.getElementById('userPointsDisplay').innerText.includes('改名成員'));
 assert.match(await alice.locator('#userPointsDisplay').innerText(),/13 點/);assert.equal(await alice.locator('#scoreListContainer').innerText().then(text=>text.includes('bob-30')),false);
 checks.push('exam/chore saves carry owner IDs, profile rename preserves points and ownership, session admin role cannot elevate a child');
 // Two independently loaded views spend the same 13 points on an 8-point gift.
 const second=await open('alice');await storeFor(alice);await storeFor(second);
 const staleSettings=clone(docs['groups/A/settings/wishWall']);
 await patch(admin,'groups/A/settings/wishWall',{gifts:staleSettings.gifts.map(gift=>gift.id==='giftA'?{...gift,points:99}:gift)});
 const priceCheck=await alice.evaluate(async()=>{try{await window.__store.redeem('giftA','畫面舊價格');return false;}catch(error){return error.message;}});
 assert.match(priceCheck,/積分不足/);
 await patch(admin,'groups/A/settings/wishWall',{gifts:staleSettings.gifts});
 const beforeRedeems=Object.keys(docs).filter(path=>path.startsWith('groups/A/redeems/')).length;
 const outcomes=await Promise.all([alice,second].map(page=>page.evaluate(async()=>{try{await window.__store.redeem('giftA','並行兌換');return 'ok';}catch(error){return error.message;}})));
 assert.equal(outcomes.filter(value=>value==='ok').length,1);assert.ok(outcomes.some(value=>value.includes('積分不足')));
 const redeems=Object.entries(docs).filter(([path])=>path.startsWith('groups/A/redeems/'));assert.equal(redeems.length,beforeRedeems+1);
 const [redeemPath,redeem]=redeems.at(-1);assert.equal(redeem.accountId,'alice');assert.equal(redeem.groupId,'A');assert.equal(redeem.cost,8);assert.equal(redeem.operator,'改名成員');
 checks.push('concurrent redemption rereads account ledger and gift price; only one succeeds with insufficient points for both');
 // No child can modify another member or shared settings, even via direct calls.
 const noWrite=writes.length;
 const denied=await alice.evaluate(async()=>{
  const errors=[];
  for(const action of [()=>window.__store.deleteScore('bob-30'),()=>window.__store.changeSetting('gifts',{name:'作弊',points:1}),()=>window.__store.updateRedeem('missing','已完成')])try{await action();}catch(error){errors.push(error.message);}
  return errors;
 });assert.equal(denied.length,3);assert.equal(writes.length,noWrite);
 // Cancel/refund once, preserving owner and auditing the actor. Repeated cancellation is a no-op.
 const redeemId=redeemPath.split('/').at(-1);
 const bob=await open('bob');await storeFor(bob);const beforeOtherOwner=writes.length;
 const otherOwner=await bob.evaluate(async id=>{try{await window.__store.updateRedeem(id,'已取消','別人的申請');return false;}catch{return true;}},redeemId);
 assert.equal(otherOwner,true);assert.equal(writes.length,beforeOtherOwner);await bob.close();
 await alice.evaluate(async id=>{await window.__store.updateRedeem(id,'已取消','不需要了');await window.__store.updateRedeem(id,'已取消','不需要了');},redeemId);
 assert.equal(docs[redeemPath].accountId,'alice');assert.equal(docs[redeemPath].updatedByAccountId,'alice');assert.equal(docs[redeemPath].status,'已取消');
 const {calculatePoints}=await import('../js/wishwall-core.js');
 const points=()=>calculatePoints(Object.entries(docs).filter(([path])=>path.startsWith('groups/A/scores/')).map(([path,value])=>({...value,id:path.split('/').at(-1)})),Object.entries(docs).filter(([path])=>path.startsWith('groups/A/redeems/')).map(([path,value])=>({...value,id:path.split('/').at(-1)})),docs['groups/A/settings/wishWall'],'A').balances.get('alice');
 assert.equal(points(),13);checks.push('ownership/admin checks reject unauthorized writes; repeated cancellation refunds once');
 await second.close();await admin.close();
 // Switching to B shows B settings/points; returning A retains the renamed A account.
 await alice.evaluate(()=>localStorage.setItem('lastGroupId','B'));await alice.reload();await alice.waitForFunction(()=>window.NexusWishWall?.ready&&document.getElementById('wishGroupLabel').innerText.includes('B群組'));
 assert.match(await alice.locator('#userPointsDisplay').innerText(),/50 點/);assert.match(await alice.locator('#giftShopGrid').innerText(),/B限定獎品/);assert.equal(docs['groups/B/scores/alice-50'].points,50);
 await alice.evaluate(()=>localStorage.setItem('lastGroupId','A'));await alice.reload();await alice.waitForFunction(()=>window.NexusWishWall?.ready&&document.getElementById('wishGroupLabel').innerText.includes('A群組'));assert.match(await alice.locator('#userPointsDisplay').innerText(),/13 點/);
 checks.push('A → B → A maintains independent settings, scores, redemptions and renamed-account balances');
 // A removed member cannot continue writing from a previously loaded page.
 await storeFor(alice);await patch(alice,'groups/A',{members:['admin','bob']});await alice.waitForFunction(()=>window.NexusWishWall.failed);
 const beforeRemoval=writes.length;const removed=await alice.evaluate(async()=>{try{await window.__store.createScore({category:'chore',choreId:'chA'});return false;}catch{return true;}});assert.equal(removed,true);assert.equal(writes.length,beforeRemoval);
 await alice.close();
 docs['groups/D']={name:'新群組',members:['admin']};
 const newAdmin=await open('admin');await newAdmin.evaluate(()=>localStorage.setItem('lastGroupId','D'));await newAdmin.reload();await newAdmin.waitForFunction(()=>window.NexusWishWall?.ready&&document.getElementById('wishGroupLabel').innerText.includes('新群組'));
 assert.equal(docs['groups/D/settings/wishWall'].groupId,'D');assert.equal(docs['groups/D/settings/wishWall'].accountId,'admin');assert.equal(docs['groups/D/settings/wishWall'].createdByAccountId,'admin');
 checks.push('new group initializes its own settings with administrator account audit');
 assert.deepEqual(errors,[]);assert.ok(!writes.some(write=>write.path.startsWith('groups/default_group/')));
 console.log(JSON.stringify({passed:true,checks:[...checks,'removed member blocked; no fallback/shared-group writes'],retries,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
