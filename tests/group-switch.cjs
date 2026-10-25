// GROUP_BASE_URL=http://127.0.0.1:8012 node tests/group-switch.cjs
// Run the real homepage modules against an in-memory Firestore; no production IO.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.GROUP_BASE_URL || 'http://127.0.0.1:8012';
const docs = {
 'users/alice-doc': { accountId:'alice',name:'小明',role:'child',avatar:'',menus:['food'] },
 'users/bob-doc': { accountId:'bob',name:'小明',role:'child' },
 'groups/A': { name:'原有群組',members:['alice'],icon:'🏠',inviteCode:'GROUPA' },
 'groups/B': { name:'朋友群組',members:['bob'],icon:'🌟',inviteCode:'GROUPB' },
};
const writes=[],queries=[];let failList=false,failCreate=false,groupCounter=0;
const mock=`
export const doc=(_, ...parts)=>({path:parts.join('/'),id:parts.at(-1),kind:'doc'});
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
export const runTransaction=()=>{throw Error('Unexpected registration transaction in group-switch test');};
export const getCountFromServer=async()=>({data:()=>({count:0})});
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.exposeFunction('__groupDb',op=>{
  if(op.kind==='get')return docs[op.path];
  if(op.kind==='query'){
   queries.push(op);
   if(failList&&op.path==='groups'&&op.filters?.some(f=>f.op==='array-contains'))throw Error('offline');
   let rows=Object.entries(docs).filter(([path])=>path.startsWith(op.path+'/')&&path.split('/').length===op.path.split('/').length+1).map(([path,data])=>({path,data}));
   for(const f of op.filters||[]){if(!f.field)continue;rows=rows.filter(r=>f.op==='array-contains'?r.data[f.field]?.includes(f.value):f.op==='in'?f.value.includes(r.data[f.field]):r.data[f.field]===f.value);}
   return rows;
  }
  if(op.kind==='update'){docs[op.path]={...docs[op.path],...op.data};writes.push(op);return;}
  if(op.kind==='add'){
   if(op.path==='groups'&&failCreate)throw Error('permission-denied');
   const id=op.path==='groups'?'created-'+(++groupCounter):'log-'+writes.length;
   docs[op.path+'/'+id]=op.data;writes.push({...op,id});return id;
  }
 });
 await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 const page=await context.newPage(),errors=[],alerts=[];page.setDefaultTimeout(10000);
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{alerts.push(d.message());return d.accept();});
 await page.addInitScript(()=>{if(!sessionStorage.getItem('familyCheckInUser'))sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'小明',docId:'alice-doc',menus:['food']}));});
 await page.goto(base+'/index.html');await page.waitForFunction(()=>document.getElementById('dashboardView').style.display==='block'&&sessionStorage.getItem('nexus_active_group_id')==='A');
 // A single group still auto-enters after login, but explicit switching must show the list.
 await page.evaluate(()=>toggleSidebar());await page.locator('#sideMenuFeatureList .sidebar-item').filter({hasText:'切換群組'}).click();
 await page.waitForSelector('#groupSelectionSection.active');assert.equal(await page.locator('#groupListContainer .group-card').count(),1);
 assert.equal(await page.locator('#sidebar').evaluate(el=>el.classList.contains('active')),false);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('nexus_active_group_id')),'A');
 await page.locator('#groupSelectionSection button').filter({hasText:'建立或加入'}).click();await page.waitForSelector('#obStepAction.active');
 assert.equal(await page.locator('#backToGroupSelection').isVisible(),true);
 await page.locator('#backToGroupSelection').click();await page.waitForSelector('#groupSelectionSection.active');
 await page.locator('#returnToCurrentGroup').click();await page.waitForFunction(()=>document.getElementById('dashboardView').style.display==='block');
 assert.equal(await page.evaluate(()=>currentGroup.id),'A');
 // Create through the existing form, choose an icon, and enter its own group context.
 await page.evaluate(()=>switchGroup());await page.locator('#groupSelectionSection button').filter({hasText:'建立或加入'}).click();
 await page.locator('#obStepAction button').filter({hasText:'建立全新'}).click();
 const beforeGroups=Object.keys(docs).filter(k=>k.startsWith('groups/')).length;
 await page.locator('#obStepCreate button').filter({hasText:'完成建立'}).click();assert.match(alerts.at(-1),/名稱/);
 await page.fill('#obGroupName','新的 <b>群組</b>');await page.locator('.preset-icon').filter({hasText:'🌟'}).click();
 // The duplicate guard applies even if actions are invoked before the overlay paints.
 await page.evaluate(()=>Promise.all([processCreateGroup(),processCreateGroup()]));
 await page.waitForFunction(()=>sessionStorage.getItem('nexus_active_group_id')==='created-1'&&document.getElementById('dashboardView').style.display==='block');
 assert.equal(Object.keys(docs).filter(k=>k.startsWith('groups/')).length,beforeGroups+1);
 const created=docs['groups/created-1'];assert.deepEqual(created.members,['alice']);assert.equal(created.icon,'🌟');assert.equal(created.inviteCode.length,6);
 assert.equal(await page.evaluate(()=>localStorage.getItem('lastGroupId')),'created-1');assert.deepEqual(docs['groups/A'].members,['alice']);
 await page.evaluate(()=>switchGroup());assert.equal(await page.locator('#groupListContainer .group-card').count(),2);
 assert.equal(await page.locator('#groupListContainer b').count(),0);assert.match(await page.locator('#groupListContainer').innerText(),/新的 <b>群組<\/b>/);
 await page.reload();await page.waitForFunction(()=>currentGroup?.id==='created-1'&&document.getElementById('dashboardView').style.display==='block');
 // Joining another group by invitation is available from the same entry point.
 await page.evaluate(()=>switchGroup());await page.locator('#groupSelectionSection button').filter({hasText:'建立或加入'}).click();await page.locator('#obStepAction button').filter({hasText:'邀請碼'}).click();
 await page.fill('#obInviteCode','BADBAD');await page.evaluate(()=>processJoinGroup());assert.match(alerts.at(-1),/找不到/);
 await page.fill('#obInviteCode','groupb');await page.evaluate(()=>processJoinGroup());
 await page.waitForFunction(()=>currentGroup?.id==='B'&&sessionStorage.getItem('nexus_active_group_id')==='B');assert.deepEqual(docs['groups/B'].members,['bob','alice']);
 await page.evaluate(()=>switchGroup());assert.equal(await page.locator('#groupListContainer .group-card').count(),3);
 await page.locator('#groupListContainer .group-card').filter({hasText:'原有群組'}).click();await page.waitForFunction(()=>currentGroup?.id==='A');
 // Read/create failures retain the current context and allow retry/cancel.
 failList=true;await page.evaluate(()=>switchGroup());assert.match(alerts.at(-1),/無法載入群組/);assert.equal(await page.evaluate(()=>currentGroup.id),'A');failList=false;
 await page.evaluate(()=>switchGroup());await page.locator('#groupSelectionSection button').filter({hasText:'建立或加入'}).click();await page.locator('#obStepAction button').filter({hasText:'建立全新'}).click();await page.fill('#obGroupName','失敗重試');
 failCreate=true;await page.evaluate(()=>processCreateGroup());assert.match(alerts.at(-1),/建立失敗/);assert.equal(await page.evaluate(()=>localStorage.getItem('lastGroupId')),'A');failCreate=false;
 await page.evaluate(()=>processCreateGroup());await page.waitForFunction(()=>currentGroup?.id==='created-2');
 assert.ok(queries.filter(q=>q.path==='groups'&&q.filters?.some(f=>f.op==='array-contains')).every(q=>q.filters.find(f=>f.op==='array-contains').value==='alice'));
 assert.deepEqual(errors,[]);
 console.log('PASS: one/multiple group switching, existing navigation entry, create/join/cancel, accountId membership, persisted group context, duplicate submission guard, error retry, literal group names');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
