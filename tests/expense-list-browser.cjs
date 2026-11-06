// Run a static server at 8012; all Firebase data stays in this isolated fixture.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.EXPENSE_BASE_URL || 'http://127.0.0.1:8012';
const sdk = `
export const initializeApp=()=>({}),getFirestore=()=>({});
export const collection=(_,path)=>({path});
export const doc=(_, ...parts)=>({path:parts.join('/')});
export const where=(field,op,value)=>({field,op,value});
export const query=(ref,...filters)=>({...ref,filters});
export const serverTimestamp=()=>1234;
export const orderBy=(field,direction)=>({kind:'order',field,direction});
export const documentId=()=>'__name__';
export const startAfter=row=>({kind:'cursor',id:row.id});
export const limit=value=>({kind:'limit',value});
export const sum=field=>({field}),count=()=>({});
function rowsFor(ref){return Object.entries(window.__store).filter(([path,data])=>path.startsWith(ref.path+'/')&&(ref.filters||[]).filter(f=>!f.kind).every(f=>f.op==='=='?data[f.field]===f.value:f.op==='in'?f.value.includes(data[f.field]):f.op==='>='?data[f.field]>=f.value:data[f.field]<=f.value)).map(([path,data])=>({id:path.split('/').at(-1),data:()=>structuredClone(data)}));}
export const getAggregateFromServer=async ref=>{
 if(window.__failRead)throw Error('offline');
 const rows=rowsFor(ref);return{data:()=>({amount:rows.reduce((n,r)=>n+Number(r.data().amount),0),records:rows.length})};
};
export const getDocs=async ref=>{
 if(ref.path==='expenses'&&window.__failRead)throw Error('offline');
 const delay=ref.filters?.find(f=>f.field==='date'&&f.op==='>='&&f.value==='2026-10-01');
 if(delay&&window.__delayOctober)await new Promise(resolve=>window.__releaseOctober=resolve);
 let docs=rowsFor(ref);
 if(ref.filters?.some(f=>f.kind==='order'))docs.sort((a,b)=>b.data().date.localeCompare(a.data().date)||b.id.localeCompare(a.id));
 const cursor=ref.filters?.find(f=>f.kind==='cursor');if(cursor)docs=docs.slice(docs.findIndex(r=>r.id===cursor.id)+1);
 const cap=ref.filters?.find(f=>f.kind==='limit');if(cap)docs=docs.slice(0,cap.value);
 if(ref.path==='expenses')window.__documentReads.push({limit:cap?.value,count:docs.length});
 return{docs,forEach:fn=>docs.forEach(fn)};
};
export const addDoc=async(ref,data)=>{
 if(window.__failSave)throw Error('offline');
 if(window.__delaySave)await new Promise(resolve=>window.__releaseSave=resolve);
 const id='new-'+(++window.__writes);window.__store[ref.path+'/'+id]=structuredClone(data);return{id};
};
export const deleteDoc=async ref=>{delete window.__store[ref.path];};
export const updateDoc=async(ref,patch)=>{if(window.__failSave)throw Error('offline');Object.assign(window.__store[ref.path],patch);};
export const getDoc=async ref=>({exists:()=>!!window.__store[ref.path],data:()=>window.__store[ref.path]});
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('https://www.gstatic.com/**',route=>route.fulfill({contentType:'text/javascript',body:sdk}));
 await context.route('**/js/chart-loader.js',route=>route.fulfill({contentType:'text/javascript',body:'export const loadChart=async()=>class{destroy(){}};'}));
 const page=await context.newPage(),errors=[];
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>{errors.push(error.message);console.error('PAGE ERROR',error.message);});
 let promptAnswer;
 page.on('dialog',dialog=>dialog.accept(promptAnswer));
 await page.clock.setFixedTime(new Date('2026-11-01T04:00:00Z'));
 await page.addInitScript(()=>{
  const user={accountId:'alice',name:'Alice',role:sessionStorage.getItem('testRole')||'parent',menus:['finance']};
  sessionStorage.setItem('familyCheckInUser',JSON.stringify(user));localStorage.setItem('lastGroupId','A');
  window.__writes=0; window.__documentReads=[];
  window.__store={
   'users/alice':{...user,avatar:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='},
   'expenses/e1':{groupId:'A',accountId:'alice',operator:'Alice',date:'2026-11-01',category:'早餐',note:'早餐三明治',amount:50.25},
   'expenses/e2':{groupId:'A',operator:'Bob',date:'2026-11-03',category:'交通',type:'expense',amount:100,note:null,name:'不應回填的舊名'},
   'expenses/i1':{groupId:'A',accountId:'alice',operator:'Alice',date:'2026-11-01',category:'薪資',note:'十一月薪資',type:'income',amount:30000},
   'expenses/other-group':{groupId:'B',date:'2026-11-01',type:'expense',amount:99999},
   'expenses/oct':{groupId:'A',date:'2026-10-01',category:'早餐',type:'expense',amount:20},
   'expenses/past':{groupId:'A',date:'2025-02-01',category:'交通',type:'expense',amount:70}
  };
 });
 await page.goto(base+'/expense.html?nav=1');
 await page.click('#tabList');
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 150.25');
 assert.equal(await page.inputValue('#listPeriod'),'2026-11');
 assert.equal(await page.locator('#listPeriodText').innerText(),'2026年11月');
 assert.equal(await page.locator('#addListExpense').innerText(),'+');
 assert.equal(await page.locator('#addListIncome').isVisible(),false);
 assert.ok(await page.evaluate(()=>window.__documentReads.every(r=>r.limit===10&&r.count<=10)));
 assert.equal(await page.locator('.ledger-row').count(),2);
 assert.match(await page.locator('.ledger-row').first().innerText(),/11\/3/);assert.equal(await page.locator('.ledger-row-details strong').first().innerText(),'');
 await page.waitForSelector('.ledger-row-avatar img');
 await page.click('#listIncomeTab');
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 30,000');
 assert.equal(await page.locator('#addListExpense').isVisible(),false);
 assert.equal(await page.locator('#addListIncome').innerText(),'+');
 await page.click('#addListIncome');
 assert.equal(await page.inputValue('#expenseDate'),'2026-11-01');
 assert.match(await page.locator('#btnTypeIncome').getAttribute('class'),/active/);
 await page.fill('#expenseAmount','123.45');
 assert.match(await page.locator('label[for=expenseNote]').innerText(),/選填/);
 await page.fill('#expenseNote','<img src=x onerror=alert(1)>');
 await page.evaluate(()=>window.__failSave=true);
 await page.click('#btnSaveExpense');
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent.includes('儲存失敗'));
 assert.equal(await page.inputValue('#expenseAmount'),'123.45');
 await page.evaluate(()=>{window.__failSave=false;window.__delaySave=true;});
 await page.click('#btnSaveExpense');
 assert.equal(await page.locator('#btnSaveExpense').isDisabled(),true);
 await page.evaluate(()=>window.switchModalType('expense'));
 await page.evaluate(()=>window.__releaseSave());
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent.includes('已儲存'));
 assert.equal(await page.evaluate(()=>window.__writes),1);
 assert.equal(await page.evaluate(()=>window.__store['expenses/new-1'].type),'income');
 assert.equal(await page.locator('#dayExpenseList img').count(),0);
 await page.click('#expenseModal .btn-close');
 assert.equal(await page.locator('#listTotal').innerText(),'NT$ 30,123.45');
 assert.equal(await page.locator('#ledgerList .ledger-row-details img').count(),0);
 // Reopen a row, delete the saved entry, and verify the shared monthly totals.
 await page.locator('.ledger-row').filter({hasText:'<img src=x'}).click();
 await page.locator('#dayExpenseList .expense-item').filter({hasText:'<img src=x'}).locator('.btn-del-exp').click();
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 30,000');
 await page.click('#expenseModal .btn-close');
 // Save a record without a name, then fill its name without changing money.
 await page.evaluate(()=>window.__delaySave=false);
 await page.click('#addListIncome');
 await page.fill('#expenseAmount','88');
 await page.click('#btnSaveExpense');
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent.includes('已儲存'));
 assert.equal(await page.evaluate(()=>window.__store['expenses/new-2'].note),'');await page.evaluate(()=>window.__store['expenses/new-2'].name='不應回填的舊名');
 assert.equal(await page.locator('#dayExpenseList button.exp-note').first().innerText(),'');
 promptAnswer='補記薪資';
 await page.locator('#dayExpenseList button.exp-note').first().click();
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent==='名稱已更新。');
 assert.equal(await page.evaluate(()=>window.__store['expenses/new-2'].note),'補記薪資');
 assert.equal(await page.evaluate(()=>window.__store['expenses/new-2'].amount),88);
 assert.equal(await page.locator('#listTotal').innerText(),'NT$ 30,088');
 await page.locator('#dayExpenseList .expense-item').filter({hasText:'補記薪資'}).locator('.btn-del-exp').click();
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 30,000');
 await page.click('#expenseModal .btn-close');
 await page.click('#listExpenseTab');
 await page.fill('#listPeriod','2025-02');await page.locator('#listPeriod').dispatchEvent('change');
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 70');
 await page.click('#addListExpense');
 assert.equal(await page.inputValue('#expenseDate'),'2025-02-01');
 assert.equal(await page.getAttribute('#expenseDate','max'),'2025-02-28');
 await page.fill('#expenseDate','2025-02-15');await page.locator('#expenseDate').dispatchEvent('change');
 await page.fill('#expenseAmount','12.345');await page.fill('#expenseNote','測試');await page.click('#btnSaveExpense');
 assert.match(await page.locator('#entryStatus').innerText(),/兩位小數/);
 await page.click('#expenseModal .btn-close');
 // Older requests must not overwrite a newer month.
 await page.evaluate(()=>{window.__delayOctober=true;document.querySelector('#listPeriod').value='2026-10';window.selectListMonth();});
 await page.fill('#listPeriod','2026-11');await page.locator('#listPeriod').dispatchEvent('change');
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 150.25');
 await page.evaluate(()=>window.__releaseOctober());
 await page.waitForTimeout(50);
 assert.equal(await page.locator('#listTotal').innerText(),'NT$ 150.25');
 await page.evaluate(()=>window.__failRead=true);
 await page.fill('#listPeriod','2026-12');await page.locator('#listPeriod').dispatchEvent('change');
 await page.waitForSelector('#retryListMonth:not([hidden])');
 assert.equal(await page.locator('#addListExpense').isDisabled(),true);
 await page.evaluate(()=>window.__failRead=false);
 await page.click('#retryListMonth');
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 0');
 assert.match(await page.locator('#ledgerList').innerText(),/還沒有支出/);
 // Navigate a year boundary with the month arrows.
 await page.click('[aria-label="下個月"]');
 await page.waitForFunction(()=>!document.querySelector('#addListExpense').disabled);
 assert.equal(await page.inputValue('#listPeriod'),'2027-01');
 await page.click('[aria-label="上個月"]');
 await page.waitForFunction(()=>!document.querySelector('#addListExpense').disabled);
 assert.equal(await page.inputValue('#listPeriod'),'2026-12');
 // 25 expense rows and one income: only requested pages may read documents.
 await page.evaluate(()=>{
  for(let i=1;i<=25;i++)window.__store['expenses/page-'+String(i).padStart(2,'0')]={groupId:'A',date:'2026-12-'+String(i).padStart(2,'0'),type:'expense',category:'早餐',note:'第'+i+'筆',amount:i};
  window.__store['expenses/page-income']={groupId:'A',date:'2026-12-26',type:'income',amount:999};
  window.__documentReads=[];
  window.retryListMonth();
 });
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 325');
 assert.equal(await page.locator('.ledger-row').count(),10);
 assert.match(await page.locator('.ledger-row').first().innerText(),/第25筆/);
 const firstReads=await page.evaluate(()=>window.__documentReads.length);
 assert.equal(firstReads,1,'typed first page must use exactly one ten-document query');
 await page.click('#listNext');
 await page.waitForFunction(()=>document.querySelector('#listPageStatus').textContent==='第 2 / 3 頁');
 assert.equal(await page.locator('.ledger-row').count(),10);
 assert.match(await page.locator('.ledger-row').first().innerText(),/第15筆/);
 await page.click('#listNext');
 await page.waitForFunction(()=>document.querySelector('#listPageStatus').textContent==='第 3 / 3 頁');
 assert.equal(await page.locator('.ledger-row').count(),5);
 assert.equal(await page.locator('#listNext').isDisabled(),true);
 const loadedReads=await page.evaluate(()=>window.__documentReads.length);
 await page.click('#listPrevious');
 await page.waitForFunction(()=>document.querySelector('#listPageStatus').textContent==='第 2 / 3 頁');
 assert.equal(await page.evaluate(()=>window.__documentReads.length),loadedReads,'previous page uses cached records');
 assert.ok(await page.evaluate(()=>window.__documentReads.every(r=>r.limit===10&&r.count<=10)));
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const fab=await page.locator('#addListExpense').boundingBox(),nav=await page.locator('#appNavigation').boundingBox();
  assert.ok(fab.y+fab.height<=nav.y,'add button clears bottom navigation');
  await page.click('#listIncomeTab');await page.waitForSelector('#addListIncome',{state:'visible'});const incomeFab=await page.locator('#addListIncome').boundingBox();assert.ok(Math.abs(incomeFab.x-fab.x)<1&&Math.abs(incomeFab.y-fab.y)<1,'income and expense add buttons use the same right position');await page.click('#listExpenseTab');await page.waitForSelector('#addListExpense',{state:'visible'});
 }
 await page.evaluate(()=>sessionStorage.setItem('testRole','member'));
 await page.reload();await page.click('#tabList');
 await page.waitForFunction(()=>!document.querySelector('#addListExpense').disabled);
 assert.equal(await page.locator('#listIncomeTab').isVisible(),false);
 assert.equal(await page.locator('#addListIncome').isVisible(),false);
 await page.evaluate(()=>window.openListEntry('income'));
 assert.equal(await page.locator('#expenseModal').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: bounded document reads, pagination, cached pages, monthly aggregate totals, single year/month picker, month arrows, one symbol-only add button; month/year selection, totals, order, avatars, legacy records, group isolation, income/expense entry, date limits, validation, failed save/retry, duplicate-submit guard, deletion sync, stale requests, read retry, mobile layout and existing income permissions.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
