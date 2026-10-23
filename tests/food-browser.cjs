// FOOD_BASE_URL=http://127.0.0.1:8012 node tests/food-browser.cjs
// In-memory Firebase only: no production reads or writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FOOD_BASE_URL||'http://127.0.0.1:8012';
const mock=`
export const doc=(_, ...parts)=>({path:parts.join('/'),kind:'doc',id:parts.at(-1)});export const collection=(_, ...parts)=>({path:parts.join('/'),kind:'query'});
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
 try {
 const docs={
 'groups/A':{name:'A',members:['alice','bob']},'groups/B':{name:'B',members:['alice','outsider']},
 'users/a':{accountId:'alice',name:'小明',avatar:'',role:'child'},'users/b':{accountId:'bob',name:'小明',role:'child'},
 'food_restaurants/r1':{groupId:'A',name:"阿姨's 麵店",type:'中式',food:'麵',meal:'不限'},
 'food_restaurants/r2':{groupId:'A',name:'飯店',type:'中式',food:'飯',meal:['不限',null,42,'不限']},
 'food_restaurants/r3':{groupId:'B',name:'B限定',type:'中式',food:'飯',meal:['不限']},
 'food_restaurants/empty':{groupId:'A',name:'未填餐別'},
 'food_restaurants/null':{groupId:'A',name:'空餐別',meal:null},
 'food_restaurants/number':{groupId:'A',name:'異常數字',meal:42},
 'food_restaurants/object':{groupId:'A',name:'異常物件',meal:{dinner:true}},
 'food_restaurants/multi':{groupId:'A',name:'早午餐',meal:' 早餐、午餐 '},
 'system_menus/chat':{id:'chat',label:'聊天',order:1,isDefault:true},
 'userSettings/小明':{modules:{food:false}},
 };
 const versions=new Map(),writes=[];let fail=false,retries=0;
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Taipei'});
 await context.exposeFunction('__wishDb',operation=>{
  if(operation.kind==='get') return{data:docs[operation.path],version:versions.get(operation.path)||0};
  if(operation.kind==='query'){
   let rows=Object.entries(docs).filter(([p])=>p.startsWith(operation.path+'/')&&p.split('/').length===operation.path.split('/').length+1).map(([path,data])=>({path,data,version:versions.get(path)||0}));
   for(const f of operation.filters||[])rows=rows.filter(r=>f.op==='in'?f.value.includes(r.data[f.field]):r.data[f.field]===f.value);
   return rows;
  }
  if(operation.kind==='commit'){
   if(fail)throw Error('permission-denied');
   if(operation.expected.some(([p,v])=>(versions.get(p)||0)!==v)){retries++;throw Error('ABORTED');}
   for(const w of operation.pending){docs[w.path]=w.merge?{...docs[w.path],...w.data}:w.data;versions.set(w.path,(versions.get(w.path)||0)+1);writes.push(w);}
   return;
  }
 });
 const extra=`export const initializeApp=()=>({});export const getFirestore=()=>({});export const orderBy=()=>({});
 export const setDoc=async(ref,data,options={})=>{await window.__wishDb({kind:'commit',expected:[],pending:[{path:ref.path,data,merge:!!options.merge}]});};
 export const addDoc=async(ref,data)=>{const id=crypto.randomUUID();await setDoc(doc({},ref.path,id),data);return{id};};export const deleteDoc=()=>{};`;
 await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock+extra}));
 // Keep external styles and trackers from contacting the internet.
 await context.route('https://fonts.googleapis.com/**',r=>r.abort());
 const page=await context.newPage(),errors=[];
 page.setDefaultTimeout(10000);page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'小明',role:'admin',groupId:'B'}));if(!localStorage.getItem('lastGroupId'))localStorage.setItem('lastGroupId','A');});
 await page.goto(base+'/food-decision.html');await page.waitForFunction(()=>document.querySelector('#foodSyncStatus').textContent.includes('請選擇'));
 await page.evaluate(()=>foodApp.chooseMeal('晚餐','🍲'));await page.waitForFunction(()=>document.querySelector('#foodSyncStatus').textContent.includes('已同步'));
 const date=await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
 const key=`food_votes/A_${date}_晚餐`;
 assert.equal(await page.locator('#restaurantList .list-item').count(),7);
 assert.equal(await page.locator('#restaurantList').innerText().then(text=>text.includes('早餐, 午餐')),true);
 await page.evaluate(()=>foodApp.showWheel());
 assert.equal(await page.locator('#wheel').evaluate(el=>JSON.parse(el.dataset.candidates).length),2);

 await page.evaluate(()=>foodApp.showList());assert.equal(await page.locator('#voteList .restaurant').count(),2);
 await page.locator('#voteList .vote').first().click();await page.waitForFunction(()=>document.querySelector('#totalVotes').textContent==='1');
 assert.equal(docs[key].votes.alice.choice,"阿姨's 麵店");assert.equal(docs[key].votes.alice.accountId,'alice');
 await page.evaluate(()=>foodApp.castVote('r2'));assert.equal(docs[key].votes.alice.choice,'飯店');assert.equal(Object.keys(docs[key].votes).length,1);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#foodSyncStatus').textContent.includes('請選擇'));
 await page.evaluate(()=>foodApp.chooseMeal('晚餐','🍲'));await page.waitForFunction(()=>document.querySelector('#totalVotes').textContent==='1');
 await page.evaluate(()=>foodApp.finishDecision());assert.equal(docs[key].decision.choice,'飯店');
 await page.evaluate(()=>foodApp.switchStatsTab('早餐',document.querySelector('#statsTabs button')));await page.waitForFunction(()=>document.querySelector('#totalVotes').textContent==='0');
 await page.evaluate(()=>foodApp.castVote('r1'));assert.ok(docs[`food_votes/A_${date}_早餐`]);assert.equal(docs[key].votes.alice.choice,'飯店');
 // Date changes query a different persistent document and do not carry today's vote.
 await page.evaluate(()=>document.querySelectorAll('#calendarDays .calendar-day')[0].click());
 await page.waitForFunction(()=>document.querySelector('#foodSyncStatus').textContent.includes('已同步'));
 const otherDate=date.slice(0,8)+'01';
 if(otherDate!==date){assert.equal(await page.locator('#totalVotes').textContent(),'0');await page.evaluate(()=>foodApp.castVote('r2'));assert.ok(docs[`food_votes/A_${otherDate}_早餐`]);}
 fail=true;const before=JSON.stringify(docs);
 await page.evaluate(()=>foodApp.castVote('r1'));assert.equal(JSON.stringify(docs),before);assert.match(await page.locator('#foodSyncStatus').textContent(),/儲存失敗/);fail=false;
 // Legacy random IDs import once and respect newer canonical votes.
 const legacyDate='2026-01-02';docs['food_votes/random']={groupId:'A',date:legacyDate,meal:'晚餐',votes:{bob:{name:'舊名稱',choice:'飯店',time:'2026-01-02T00:00:00Z'}}};
 await page.evaluate(async()=>{const {createFoodStore}=await import('/js/food-store.js');window.testStore=createFoodStore({}, {groupId:'A',accountId:'alice'});await testStore.watch({date:'2026-01-02',meal:'晚餐'},()=>{},()=>{});});
 assert.equal(docs['food_votes/A_2026-01-02_晚餐'].votes.bob.choice,'飯店');
 await page.evaluate(async()=>{const {createFoodStore}=await import('/js/food-store.js');const a=createFoodStore({}, {groupId:'A',accountId:'alice'}),b=createFoodStore({}, {groupId:'A',accountId:'bob'});await Promise.all([a.vote({date:'2026-01-02',meal:'晚餐'},{id:'r1',name:'麵'},{name:'A'},'manual'),b.vote({date:'2026-01-02',meal:'晚餐'},{id:'r2',name:'飯'},{name:'B'},'manual')]);});
 assert.equal(Object.keys(docs['food_votes/A_2026-01-02_晚餐'].votes).length,2);assert.ok(retries>0);
 // A different group sees only its own restaurants and votes.
 await page.evaluate(()=>localStorage.setItem('lastGroupId','B'));await page.reload();await page.waitForFunction(()=>document.querySelector('#foodSyncStatus').textContent.includes('請選擇'));
 await page.evaluate(()=>{foodApp.chooseMeal('晚餐','🍲');foodApp.showList();});await page.waitForFunction(()=>document.querySelector('#foodSyncStatus').textContent.includes('已同步'));
 assert.equal(await page.locator('#voteList .restaurant').count(),1);assert.equal(await page.locator('#totalVotes').textContent(),'0');
 // Restaurant form persists group/account ownership; apostrophes are safe in voting buttons.
 await page.evaluate(()=>{foodApp.go('manage');foodApp.openRestaurant();});
 await page.fill('#rName','測試餐館');await page.fill('#rFood','火鍋');await page.check('input[name="rMeal"][value="晚餐"]');
 await page.evaluate(()=>foodApp.saveRestaurant());
 assert.ok(Object.values(docs).some(d=>d.name==='測試餐館'&&d.groupId==='B'&&d.accountId==='alice'));
 // Deterministic browser clock checks a cancelled wheel does not save to a new date.
 await page.clock.install();await page.evaluate(()=>{foodApp.chooseMeal('晚餐','🍲');foodApp.showWheel();foodApp.startSpin();});
 const votesBefore=Object.keys(docs).filter(k=>k.startsWith('food_votes/')).length;
 await page.evaluate(()=>document.querySelectorAll('#calendarDays .calendar-day')[1].click());
 await page.clock.fastForward(9000);
 assert.equal(Object.keys(docs).filter(k=>k.startsWith('food_votes/')).length,votesBefore);
 assert.equal(await page.locator('#countdown').evaluate(el=>el.classList.contains('show')),false);
 await page.clock.resume();
 // Personal layout is account keyed; ambiguous legacy name documents are ignored.
 await page.goto(base+'/settings.html');await page.waitForSelector('#chk_food');assert.equal(await page.locator('#chk_food').isChecked(),true);assert.equal(await page.locator('#chk_todo').count(),1);
 await page.locator('#chk_food').uncheck();await page.evaluate(()=>savePersonalLayout());assert.equal(docs['userSettings/alice'].modules.food,false);assert.equal(docs['userSettings/小明'].modules.food,false);
 await page.reload();await page.waitForSelector('#chk_food');assert.equal(await page.locator('#chk_food').isChecked(),false);
 // Admin backfills the missing menu into an existing menu catalog.
 await page.goto(base+'/admin.html');await page.waitForFunction(()=>document.querySelector('#newMenusContainer input[value="food"]'));
 assert.equal(docs['system_menus/food'].label,'🍽️ 吃什麼？');assert.equal(docs['system_menus/chat'].label,'聊天');
 // Verify the real homepage renderer honors personal visibility and feature permissions.
 await context.route('**/js/auth.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await context.route('**/js/group.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:mock+extra+'export const limit=()=>({});export const getCountFromServer=async()=>({data:()=>({count:0})});'}));
 await page.goto(base+'/index.html');await page.waitForFunction(()=>typeof renderDynamicModules==='function');
 await page.evaluate(()=>renderDynamicModules({accountId:'alice',name:'小明',menus:['food']}));
 assert.equal(await page.locator('#miniCardsContainer [onclick*="food-decision"]').count(),0);
 docs['userSettings/alice'].modules.food=true;
 await page.evaluate(()=>renderDynamicModules({accountId:'alice',name:'小明',menus:['food']}));
 assert.equal(await page.locator('#miniCardsContainer [onclick*="food-decision"]').count(),1);
 await page.evaluate(()=>renderDynamicModules({accountId:'alice',name:'小明',menus:[]}));
 assert.equal(await page.locator('#miniCardsContainer [onclick*="food-decision"]').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: legacy string/array/missing/null/number/object meals render safely and wheel filtering works; menu backfill, account layouts, group/date/meal isolation, persistence/revote, decision save, legacy import, concurrent votes, save errors, restaurant creation, cancelled wheel, homepage visibility');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
