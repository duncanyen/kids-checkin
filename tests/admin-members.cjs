// ADMIN_BASE_URL=http://127.0.0.1:8012 node tests/admin-members.cjs
// Real admin page; all Firebase traffic uses an in-memory database.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
const base=process.env.ADMIN_BASE_URL||'http://127.0.0.1:8012';
const docs={
 'groups/A':{name:'目前群組',members:['admin','bob','charlie','removed']},
 'groups/B':{name:'其他群組',members:['admin','bob','outsider']},
 'users/admin-doc':{accountId:'admin',name:'同名成員',role:'admin',groupId:'B',pin:'123456',menus:['chat','food']},
 'users/bob-doc':{accountId:'bob',name:'同名成員',role:'member',groupId:'B',pin:'123456',menus:['chat']},
 'users/charlie-doc':{accountId:'charlie',name:'未填群組欄位',role:'member',pin:'4321'},
 'users/removed-doc':{accountId:'removed',name:'停用者',role:'removed'},
 'users/out-doc':{accountId:'outsider',name:'其他群組成員',role:'member',groupId:'A',pin:'1234'},
 'users/join-doc':{accountId:'joined',name:'剛加入的成員',role:'member',pin:'1234'},
 'system_menus/chat':{id:'chat',label:'聊天室',order:1,isDefault:true},
 'system_menus/food':{id:'food',label:'吃什麼',order:2,isDefault:true},
};
const writes=[],queries=[];let failCommit=false,failUsers=false;let releaseMenus;const menusReady=new Promise(resolve=>{releaseMenus=resolve;});
const mock=`
export const doc=(first, ...parts)=>{const path=parts.length?parts.join('/'):first.path+'/auto-'+crypto.randomUUID();return{path,id:path.split('/').at(-1),kind:'doc'};};
export const collection=(_, ...parts)=>({path:parts.join('/'),kind:'query'});
export const where=(field,op,value)=>({field,op,value});
export const orderBy=()=>({});export const limit=()=>({});export const query=(ref,...filters)=>({...ref,filters});
export const serverTimestamp=()=>Date.now();
const snapshot=(path,data)=>({id:path.split('/').at(-1),ref:{path},exists:()=>data!==undefined,data:()=>structuredClone(data)});
export const getDoc=async ref=>snapshot(ref.path,await window.__groupDb({...ref,kind:'get'}));
export const getDocs=async ref=>{const rows=await window.__groupDb({...ref,kind:'query'});const docs=rows.map(r=>snapshot(r.path,r.data));return{docs,empty:docs.length===0,size:docs.length,forEach:cb=>docs.forEach(cb)};};
const listeners=new Set();async function emit(l){const s=l.ref.kind==='doc'?await getDoc(l.ref):await getDocs(l.ref);if(listeners.has(l))l.cb(s);}
export function onSnapshot(ref,cb,error){const l={ref,cb};listeners.add(l);emit(l).catch(e=>error?.(e));return()=>listeners.delete(l);}
async function notify(){for(const l of [...listeners])await emit(l);}
export const updateDoc=async(ref,data)=>{await window.__groupDb({...ref,kind:'update',data});await notify();};
export const addDoc=async(ref,data)=>{const id=await window.__groupDb({...ref,kind:'add',data});await notify();return{id};};
export const initializeApp=()=>({});export const getFirestore=()=>({});
export const setDoc=async(ref,data,options={})=>{await window.__groupDb({...ref,kind:'set',data,merge:!!options.merge});await notify();};
export async function runTransaction(_,callback){const pending=[];const result=await callback({get:getDoc,set:(ref,data)=>pending.push({path:ref.path,data,merge:false}),update:(ref,data)=>pending.push({path:ref.path,data,merge:true})});await window.__groupDb({kind:'transaction',pending});await notify();return result;}
export const getCountFromServer=async()=>({data:()=>({count:0})});
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.exposeFunction('__groupDb',async op=>{
  if(op.kind==='get')return docs[op.path];
  if(op.kind==='query'){
   if(op.path==='system_menus')await menusReady;
   queries.push(op);if(failUsers&&op.path==='users')throw Error('offline');
   let rows=Object.entries(docs).filter(([p])=>p.startsWith(op.path+'/')&&p.split('/').length===op.path.split('/').length+1).map(([path,data])=>({path,data}));
   for(const f of op.filters||[])if(f.field)rows=rows.filter(r=>f.op==='in'?f.value.includes(r.data[f.field]):f.op==='array-contains'?r.data[f.field]?.includes(f.value):r.data[f.field]===f.value);
   return rows;
  }
  const apply=w=>{docs[w.path]=w.merge?{...docs[w.path],...w.data}:w.data;writes.push(w);};
  if(op.kind==='transaction'){if(failCommit)throw Error('permission-denied');for(const w of op.pending)apply(w);return;}
  if(op.kind==='set'||op.kind==='update'){apply({...op,merge:op.kind==='update'||op.merge});return;}
  if(op.kind==='add'){const id='add-'+writes.length;apply({...op,path:op.path+'/'+id});return id;}
 });
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 // Use real Firebase app initialization to catch conflicting default configs.
 const sdkFile='/tmp/nexus-firebase-app.js';
 const appSdk=require('node:fs').existsSync(sdkFile)?require('node:fs').readFileSync(sdkFile,'utf8'):require('node:child_process').execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'],{encoding:'utf8',maxBuffer:2*1024*1024});
 await context.route('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js',r=>r.fulfill({contentType:'text/javascript',body:appSdk}));
 await context.route('https://ui-avatars.com/**',r=>r.abort());
 const page=await context.newPage(),errors=[],alerts=[];page.setDefaultTimeout(10000);
 page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});page.on('dialog',d=>{alerts.push(d.message());return d.accept();});
 await page.addInitScript(()=>{if(!sessionStorage.getItem('familyCheckInUser'))sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'admin',name:'同名成員',role:'admin',groupId:'B'}));if(!localStorage.getItem('lastGroupId'))localStorage.setItem('lastGroupId','A');});
 await page.goto(base+'/admin.html');
 // All six sections work while the menu request is deliberately unresolved.
 for(const [button,target]of [['btnToggleGroupSettings','groupSettingsForm'],['btnToggleRequests','requestsSection'],['btnToggleGamePanel','adminGameSection'],['btnToggleAddForm','addUserForm'],['btnToggleUserList','userListContainer'],['btnToggleLogs','logsSection']]){
  await page.click('#'+button);assert.equal(await page.locator('#'+target).isVisible(),true);assert.equal(await page.locator('#'+button).getAttribute('aria-expanded'),'true');
  await page.click('#'+button);assert.equal(await page.locator('#'+target).isVisible(),false);assert.equal(await page.locator('#'+button).getAttribute('aria-expanded'),'false');
 }
 releaseMenus();
 await page.waitForSelector('#newMenusContainer input[value="food"]',{state:'attached'});
 await page.waitForSelector('#userListContainer [data-account-id="bob"]',{state:'attached'});
 await page.click('#btnToggleUserList');
 await page.waitForFunction(()=>document.querySelectorAll('#userListContainer [data-account-id]').length===3);
 assert.deepEqual(await page.locator('#userListContainer [data-account-id]').evaluateAll(rows=>rows.map(r=>r.dataset.accountId)),['admin','bob','charlie']);
 // Save permission changes on a joined profile with a different primary group and a six-character existing PIN.
 await page.locator('[data-account-id="bob"] .btn-edit').click();assert.equal(await page.inputValue('#editDocId'),'bob-doc');
 await page.check('#editMenusContainer input[value="food"]');await page.click('#btnSaveEditUser');await page.waitForFunction(()=>document.getElementById('editModal').style.display==='none');
 assert.ok(docs['users/bob-doc'].menus.includes('food'));assert.equal(docs['users/bob-doc'].groupId,'B');assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('familyCheckInUser')).accountId),'admin');
 // Membership changes appear while the page is open.
 await page.evaluate(async()=>{const {doc,updateDoc}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');await updateDoc(doc({},'groups','A'),{members:['admin','bob','charlie','removed','joined']});});
 await page.waitForSelector('[data-account-id="joined"]');
 // Removing from A never globally disables the profile or removes membership in B.
 await page.locator('[data-account-id="bob"] .btn-remove').click();await page.waitForFunction(()=>!document.querySelector('[data-account-id="bob"]'));
 assert.equal(docs['groups/A'].members.includes('bob'),false);assert.equal(docs['groups/B'].members.includes('bob'),true);assert.equal(docs['users/bob-doc'].role,'member');assert.equal(docs['users/bob-doc'].groupId,'B');
 // Creating a profile and adding membership is atomic, and a failed commit leaves neither behind.
 await page.click('#btnToggleAddForm');await page.fill('#newUserId','NeWMember');await page.fill('#newUserName','新成員');await page.fill('#newUserPin','1234');
 failCommit=true;await page.click('#btnAddUser');await page.waitForFunction(()=>!document.getElementById('btnAddUser').disabled);assert.equal(docs['groups/A'].members.includes('newmember'),false);assert.equal(Object.values(docs).some(d=>d.accountId==='newmember'),false);failCommit=false;
 await page.click('#btnAddUser');await page.waitForSelector('[data-account-id="newmember"]');assert.equal(docs['groups/A'].members.includes('newmember'),true);
 // Duplicate IDs are rejected even for an account outside the current group.
 await page.click('#btnToggleAddForm');await page.fill('#newUserId','OUTSIDER');await page.fill('#newUserName','不可重複');await page.fill('#newUserPin','1234');
 const beforeDuplicate=writes.length;await page.click('#btnAddUser');await page.waitForFunction(()=>!document.getElementById('btnAddUser').disabled);assert.equal(writes.length,beforeDuplicate);assert.match(alerts.at(-1),/不分大小寫/);
 // Approval reuses an existing account and joins it to this group without duplicating its profile.
 docs['group_requests/request']={groupId:'A',status:'pending'};
 const profilesBefore=Object.keys(docs).filter(p=>p.startsWith('users/')).length;
 await page.evaluate(()=>handleRequest('request','approved','out-doc','其他群組成員'));await page.waitForSelector('[data-account-id="outsider"]');assert.equal(Object.keys(docs).filter(p=>p.startsWith('users/')).length,profilesBefore);assert.equal(docs['groups/A'].members.includes('outsider'),true);assert.equal(docs['group_requests/request'].status,'approved');
 // Rejecting an incomplete legacy request does not require a user profile.
 docs['group_requests/reject']={groupId:'A',status:'pending'};
 await page.evaluate(()=>handleRequest('reject','rejected','','舊申請'));assert.equal(docs['group_requests/reject'].status,'rejected');
 // Switching groups resolves the new group, not stale profile.groupId.
 await page.evaluate(()=>localStorage.setItem('lastGroupId','B'));await page.reload();await page.waitForSelector('[data-account-id="bob"]',{state:'attached'});assert.equal(await page.locator('[data-account-id="charlie"]').count(),0);assert.equal(await page.locator('[data-account-id="outsider"]').count(),1);
 // Back/forward cache restoration keeps the membership subscription and refreshes the list.
 await page.evaluate(async()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));const {doc,updateDoc}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');await updateDoc(doc({},'groups','B'),{members:['admin','bob','outsider','charlie']});window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
 await page.waitForSelector('[data-account-id="charlie"]',{state:'attached'});
 assert.ok(queries.some(q=>q.path==='users'&&!q.filters)); // Global legacy-ID duplicate check.
 assert.ok(queries.filter(q=>q.path==='users'&&q.filters).every(q=>q.filters.some(f=>f.field==='accountId')));
 assert.deepEqual(errors,[]);console.log('PASS: real Firebase app initialization, all six dropdowns during delayed loading, authoritative membership list, multi-group profiles, same-name edit/self identity, preserved PIN, live joins, group-only removal, atomic add/retry, approval reuses profile, selected group isolation');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
