// Isolated real-page regression: all Firebase/CDN IO is intercepted, no production data.
// BASELINE=1 captures pre-fix behavior; normal mode asserts the optimized contract.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8012';
const baseline=process.env.BASELINE==='1';
const baselineRef=process.env.BASELINE_REF||'8990aed';
const lifecycleOnly=process.env.LIFECYCLE_ONLY==='1';
const mock=`
export const initializeApp=()=>({}),getFirestore=()=>({});
export const doc=(_, ...p)=>({path:p.join('/'),id:p.at(-1),kind:'doc'});
export const collection=(_, ...p)=>({path:p.join('/'),kind:'query'});
export const where=(field,op,value)=>({field,op,value}),orderBy=()=>({}),limit=()=>({});
export const query=(ref,...filters)=>({...ref,filters});
export const serverTimestamp=()=>Date.now();
const snap=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data)});
export async function getDoc(ref){return snap(ref.path,await window.__db({...ref,kind:'get',source:ref.subscription?'snapshot':'getDoc'}));}
export async function getDocs(ref){const rows=await window.__db({...ref,kind:'query',source:ref.subscription?'snapshot':'getDocs'});const docs=rows.map(r=>snap(r.path,r.data));return{docs,empty:!docs.length,size:docs.length,forEach:cb=>docs.forEach(cb)};}
const listeners=new Set();
export function onSnapshot(ref,cb,error){const key=ref.path;window.__subs[key]=(window.__subs[key]||0)+1;let active=true;const emit=()=> (ref.kind==='doc'?getDoc({...ref,subscription:true}):getDocs({...ref,subscription:true})).then(s=>{if(active)cb(s);},e=>{if(active)error?.(e);});listeners.add(emit);emit();return()=>{if(active){active=false;listeners.delete(emit);window.__subs[key]--;}};}
export const getCountFromServer=async ref=>{const rows=await window.__db({...ref,kind:'count',source:'getCountFromServer'});return{data:()=>({count:rows.length})};};
export const updateDoc=async(ref,data)=>{await window.__db({...ref,kind:'update',data});await Promise.all([...listeners].map(emit=>emit()));};
export const addDoc=async(ref,data)=>{await window.__db({...ref,kind:'update',data});return{id:'added'};};
export const deleteDoc=async()=>{},runTransaction=()=>{};
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 const month=new Date().toISOString().slice(0,7), rows={
 'users/alice-doc':{accountId:'alice',name:'Alice',avatar:'Nexus.png',role:'parent',menus:['photodump','finance','calendar','todo','chat']},
 'users/bob-doc':{accountId:'bob',name:'Bob',avatar:'Nexus.png'},
 'users/outsider':{accountId:'outsider',name:'Outsider',avatar:'bad.png'},
 'groups/A':{name:'Group A',members:['alice','bob']},
 'groups/B':{name:'Group B',members:['alice']},
 'userSettings/alice':{accountId:'alice',modules:{finance:true,todo:true},order:['finance','todo']},
 'photos/p':{groupId:'A',uploader:'Alice',imageUrls:['Nexus.png'],likes:[]},
 'photos/p2':{groupId:'A',uploader:'Bob',imageUrls:['Nexus.png'],likes:[]},
 'photos/p3':{groupId:'A',uploader:'Alice',imageUrls:['Nexus.png'],likes:[]},
 'expenses/e':{groupId:'A',date:month+'-01',accountId:'alice',operator:'Alice',amount:125,type:'expense',category:'早餐'},
 'expenses/other':{groupId:'B',date:month+'-01',accountId:'outsider',amount:999,type:'expense'},
 'customCategories/c':{groupId:'A',name:'測試分類',type:'expense',color:'#123456',icon:'🍎'},
 };
 for(let i=0;i<100;i++)rows['users/unrelated-'+i]={accountId:'other-'+i,name:'Other '+i};
 const operations=[];let delay=60,slowMonth=null,failPath=null,slowProfiles=false,slowCategories=false;
 await ctx.exposeFunction('__db',async op=>{
  const record={...op,start:performance.now()};operations.push(record);
  await new Promise(r=>setTimeout(r,slowCategories&&op.path==='customCategories'?500:slowProfiles&&op.path==='users'&&op.filters?.some(f=>f.op==='in')?600:op.filters?.some(f=>f.field==='date'&&String(f.value).startsWith(slowMonth||'!'))?250:delay));
  record.end=performance.now();
  if(op.path===failPath)throw Error('permission-denied (test)');
  if(op.kind==='get')return rows[op.path];
  if(op.kind==='update'){rows[op.path]={...rows[op.path],...op.data};return;}
  let result=Object.entries(rows).filter(([p])=>p.startsWith(op.path+'/')&&p.split('/').length===op.path.split('/').length+1).map(([path,data])=>({path,data}));
  for(const f of op.filters||[])if(f.field)result=result.filter(({data:d})=>f.op==='in'?f.value.includes(d[f.field]):f.op==='array-contains'?d[f.field]?.includes(f.value):f.op==='>='?d[f.field]>=f.value:f.op==='<='?d[f.field]<=f.value:d[f.field]===f.value);
  record.returnedDocuments=result.length;return result;
 });
 await ctx.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 await ctx.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await ctx.route('https://ui-avatars.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}));
 await ctx.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:'window.Chart=class {constructor(ctx,config){window.__chart=config;}destroy(){}};'}));
 if(baseline)await ctx.route(/\/js\/(main|dashboard|expense|auth)\.js$/,r=>{const path=new URL(r.request().url()).pathname.slice(1);r.fulfill({contentType:'text/javascript',body:execFileSync('git',['show',`${baselineRef}:${path}`],{encoding:'utf8'})});});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(user=>{
  sessionStorage.setItem('familyCheckInUser',JSON.stringify(user));sessionStorage.setItem('nexus_active_group_id','A');localStorage.setItem('lastGroupId','A');window.__subs={};
  window.__owned=new Set();window.__intervals=new Set();
  const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener=function(type,fn,opt){if((this===window||this===document)&&['focus','visibilitychange'].includes(type)&&new Error().stack.includes('/js/dashboard.js'))window.__owned.add({target:this,type,fn});return add.call(this,type,fn,opt);};
  EventTarget.prototype.removeEventListener=function(type,fn,opt){for(const item of window.__owned)if(item.target===this&&item.type===type&&item.fn===fn)window.__owned.delete(item);return remove.call(this,type,fn,opt);};
  const si=window.setInterval,ci=window.clearInterval;
  window.setInterval=(...args)=>{const id=si(...args);if(new Error().stack.includes('/js/dashboard.js'))window.__intervals.add(id);return id;};
  window.clearInterval=id=>{window.__intervals.delete(id);return ci(id);};
 },rows['users/alice-doc']);
 let start=performance.now();await page.goto(base+'/index.html');
 await page.waitForFunction(()=>document.getElementById('loadingView').style.display==='none'&&document.getElementById('dashboardView').style.display==='block');
 const homeReadyMs=performance.now()-start;
 await page.waitForFunction(()=>document.querySelector('.carousel-item')&&window.groupMembers.length===2&&document.getElementById('financeWidgetValue')?.textContent.includes('125'));
 const homeContentReadyMs=performance.now()-start;
 const initialQueries=operations.splice(0);
 const readings=[];
 for(let i=0;i<20;i++){
  await page.evaluate(async()=>{await Promise.all([showDashboard(),showDashboard()]);});
  await page.waitForTimeout(150);
  const active=await page.evaluate(()=>({photos:__subs.photos,intervals:__intervals.size,dom:__owned.size}));
  await page.evaluate(()=>stopDashboardListeners());
  const stopped=await page.evaluate(()=>({subscriptions:{...__subs},intervals:__intervals.size,dom:__owned.size}));
  readings.push({active,stopped});
  if(!baseline){assert.equal(active.photos,1);assert.equal(active.intervals,1);assert.equal(active.dom,2);assert.ok(Object.values(stopped.subscriptions).every(n=>n===0));assert.equal(stopped.intervals,0);assert.equal(stopped.dom,0);}
 }
 // Concurrent starts, cancellation while settings are still pending, and group changes.
 if(!baseline){
  await page.evaluate(async()=>{const a=showDashboard();stopDashboardListeners();await a;});
  assert.ok(Object.values(await page.evaluate(()=>__subs)).every(n=>n===0));
  await page.evaluate(async()=>{const a=showDashboard();currentGroup={id:'B',members:['alice']};await showDashboard();await a;});
  await page.waitForTimeout(180);
  assert.deepEqual(await page.evaluate(()=>groupMembers.map(u=>u.accountId)),['alice']);
  await page.evaluate(()=>stopDashboardListeners());
  await page.evaluate(()=>{currentGroup={id:'A',members:['alice','bob']};});
  await page.evaluate(()=>showDashboard());await page.waitForSelector('.carousel-item');
  const carousel=page.locator('#photoCarouselContainer');
  const rect=await carousel.boundingBox();
  const cdp=await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width-25,y:rect.y+80}]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x+rect.width-25-i*30,y:rect.y+80}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.getElementById('photoCarouselContainer').scrollLeft>0);
  await carousel.evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));
  await page.locator('.like-btn').first().click();await page.waitForTimeout(150);assert.deepEqual(rows['photos/p'].likes,['Alice']);await page.waitForSelector('.like-btn.liked');
  await page.locator('.like-btn').first().click();await page.waitForFunction(()=>!document.querySelector('.like-btn').classList.contains('liked'));
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.ok(Object.values(await page.evaluate(()=>__subs)).every(n=>n===0));
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await page.waitForFunction(()=>__subs.photos===1);
  await page.evaluate(()=>stopDashboardListeners());
  slowProfiles=true;
  await page.evaluate(()=>showDashboard());
  assert.equal(await page.evaluate(()=>groupMembers.length),0);
  assert.equal(await page.evaluate(()=>__subs.photos),1);
  await page.waitForFunction(()=>groupMembers.length===2);slowProfiles=false;
  const beforeCount=operations.filter(op=>op.source==='getCountFromServer').length;
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(90);
  assert.equal(operations.filter(op=>op.source==='getCountFromServer').length-beforeCount,1);
  await page.evaluate(()=>stopDashboardListeners());
  await ctx.route('**/gallery.html',r=>r.fulfill({contentType:'text/html',body:'<p>gallery navigation target</p>'}));
  await page.locator('.carousel-img').first().click();await page.waitForURL('**/gallery.html');
  assert.equal(await page.evaluate(()=>localStorage.getItem('target_photo_id')),'p');
 }
 operations.length=0;start=performance.now();await page.goto(base+'/expense.html');
 await page.waitForFunction(()=>document.getElementById('monthTotalExpense').textContent==='$125');
 const expenseReadyMs=performance.now()-start;
 await page.waitForTimeout(250);const expenseQueries=operations.splice(0);
 if(!baseline&&!lifecycleOnly){
  assert.ok(expenseQueries.filter(o=>o.path==='users').every(o=>o.filters?.length));
  await page.evaluate(()=>{switchScope('personal');openModal('expenseModal',new Date().toISOString().slice(0,7)+'-01');});
  assert.match(await page.locator('#dayExpenseList').innerText(),/125/);
  assert.ok(await page.locator('#avatarContainer img').count());
  assert.ok(await page.locator('#categoryGrid').innerText().then(t=>t.includes('測試分類')));
  slowMonth=month;
  await page.evaluate(()=>{changeMonth(-1);changeMonth(1);changeMonth(1);});
  await page.waitForTimeout(450);
  const next=new Date();next.setMonth(next.getMonth()+1);
  assert.equal(await page.locator('#calendarMonthTitle').innerText(),`${next.getFullYear()}年 ${next.getMonth()+1}月`);
  assert.equal(await page.locator('#monthTotalExpense').innerText(),'$0');
  failPath='expenses';
  await page.evaluate(()=>changeMonth(1));await page.waitForTimeout(200);
  assert.equal(await page.locator('#monthTotalExpense').innerText(),'讀取中...');
  assert.match(await page.locator('#calendarMonthTitle').innerText(),/讀取失敗/);
  failPath=null;
  await page.evaluate(()=>changeMonth(-2));await page.waitForFunction(()=>document.getElementById('monthTotalExpense').textContent==='$125');
  // Existing save/delete paths and income permission controls are unchanged.
  await page.evaluate(()=>openModal('expenseModal',new Date().toISOString().slice(0,7)+'-01'));
  await page.locator('#expenseAmount').fill('75');await page.locator('#btnSaveExpense').click();
  await page.waitForFunction(()=>document.getElementById('monthTotalExpense').textContent==='$200');
  await page.evaluate(()=>deleteExpense('added'));
  await page.waitForFunction(()=>document.getElementById('monthTotalExpense').textContent==='$125');
 }
 if(!baseline&&!lifecycleOnly){
  // Slow category definitions must not produce a falsely complete pie chart.
  rows['expenses/e'].category='測試分類';slowCategories=true;
  await page.goto(base+'/expense.html');
  await page.waitForFunction(()=>document.querySelectorAll('.day-cell').length>0);
  assert.equal(await page.locator('#monthTotalExpense').innerText(),'讀取中...');
  assert.equal(await page.evaluate(()=>window.__chart),undefined);
  await page.waitForFunction(()=>document.getElementById('monthTotalExpense').textContent==='$125');
  assert.ok(await page.evaluate(()=>window.__chart.data.labels.includes('測試分類')));
  slowCategories=false;
 }
 assert.deepEqual(errors,[]);
 const report={mode:baseline?'baseline':'optimized',delayPerSdkOperationMs:delay,homeReadyMs,homeContentReadyMs,expenseReadyMs,initialQueries,expenseQueries,cycles:readings,errors};
 const output=process.env.PERF_OUTPUT||`/tmp/nexus-performance-${report.mode}.json`;fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({mode:report.mode,homeReadyMs,homeContentReadyMs,expenseReadyMs,homeOperations:initialQueries.length,expenseOperations:expenseQueries.length,first:readings[0],last:readings.at(-1),output}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
