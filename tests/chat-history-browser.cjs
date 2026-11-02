// CHAT_BASE_URL=http://127.0.0.1:8012 node tests/chat-members.cjs
// Real chat modules, in-memory Firebase only; no production reads or writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.CHAT_BASE_URL||'http://127.0.0.1:8012';
const docs={
 'groups/A':{members:['alice','bob','charlie','same','removed']},
 'groups/B':{members:['alice','outsider']},
 'users/a':{accountId:'alice',name:'小明',role:'child',groupId:'B'},
 'users/b':{accountId:'bob',name:"小華's",role:'child',groupId:'B'},
 'users/c':{accountId:'charlie',name:'群組成員',role:'child'},
 'users/s':{accountId:'same',name:'小明',role:'child'},
 'users/r':{accountId:'removed',name:'已停用成員',role:'removed'},
 'users/o':{accountId:'outsider',name:'別群成員',role:'child'},
};
const writes=[],queries=[];let failHistory=false,holdHistory=null,releaseHistory;let counter=0,failUsers=false,imageAttempts=0,failImageAt=Infinity,failPhotoSummary=false,uploadGate=null,signalUpload,releaseUpload;
const mock=`
export const doc=(_, ...parts)=>({path:parts.join('/'),id:parts.at(-1),kind:'doc'});
export const collection=(_, ...parts)=>({path:parts.join('/'),kind:'query'});
export const where=(field,op,value)=>({field,op,value});export const query=(ref,...filters)=>({...ref,filters});
export const orderBy=(field,direction)=>({sortField:field,direction});export const limit=n=>({take:n});export const startAfter=snap=>({after:snap.id,afterTime:snap.data().timestamp.toMillis()});export const serverTimestamp=()=>Date.now();
export const increment=value=>({operation:'increment',value});export const arrayUnion=(...values)=>({operation:'union',values});export const arrayRemove=(...values)=>({operation:'remove',values});
const snapshot=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>{const copy=structuredClone(data);if(copy)for(const key of ['timestamp','lastMessageTime'])if(typeof copy[key]==='number'){const ms=copy[key];copy[key]={toMillis:()=>ms,toDate:()=>new Date(ms)};}return copy;}});
export const getDoc=async ref=>snapshot(ref.path,await window.__chatDb({...ref,kind:'get'}));
export const getDocs=async ref=>{const rows=await window.__chatDb({...ref,kind:'query'});const docs=rows.map(r=>snapshot(r.path,r.data));return{docs,empty:!docs.length,forEach:cb=>docs.forEach(cb)};};
const listeners=new Set();async function emit(l){const s=l.ref.kind==='doc'?await getDoc(l.ref):await getDocs(l.ref);if(listeners.has(l))l.cb(s);}
export const onSnapshot=(ref,cb,error)=>{const l={ref,cb};listeners.add(l);emit(l).catch(e=>error?.(e));return()=>listeners.delete(l);};
window.__historyNotify=()=>notify();
async function notify(){for(const l of [...listeners])await emit(l);}
export const addDoc=async(ref,data)=>{const id=await window.__chatDb({...ref,kind:'add',data});await notify();return{id};};
export const updateDoc=async(ref,data)=>{await window.__chatDb({...ref,kind:'update',data});await notify();};
let queue=Promise.resolve();
export function runTransaction(_,callback){const run=queue.then(async()=>{const writes=[];const result=await callback({get:getDoc,update:(ref,data)=>writes.push({ref,data})});for(const {ref,data} of writes)await window.__chatDb({...ref,kind:'update',data});await notify();return result;});queue=run.catch(()=>{});return run;}
`;
const now=Date.now();
docs['rooms/history']={groupId:'A',name:'歷史測試',participantIds:['alice','bob'],creatorAccountId:'alice',lastMessageTime:now,unreadCounts:{alice:0}};
docs['rooms/other']={groupId:'A',name:'其他房間',participantIds:['alice'],lastMessageTime:now};
for(let i=0;i<95;i++){const id='msg-'+String(i).padStart(3,'0');docs['messages/'+id]={roomId:'history',groupId:'A',senderAccountId:'bob',sender:'小華',text:'歷史訊息 '+i,timestamp:i<65?now-(65-i)*86400000:now+(i-65)*1000};}
docs['messages/msg-029'].timestamp=docs['messages/msg-028'].timestamp;
docs['messages/foreign']={roomId:'other',groupId:'A',senderAccountId:'alice',text:'不能混入歷史房間',timestamp:now-100000};
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.exposeFunction('__chatDb',async op=>{
  if(op.kind==='get')return docs[op.path];
  if(op.kind==='query'){
   queries.push(op);if(op.path==='users'&&failUsers)throw Error('offline');
   let rows=Object.entries(docs).filter(([p])=>p.startsWith(op.path+'/')&&p.split('/').length===op.path.split('/').length+1).map(([path,data])=>({path,data}));
   for(const f of op.filters||[])if(f.field)rows=rows.filter(r=>f.op==='in'?f.value.includes(r.data[f.field]):f.op==='array-contains'?r.data[f.field]?.includes(f.value):r.data[f.field]===f.value);
   if(op.path==='messages') {
    if(failHistory && (op.filters||[]).some(f=>f.after)){failHistory=false;throw Error('offline history');}
    if(holdHistory && (op.filters||[]).some(f=>f.after)){const gate=holdHistory;holdHistory=null;await gate;}
    rows.sort((a,b)=>b.data.timestamp-a.data.timestamp||(a.path<b.path?1:-1));
    for(const f of op.filters||[]){if(f.after)rows=rows.filter(r=>r.data.timestamp<f.afterTime||(r.data.timestamp===f.afterTime&&r.path.split('/').at(-1)<f.after));if(f.take)rows=rows.slice(0,f.take);}
   }
   return rows;
  }
  if(op.kind==='add'){if(op.path==='messages'&&op.data.imageUrl){imageAttempts++;if(uploadGate){const gate=uploadGate;uploadGate=null;signalUpload();await gate;}if(imageAttempts===failImageAt)throw Error('photo offline');}const id='new-'+(++counter);docs[op.path+'/'+id]=op.data;writes.push({...op,id});return id;}
  if(op.kind==='update'){
   if(failPhotoSummary&&op.data.lastMessage?.includes('傳送了圖片')){failPhotoSummary=false;throw Error('summary offline');}
   for(const [field,value]of Object.entries(op.data)){
    const bits=field.split('.');let target=docs[op.path];for(const bit of bits.slice(0,-1))target=target[bit]??={};const key=bits.at(-1),old=target[key];
    target[key]=value?.operation==='union'?[...new Set([...(old||[]),...value.values])]:value?.operation==='remove'?(old||[]).filter(x=>!value.values.includes(x)):value?.operation==='increment'?(old||0)+value.value:value;
   }
   writes.push(op);return;
  }
 });
 await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 await context.route('https://ui-avatars.com/**',r=>r.abort());
 const page=await context.newPage(),errors=[],alerts=[];page.setDefaultTimeout(10000);
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{alerts.push(d.message());return d.accept();});
 await page.addInitScript(()=>{
  sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'小明',groupId:'B'}));
  if(!localStorage.getItem('lastGroupId'))localStorage.setItem('lastGroupId','A');
  sessionStorage.setItem('nexus_users_cache_v2',JSON.stringify({ts:Date.now(),users:[{name:'別群成員',groupId:'A'}]}));
 });
 await page.goto(base+'/chat.html');
 await page.locator('[data-room-id="history"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('.chat-msg-wrapper').length===30);
 assert.equal(await page.getByText('歷史訊息 0',{exact:true}).count(),0);
 await page.waitForTimeout(250); // Let the initial read-receipt snapshot settle.
 await page.evaluate(()=>document.getElementById('chatMessages').scrollTop=0);
 const anchorTop=(await page.getByText('歷史訊息 65',{exact:true}).boundingBox()).y;
 await page.click('#loadOlderMessages');
 await page.waitForFunction(()=>document.querySelectorAll('.chat-msg-wrapper').length===60);
 const restoredTop=(await page.getByText('歷史訊息 65',{exact:true}).boundingBox()).y;
 assert.ok(Math.abs(anchorTop-restoredTop)<3,`History scroll jumped: ${anchorTop} -> ${restoredTop}`);
 assert.equal(await page.getByText('歷史訊息 35',{exact:true}).count(),1);
 assert.equal(await page.getByText('歷史訊息 0',{exact:true}).count(),0);
 // Keep earlier messages when a live snapshot slides its latest-30 window.
 docs['messages/newest']={roomId:'history',groupId:'A',senderAccountId:'bob',text:'即時新訊息',timestamp:now+40000};
 await page.evaluate(()=>__historyNotify());
 await page.waitForFunction(()=>document.querySelectorAll('.chat-msg-wrapper').length===61);
 assert.equal(await page.getByText('歷史訊息 35',{exact:true}).count(),1);
 failHistory=true;
 await page.click('#loadOlderMessages');await page.getByRole('button',{name:'載入失敗，點此重試'}).waitFor();
 assert.equal(await page.locator('.chat-msg-wrapper').count(),61);
 await page.click('#loadOlderMessages');
 await page.waitForFunction(()=>document.querySelectorAll('.chat-msg-wrapper').length===91);
 await page.click('#loadOlderMessages');
 await page.getByRole('button',{name:'已載入全部記錄'}).waitFor();
 assert.equal(await page.locator('.chat-msg-wrapper').count(),96);
 assert.equal(await page.getByText('歷史訊息 0',{exact:true}).count(),1);
 assert.equal(await page.getByText('歷史訊息 28',{exact:true}).count(),1);
 assert.equal(await page.getByText('歷史訊息 29',{exact:true}).count(),1);
 assert.equal(await page.getByText('不能混入歷史房間',{exact:true}).count(),0);
 await page.screenshot({path:'/tmp/kids-chat-history.png'});
 // No stale history callback can insert data into a different room.
 await page.click('#btnBackToList');await page.locator('[data-room-id="history"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('.chat-msg-wrapper').length===30);
 holdHistory=new Promise(resolve=>releaseHistory=resolve);
 await page.click('#loadOlderMessages');await page.getByRole('button',{name:'載入中…'}).waitFor();
 await page.click('#btnBackToList');await page.locator('[data-room-id="other"]').click();
 releaseHistory();
 await page.getByText('不能混入歷史房間',{exact:true}).waitFor();
 await page.waitForTimeout(200);
 assert.equal(await page.getByText('歷史訊息 35',{exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS chat history: latest 30, paging back 65 days, stable equal-time cursors, live merge without losing history, retry, end marker, room isolation and late-result cancellation');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
