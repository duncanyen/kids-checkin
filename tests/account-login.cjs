// AUTH_BASE_URL=http://127.0.0.1:8012 node tests/account-login.cjs
// Real auth forms and handlers; all Firebase requests use a shared in-memory store.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.AUTH_BASE_URL||'http://127.0.0.1:8012';
const docs={
 'users/legacy-duncan':{accountId:'duncan',name:'鄧肯',password:'Secret123',pin:'1234',role:'member'},
 'users/legacy-tina':{accountId:'TiNa',name:'婷婷',password:'Other123',role:'member'},
 'groups/A':{name:'原群組',members:['duncan']},
 'groups/B':{name:'另一群組',members:['TiNa']},
};
let failRead=false,failCommit=false,unlock,queue=Promise.resolve(),commits=0;
let barrier=false,scans=[];
const mock=`
export const collection=(_, ...parts)=>({path:parts.join('/')});
export const doc=(_, ...parts)=>({path:parts.join('/'),id:parts.at(-1)});
export const query=(ref,...filters)=>({...ref,filters});
export const where=(field,op,value)=>({field,op,value});
export const serverTimestamp=()=>Date.now();
const snap=(path,data)=>({id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>structuredClone(data)});
export const getDocs=async ref=>{const rows=await window.__db({kind:'query',...ref});const docs=rows.map(r=>snap(r.path,r.data));return{docs,empty:!docs.length,forEach:cb=>docs.forEach(cb)};};
export const addDoc=()=>{throw Error('Unexpected nontransactional write');};
export async function runTransaction(_,callback){
 await window.__db({kind:'begin'});
 try{const writes=[];const result=await callback({get:async ref=>snap(ref.path,await window.__db({kind:'get',...ref})),set:(ref,data)=>writes.push({path:ref.path,data})});await window.__db({kind:'commit',writes});return result;}
 finally{await window.__db({kind:'release'});}
}
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const context=await browser.newContext();
 await context.exposeFunction('__db',async op=>{
  if(op.kind==='query'){
   if(failRead)throw Error('offline');
   let rows=Object.entries(docs).filter(([p])=>p.startsWith(op.path+'/')&&p.split('/').length===op.path.split('/').length+1).map(([path,data])=>({path,data:structuredClone(data)}));
   for(const f of op.filters||[])rows=rows.filter(r=>f.op==='array-contains'?r.data[f.field]?.includes(f.value):r.data[f.field]===f.value);
   if(barrier&&op.path==='users'&&!op.filters){await new Promise(resolve=>{scans.push(resolve);if(scans.length===2){barrier=false;for(const done of scans)done();}});}
   return rows;
  }
  if(op.kind==='begin'){const before=queue;queue=new Promise(resolve=>{const next=resolve;before.then(()=>{unlock=next;});});await before;return;}
  if(op.kind==='get')return structuredClone(docs[op.path]);
  if(op.kind==='commit'){if(failCommit)throw Error('offline');for(const w of op.writes)docs[w.path]=structuredClone(w.data);commits++;return;}
  if(op.kind==='release'){unlock();return;}
 });
 await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
 await context.route('**/js/main.js',r=>r.fulfill({contentType:'text/javascript',body:`import './auth.js';window.showActionSection=()=>{window.__action=true;};window.enterGroup=group=>{window.__group=group;};window.showGroupSelectionList=groups=>{window.__groups=groups;};window.showAuthSection();`}));
 const errors=[],alerts=[];
 async function page(){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',async d=>{alerts.push(d.message());await d.accept();});await p.goto(base+'/index.html');await p.waitForFunction(()=>typeof processLogin==='function');return p;}
 const p=await page();
 async function login(id,password='Secret123'){
  await p.evaluate(()=>{toggleAuth('login');sessionStorage.removeItem('familyCheckInUser');window.__group=null;window.__action=false;});
  await p.fill('#loginId',id);await p.fill('#loginPassword',password);await p.evaluate(()=>processLogin());
  return p.evaluate(()=>({user:JSON.parse(sessionStorage.getItem('familyCheckInUser')),group:window.__group}));
 }
 for(const input of ['duncan','DUNCAN','DuNcAn',' DUNCAN ']){const result=await login(input);assert.equal(result.user.accountId,'duncan');assert.equal(result.user.docId,'legacy-duncan');assert.equal(result.group.id,'A');}
 for(const input of ['TINA','tina','TiNa']){const result=await login(input,'Other123');assert.equal(result.user.accountId,'TiNa');assert.equal(result.group.id,'B');}
 assert.equal((await login('DUNCAN','secret123')).user,null);assert.match(alerts.at(-1),/密碼錯誤/);
 assert.equal((await login('DUNCAN','1234')).user.accountId,'duncan');
 assert.equal((await login('鄧肯')).user.accountId,'duncan'); // Existing nickname entry still works.
 assert.equal((await login('missing')).user,null);assert.match(alerts.at(-1),/找不到/);
 await p.check('#rememberMe');await login('DUNCAN');assert.equal(await p.evaluate(()=>localStorage.getItem('savedLoginId')),'DUNCAN');
 await p.reload();await p.waitForFunction(()=>typeof processLogin==='function');assert.equal(await p.inputValue('#loginId'),'DUNCAN');
 // A case collision in old data must never select an arbitrary person's profile.
 docs['users/legacy-collision']={accountId:'Duncan',name:'不同人',password:'Secret123'};
 assert.equal((await login('duncan')).user,null);assert.match(alerts.at(-1),/大小寫重複/);delete docs['users/legacy-collision'];
 async function register(page,id,name){
  await page.evaluate(()=>{sessionStorage.removeItem('familyCheckInUser');toggleAuth('register');});
  await page.fill('#regId',id);await page.fill('#regEmail','test@example.com');await page.fill('#regName',name);await page.fill('#regPassword','NewPass123');await page.fill('#regConfirmPassword','NewPass123');
  await page.evaluate(()=>processRegistration());
 }
 const before=Object.keys(docs).length;
 await register(p,'DUNCAN','不能重複');assert.equal(Object.keys(docs).length,before);assert.match(alerts.at(-1),/不分大小寫/);
 await register(p,'tInA','不能重複二');assert.equal(Object.keys(docs).length,before);
 await register(p,'bad/id','非法帳號');assert.equal(Object.keys(docs).length,before);assert.match(alerts.at(-1),/英文、數字與底線/);
 await register(p,'NeW_User','新使用者');assert.equal(docs['users/account_new_user'].accountId,'new_user');
 assert.equal(await p.evaluate(()=>JSON.parse(sessionStorage.getItem('familyCheckInUser')).accountId),'new_user');
 assert.equal((await login('NEW_USER','NewPass123')).user.accountId,'new_user');
 await register(p,'new_USER','再次註冊');assert.match(alerts.at(-1),/不分大小寫/);
 // Both requests see no existing user before entering the transaction.
 const second=await page();barrier=true;scans=[];const count=commits;
 await Promise.all([register(p,'Race_User','競爭一'),register(second,'RACE_USER','競爭二')]);
 assert.equal(commits,count+1);assert.equal(Object.values(docs).filter(d=>d.accountId==='race_user').length,1);assert.match(alerts.at(-1),/不分大小寫/);
 failRead=true;assert.equal((await login('DUNCAN')).user,null);assert.match(alerts.at(-1),/登入失敗/);failRead=false;
 failCommit=true;await register(p,'Retry_User','可重試');assert.equal(docs['users/account_retry_user'],undefined);assert.equal(await p.evaluate(()=>sessionStorage.getItem('familyCheckInUser')),null);failCommit=false;
 await register(p,'RETRY_USER','可重試');assert.equal(docs['users/account_retry_user'].accountId,'retry_user');
 assert.equal(docs['users/legacy-tina'].accountId,'TiNa');assert.deepEqual(docs['groups/B'].members,['TiNa']);
 assert.deepEqual(errors,[]);
 console.log('PASS: case-insensitive legacy/new account login, original ID/group preserved, password case unchanged, PIN/nickname/remembered login, global duplicate and concurrent registration protection, invalid IDs, collision handling, offline failure/retry');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
