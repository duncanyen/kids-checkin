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
const writes=[],queries=[];let counter=0,failUsers=false;
const mock=`
export const doc=(_, ...parts)=>({path:parts.join('/'),id:parts.at(-1),kind:'doc'});
export const collection=(_, ...parts)=>({path:parts.join('/'),kind:'query'});
export const where=(field,op,value)=>({field,op,value});export const query=(ref,...filters)=>({...ref,filters});
export const orderBy=()=>({});export const limit=()=>({});export const serverTimestamp=()=>Date.now();
export const increment=value=>({operation:'increment',value});export const arrayUnion=(...values)=>({operation:'union',values});export const arrayRemove=(...values)=>({operation:'remove',values});
const snapshot=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data)});
export const getDoc=async ref=>snapshot(ref.path,await window.__chatDb({...ref,kind:'get'}));
export const getDocs=async ref=>{const rows=await window.__chatDb({...ref,kind:'query'});const docs=rows.map(r=>snapshot(r.path,r.data));return{docs,empty:!docs.length,forEach:cb=>docs.forEach(cb)};};
const listeners=new Set();async function emit(l){const s=l.ref.kind==='doc'?await getDoc(l.ref):await getDocs(l.ref);if(listeners.has(l))l.cb(s);}
export const onSnapshot=(ref,cb,error)=>{const l={ref,cb};listeners.add(l);emit(l).catch(e=>error?.(e));return()=>listeners.delete(l);};
async function notify(){for(const l of [...listeners])await emit(l);}
export const addDoc=async(ref,data)=>{const id=await window.__chatDb({...ref,kind:'add',data});await notify();return{id};};
export const updateDoc=async(ref,data)=>{await window.__chatDb({...ref,kind:'update',data});await notify();};
let queue=Promise.resolve();
export function runTransaction(_,callback){const run=queue.then(async()=>{const writes=[];const result=await callback({get:getDoc,update:(ref,data)=>writes.push({ref,data})});for(const {ref,data} of writes)await window.__chatDb({...ref,kind:'update',data});await notify();return result;});queue=run.catch(()=>{});return run;}
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.exposeFunction('__chatDb',op=>{
  if(op.kind==='get')return docs[op.path];
  if(op.kind==='query'){
   queries.push(op);if(op.path==='users'&&failUsers)throw Error('offline');
   let rows=Object.entries(docs).filter(([p])=>p.startsWith(op.path+'/')&&p.split('/').length===op.path.split('/').length+1).map(([path,data])=>({path,data}));
   for(const f of op.filters||[])if(f.field)rows=rows.filter(r=>f.op==='in'?f.value.includes(r.data[f.field]):f.op==='array-contains'?r.data[f.field]?.includes(f.value):r.data[f.field]===f.value);
   return rows;
  }
  if(op.kind==='add'){const id='new-'+(++counter);docs[op.path+'/'+id]=op.data;writes.push({...op,id});return id;}
  if(op.kind==='update'){
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
 async function openCreate(){await page.click('#btnOpenCreateModal');await page.waitForFunction(()=>!document.getElementById('btnConfirmCreate').disabled);}
 const rooms=()=>Object.entries(docs).filter(([p])=>p.startsWith('rooms/'));
 await page.goto(base+'/chat.html');await openCreate();
 assert.deepEqual(await page.locator('#createMemberList input').evaluateAll(inputs=>inputs.map(i=>i.value)),['bob','charlie','same']);
 assert.ok((await page.locator('#createMemberList').innerText()).includes("小華's"));
 assert.equal(await page.locator('#createMemberList input[value="alice"]').count(),0);
 await page.check('#createMemberList input[value="bob"]');await page.fill('#createGroupName','測試聊天');await page.click('#btnConfirmCreate');await page.waitForFunction(()=>document.getElementById('createGroupModal').style.display==='none');
 const [path,room]=rooms()[0];assert.equal(room.groupId,'A');assert.deepEqual(room.participantIds,['alice','bob']);assert.equal(room.creatorAccountId,'alice');
 // Existing rooms and the invitation menu retain their original participant format.
 await page.locator('#roomListContainer .room-item').first().click();
 // Exercise the real FileReader -> Image -> canvas upload callbacks.
 await page.setInputFiles('#chatPhotoInput',{name:'chat-photo.png',mimeType:'image/png',buffer:require('node:fs').readFileSync(require('node:path').join(__dirname,'../Nexus.png'))});
 await page.waitForFunction(()=>!document.getElementById('btnSend').disabled&&!document.getElementById('btnTriggerPhoto').disabled&&document.getElementById('chatPhotoInput').value==='');
 const photo=Object.values(docs).find(value=>value.imageUrl);
 assert.ok(photo,'selecting a valid image must create a message');
 assert.equal(photo.roomId,path.split('/')[1]);assert.equal(photo.groupId,'A');assert.equal(photo.senderAccountId,'alice');
 assert.ok(photo.imageUrl.startsWith('data:image/jpeg;base64,'));
 const dimensions=await page.evaluate(url=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({width:image.width,height:image.height});image.src=url;}),photo.imageUrl);
 assert.equal(Math.max(dimensions.width,dimensions.height),800);
 await page.click('#btnOpenSettingsMenu');
 await page.evaluate(()=>chatRooms.openInviteMembers());await page.waitForFunction(()=>!document.getElementById('btnSaveInvite').disabled);
 assert.deepEqual(await page.locator('#inviteMemberList input').evaluateAll(inputs=>inputs.map(i=>i.value)),['charlie','same']);
 await page.check('#inviteMemberList input[value="charlie"]');await page.click('#btnSaveInvite');await page.waitForFunction(()=>document.getElementById('inviteMembersModal').style.display==='none');
 assert.deepEqual(docs[path].participantIds,['alice','bob','charlie']);
 assert.ok(Object.entries(docs).some(([p,d])=>p.startsWith('messages/')&&d.groupId==='A'&&d.text==='群組成員 加入聊天室'));
 await page.evaluate(()=>chatRooms.closeModal('roomSettingsMenu'));await page.click('#btnBackToList');
 // Membership is checked again at submission; removals and forged selections cannot save.
 await openCreate();await page.fill('#createGroupName','已離開成員');await page.check('#createMemberList input[value="charlie"]');
 docs['groups/A'].members=docs['groups/A'].members.filter(id=>id!=='charlie');const count=rooms().length;
 await page.click('#btnConfirmCreate');await page.waitForFunction(()=>!document.getElementById('btnConfirmCreate').disabled);assert.equal(rooms().length,count);assert.match(alerts.at(-1),/已離開/);
 await page.evaluate(()=>chatRooms.closeModal('createGroupModal'));await openCreate();
 assert.equal(await page.locator('#createMemberList input[value="charlie"]').count(),0);
 await page.evaluate(()=>{const input=document.createElement('input');input.type='checkbox';input.value='outsider';input.checked=true;document.getElementById('createMemberList').append(input);});await page.fill('#createGroupName','外群拒絕');
 await page.click('#btnConfirmCreate');await page.waitForFunction(()=>!document.getElementById('btnConfirmCreate').disabled);assert.equal(rooms().length,count);
 // Switching groups in storage cannot submit a stale group-A dialog.
 await page.evaluate(()=>localStorage.setItem('lastGroupId','B'));await page.click('#btnConfirmCreate');await page.waitForFunction(()=>!document.getElementById('btnConfirmCreate').disabled);assert.equal(rooms().length,count);assert.match(alerts.at(-1),/已切換/);
 await page.reload();await openCreate();assert.deepEqual(await page.locator('#createMemberList input').evaluateAll(inputs=>inputs.map(i=>i.value)),['outsider']);
 // Query failures do not expose stale/global cached users or permit creation.
 await page.evaluate(()=>chatRooms.closeModal('createGroupModal'));failUsers=true;await page.click('#btnOpenCreateModal');await page.waitForFunction(()=>document.getElementById('createMemberList').textContent.includes('無法載入'));
 assert.equal(await page.locator('#createMemberList input').count(),0);assert.equal(await page.locator('#btnConfirmCreate').isDisabled(),true);failUsers=false;
 docs['groups/B'].members=['alice'];await page.evaluate(()=>chatRooms.closeModal('createGroupModal'));await openCreate();assert.match(await page.locator('#createMemberList').innerText(),/無其他成員/);
 docs['groups/B'].members=[];await page.evaluate(()=>chatRooms.closeModal('createGroupModal'));await page.click('#btnOpenCreateModal');await page.waitForFunction(()=>document.getElementById('createMemberList').textContent.includes('已不在此群組'));
 assert.equal(await page.locator('#btnConfirmCreate').isDisabled(),true);
 // Fixed room/message IDs survive changing both the owner and another member's names.
 await page.evaluate(()=>localStorage.setItem('lastGroupId','A'));await page.reload();
 await page.locator('[data-room-id="'+path.split('/')[1]+'"]').click();
 await page.fill('#chatInput','改名前的訊息');await page.click('#btnSend');
 await page.waitForFunction(()=>!document.getElementById('btnSend').disabled);
 const ownMessage=Object.entries(docs).find(([key,value])=>key.startsWith('messages/')&&value.text==='改名前的訊息');
 assert.equal(ownMessage[1].senderAccountId,'alice');
 docs['users/a'].name='改名小明';docs['users/b'].name='改名小華';
 docs['messages/bob-name-collision']={groupId:'A',roomId:path.split('/')[1],sender:'小明',senderAccountId:'bob',text:'另一個帳號的訊息',timestamp:Date.now()};
 await page.reload();await page.locator('[data-room-id="'+path.split('/')[1]+'"]').click();
 await page.waitForSelector('.msg-mine');assert.ok((await page.locator('.msg-mine').allTextContents()).some(text=>text.includes('改名前的訊息')));
 const otherMessage=page.locator('.msg-other').filter({hasText:'另一個帳號的訊息'});assert.equal(await otherMessage.count(),1);
 await otherMessage.click();assert.equal(await page.locator('#btnActionRetract').isVisible(),false);await page.click('#btnActionReply');
 await page.fill('#chatInput','改名後的回覆');await page.click('#btnSend');await page.waitForFunction(()=>!document.getElementById('btnSend').disabled);
 const reply=Object.values(docs).find(value=>value.text==='改名後的回覆');
 assert.equal(reply.senderAccountId,'alice');assert.equal(reply.sender,'改名小明');assert.equal(reply.replyTo.senderAccountId,'bob');
 assert.ok(docs[path].readByAccount.alice>0);assert.ok(docs[path].unreadByAccount.bob>0);assert.equal(docs[path].creatorAccountId,'alice');
 await page.evaluate(()=>chatRooms.openViewMembers());assert.ok((await page.locator('#viewMemberList').innerText()).includes('改名小華'));
 assert.ok(await page.locator('#viewMemberList .btn-kick-member').count()>0,'renamed creator keeps management rights');
 await page.evaluate(()=>chatRooms.kickMember('bob'));assert.equal(docs[path].participantIds.includes('bob'),false);
 await page.evaluate(()=>chatRooms.closeModal('viewMembersModal'));await page.click('#btnBackToList');
 // Already-renamed legacy members cannot be guessed; an actual admin confirms IDs.
 docs['users/a'].role='parent';
 docs['rooms/legacy']={groupId:'A',name:'改名前的舊聊天室',participants:['舊小明','離開的成員'],creator:'舊小明',unreadCount:{舊小明:7},readTimestamps:{舊小明:123}};
 docs['messages/legacy-own']={groupId:'A',roomId:'legacy',sender:'舊小明',text:'舊資料訊息',timestamp:Date.now()};
 await page.reload();await page.locator('#btnRepairChatMembers').click();
 await page.getByLabel('舊名稱「舊小明」對應帳號').selectOption('alice');
 await page.getByLabel('舊名稱「離開的成員」對應帳號').selectOption('__removed__');
 await page.locator('.chat-repair-room[data-room-id="legacy"]').getByRole('button',{name:'確認成員帳號'}).click();
 await page.waitForFunction(()=>document.querySelector('.chat-repair-room[data-room-id=legacy] [role=status]')?.textContent.includes('已改用'));
 assert.deepEqual(docs['rooms/legacy'].participantIds,['alice']);assert.equal(docs['rooms/legacy'].creatorAccountId,'alice');assert.equal(docs['rooms/legacy'].unreadByAccount.alice,7);
 await page.click('#btnCloseChatRepair');await page.locator('.room-item[data-room-id="legacy"]').click();
 await page.waitForSelector('.msg-mine');assert.ok((await page.locator('.msg-mine').innerText()).includes('舊資料訊息'));
 const outsiderPage=await context.newPage();outsiderPage.on('pageerror',e=>errors.push(e.message));
 await outsiderPage.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'same',name:'舊小明'}));localStorage.setItem('lastGroupId','A');});
 await outsiderPage.goto(base+'/chat.html');await outsiderPage.waitForFunction(()=>document.querySelector('#roomListContainer .nexus-skeleton')===null);
 assert.equal(await outsiderPage.locator('.room-item[data-room-id="legacy"]').count(),0);
 const denied=await outsiderPage.evaluate(async()=>{const {mutateRoomIdentity}=await import('/js/chat-membership.js');try{await mutateRoomIdentity({groupId:'A',accountId:'same'},'legacy',{bindings:{'舊小明':'same'}});return false;}catch{return true;}});
 assert.equal(denied,true);assert.deepEqual(docs['rooms/legacy'].participantIds,['alice']);await outsiderPage.close();
 await page.evaluate(()=>chatRooms.leaveGroup());assert.deepEqual(docs['rooms/legacy'].participantIds,[]);
 assert.ok(Object.values(docs).some(value=>value.isSystem&&value.text==='改名小明 已退出聊天室'&&value.roomId==='legacy'));
 docs['rooms/known-legacy']={groupId:'A',name:'可辨識的舊聊天室',participants:['改名小明','改名小華'],creator:'改名小明',unreadCount:{改名小明:5,改名小華:2},readTimestamps:{改名小華:50}};
 docs['messages/known-own']={groupId:'A',roomId:'known-legacy',sender:'改名小明',text:'轉換前的訊息',timestamp:Date.now()};
 await page.reload();await page.locator('.room-item[data-room-id="known-legacy"]').click();
 await page.fill('#chatInput','觸發舊資料轉換');await page.click('#btnSend');await page.waitForFunction(()=>!document.getElementById('btnSend').disabled);
 assert.deepEqual(docs['rooms/known-legacy'].participantIds,['alice','bob']);assert.equal(docs['rooms/known-legacy'].readByAccount.bob,50);
 assert.equal(docs['rooms/known-legacy'].unreadByAccount.bob,3);
 docs['users/a'].name='再次改名';await page.reload();await page.locator('.room-item[data-room-id="known-legacy"]').click();
 await page.waitForSelector('.msg-mine');assert.ok((await page.locator('.msg-mine').allTextContents()).some(text=>text.includes('轉換前的訊息')));

 assert.ok(queries.filter(q=>q.path==='users').every(q=>q.filters?.some(f=>f.field==='accountId'&&f.op==='in')));
 assert.deepEqual(errors,[]);
 console.log('PASS: fixed room/creator/sender/reply/read/unread account IDs survive rename; homonyms do not inherit messages or access; explicit legacy admin repair preserves old messages/balances; group checks, invite, removed members and forged repair rejected');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
