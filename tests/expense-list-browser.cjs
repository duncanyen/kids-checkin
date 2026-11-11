// Run a static server at 8012; all Firebase data stays in this isolated fixture.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.EXPENSE_BASE_URL || 'http://127.0.0.1:8012';
const sdk = require('./fixtures/expense-sdk.cjs');

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
  window.__writes=0; window.__editWrites=0; window.__editPatches=[]; window.__documentReads=[];
  window.__store={
   'users/alice':{...user,avatar:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='},
   'customCategories/legacy':{groupId:'A',type:'expense',name:'舊圖示',icon:'🥪',imgBase64:null},
   'customCategories/upload':{groupId:'A',type:'expense',name:'自訂照片',icon:'✨',imgBase64:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='},
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
 assert.match(await page.locator('.ledger-row').first().innerText(),/11\/3/);assert.equal(await page.locator('.ledger-row-name').first().innerText(),'');
 const hierarchy=await page.locator('.ledger-row').last().evaluate(row=>{const category=getComputedStyle(row.querySelector('.ledger-row-category')),name=getComputedStyle(row.querySelector('.ledger-row-name'));return{categorySize:parseFloat(category.fontSize),nameSize:parseFloat(name.fontSize),categoryWeight:Number(category.fontWeight),nameWeight:Number(name.fontWeight)};});assert.ok(hierarchy.categorySize>hierarchy.nameSize);assert.ok(hierarchy.categoryWeight>=700);assert.equal(hierarchy.nameWeight,400);
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
 // Empty names remain optional; the existing form edits the original record only.
 await page.evaluate(()=>window.__delaySave=false);
 await page.click('#addListIncome');
 await page.fill('#expenseAmount','88');
 await page.click('#btnSaveExpense');
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent.includes('已儲存'));
 assert.equal(await page.evaluate(()=>window.__store['expenses/new-2'].note),'');
 await page.evaluate(()=>Object.assign(window.__store['expenses/new-2'],{name:'不應回填的舊名',timestamp:777,extra:{keep:true}}));
 const metadata=await page.evaluate(()=>{const {date,type,category,amount,note,...rest}=window.__store['expenses/new-2'];return rest;});
 assert.equal(await page.locator('#dayExpenseList button.exp-note').first().innerText(),'');
 await page.locator('#dayExpenseList button.exp-note').first().click();
 assert.equal(await page.inputValue('#expenseAmount'),'88');
 assert.equal(await page.inputValue('#expenseNote'),'');
 assert.equal(await page.inputValue('#expenseDate'),'2026-11-01');
 assert.match(await page.locator('#btnTypeIncome').getAttribute('class'),/active/);
 assert.equal(await page.locator('#btnSaveExpense').innerText(),'儲存修改');
 await page.fill('#expenseNote','補記薪資');
 await page.evaluate(()=>window.__failSave=true);await page.click('#btnSaveExpense');
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent.includes('儲存失敗'));
 assert.equal(await page.inputValue('#expenseNote'),'補記薪資');
 assert.equal(await page.evaluate(()=>window.__store['expenses/new-2'].note),'');
 await page.evaluate(()=>{window.__failSave=false;window.__store['expenses/new-2'].groupId='B';});
 await page.click('#btnSaveExpense');await page.waitForFunction(()=>!document.querySelector('#btnSaveExpense').disabled);
 assert.equal(await page.evaluate(()=>window.__editWrites),0,'changed group is rejected without writing');
 await page.evaluate(()=>{window.__store['expenses/new-2'].groupId='A';window.__delayEditSave=true;});
 await page.evaluate(()=>{document.getElementById('btnSaveExpense').click();document.getElementById('btnSaveExpense').click();});
 assert.equal(await page.locator('#btnSaveExpense').isDisabled(),true);
 await page.waitForFunction(()=>typeof window.__releaseEditSave==='function');await page.evaluate(()=>window.__releaseEditSave());
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent==='紀錄已更新。');
 assert.equal(await page.evaluate(()=>window.__editWrites),1);
 assert.equal(await page.evaluate(()=>window.__writes),2,'editing must not add a new document');
 assert.equal(await page.evaluate(()=>window.__store['expenses/new-2'].amount),88);
 assert.equal(await page.locator('#listTotal').innerText(),'NT$ 30,088');
 await page.evaluate(()=>window.__delayEditSave=false);
 // Edit all five fields, including a type change, and refresh both monthly totals.
 await page.fill('#expenseDate','2026-11-15');await page.locator('#expenseDate').dispatchEvent('change');
 await page.click('#btnTypeExpense');await page.locator('#categoryGrid .cat-btn').filter({hasText:'交通'}).click();
 await page.fill('#expenseAmount','0');await page.click('#btnSaveExpense');
 assert.match(await page.locator('#entryStatus').innerText(),/大於 0/);
 await page.fill('#expenseAmount','150.75');await page.fill('#expenseNote','');
 await page.evaluate(()=>window.__store['expenses/new-2'].amount=99);await page.click('#btnSaveExpense');
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent.includes('已由其他人修改'));
 assert.equal(await page.evaluate(()=>window.__store['expenses/new-2'].amount),99);
 assert.equal(await page.evaluate(()=>window.__editWrites),1,'stale fields must not overwrite a concurrent edit');
 await page.evaluate(()=>window.__store['expenses/new-2'].amount=88);await page.click('#btnSaveExpense');
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent==='紀錄已更新。'&&!document.querySelector('#btnSaveExpense').disabled);
 assert.equal(await page.locator('#listTotal').innerText(),'NT$ 30,000');
 const edited=await page.evaluate(()=>window.__store['expenses/new-2']);
 assert.equal(edited.date,'2026-11-15');assert.equal(edited.type,'expense');assert.equal(edited.category,'交通');assert.equal(edited.amount,150.75);assert.equal(edited.note,'');
 const {date,type,category,amount,note,...unchanged}=edited;assert.deepEqual(unchanged,metadata);
 assert.ok(await page.evaluate(()=>window.__editPatches.every(p=>JSON.stringify(Object.keys(p).sort())===JSON.stringify(['amount','category','date','note','type']))));
 await page.click('#expenseModal .btn-close');await page.click('#listExpenseTab');
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 301');
 await page.locator('.ledger-row').filter({hasText:'150.75'}).click();
 assert.equal(await page.inputValue('#expenseDate'),'2026-11-15');assert.equal(await page.inputValue('#expenseAmount'),'150.75');
 // Closing cancels edits; cross-month editing is allowed without changing the selected month.
 await page.fill('#expenseAmount','999');await page.click('#expenseModal .btn-close');
 assert.equal(await page.evaluate(()=>window.__store['expenses/new-2'].amount),150.75);
 await page.locator('.ledger-row').filter({hasText:'150.75'}).click();
 await page.fill('#expenseDate','2026-12-02');await page.locator('#expenseDate').dispatchEvent('change');
 await page.click('#btnTypeIncome');await page.locator('#categoryGrid .cat-btn').filter({hasText:'獎金'}).click();
 await page.fill('#expenseAmount','200.5');await page.fill('#expenseNote','跨月收入');await page.click('#btnSaveExpense');
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent==='紀錄已更新。'&&!document.querySelector('#btnSaveExpense').disabled);
 assert.equal(await page.locator('#listTotal').innerText(),'NT$ 150.25');
 await page.click('#expenseModal .btn-close');await page.fill('#listPeriod','2026-12');await page.locator('#listPeriod').dispatchEvent('change');await page.click('#listIncomeTab');
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 200.5');
 await page.locator('.ledger-row').filter({hasText:'跨月收入'}).click();
 assert.equal(await page.inputValue('#expenseDate'),'2026-12-02');
 // Restore the fixture to continue the original add/delete/pagination regressions.
 await page.fill('#expenseDate','2026-11-01');await page.locator('#expenseDate').dispatchEvent('change');
 await page.locator('#categoryGrid .cat-btn').filter({hasText:'薪資'}).click();await page.fill('#expenseAmount','88');await page.fill('#expenseNote','補記薪資');await page.click('#btnSaveExpense');
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent==='紀錄已更新。'&&!document.querySelector('#btnSaveExpense').disabled);
 await page.click('#expenseModal .btn-close');await page.fill('#listPeriod','2026-11');await page.locator('#listPeriod').dispatchEvent('change');
 await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 30,088');
 await page.locator('.ledger-row').filter({hasText:'補記薪資'}).click();
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
 // Category SVG migration preserves uploaded pictures and existing category IDs.
 await page.evaluate(()=>window.openModal('settingsModal'));
 assert.equal(await page.locator('.managed-category svg').count(),5);
 assert.equal(await page.locator('.managed-category img').count(),1);
 await page.getByRole('button',{name:'編輯舊圖示',exact:true}).click();
 assert.equal(await page.inputValue('#editCatId'),'legacy');
 assert.equal(await page.inputValue('#newCatName'),'舊圖示');
 assert.equal(await page.locator('[data-category-icon="sandwich"]').getAttribute('aria-checked'),'true');
 await page.getByRole('radio',{name:'禮物',exact:true}).click();
 await page.fill('#newCatName','自訂禮物');
 await page.click('#btnSaveCustomCat');
 await page.waitForSelector('#customCatModal',{state:'hidden'});
 assert.equal(await page.evaluate(()=>window.__store['customCategories/legacy'].icon),'gift');
 await page.getByRole('button',{name:'編輯自訂照片',exact:true}).click();
 await page.fill('#newCatName','保留照片');
 await page.click('#btnSaveCustomCat');
 await page.waitForSelector('#customCatModal',{state:'hidden'});
 assert.match(await page.evaluate(()=>window.__store['customCategories/upload'].imgBase64),/^data:image\/gif/);
 await page.getByRole('button',{name:'編輯保留照片',exact:true}).click();
 await page.getByRole('radio',{name:'金幣',exact:true}).click();
 await page.evaluate(()=>window.__failSave=true);
 await page.click('#btnSaveCustomCat');
 await page.waitForFunction(()=>!document.querySelector('#btnSaveCustomCat').disabled);
 assert.equal(await page.inputValue('#editCatId'),'upload');
 await page.evaluate(()=>window.__failSave=false);
 await page.click('#btnSaveCustomCat');
 await page.waitForSelector('#customCatModal',{state:'hidden'});
 assert.equal(await page.evaluate(()=>window.__store['customCategories/upload'].imgBase64),null);
 assert.equal(await page.evaluate(()=>window.__store['customCategories/upload'].icon),'coins');
 await page.evaluate(()=>window.openModal('customCatModal'));
 await page.fill('#newCatName','測試書籍');
 await page.getByRole('radio',{name:'書本',exact:true}).click();
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const boxes=await page.locator('.category-svg-choice').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,right:r.right,width:r.width,height:r.height};}));
  assert.ok(boxes.every(box=>box.x>=0&&box.right<=width&&box.width>=40&&box.height>=44));
 }
 await page.screenshot({path:'/tmp/nexus-expense-category-svg.png'});
 await page.click('#btnSaveCustomCat');
 await page.waitForSelector('#customCatModal',{state:'hidden'});
 assert.equal(await page.evaluate(()=>Object.values(window.__store).find(row=>row.name==='測試書籍').icon),'book');
 await page.getByRole('button',{name:'刪除測試書籍',exact:true}).click();
 await page.waitForFunction(()=>!Object.values(window.__store).some(row=>row.name==='測試書籍'));
 await page.evaluate(()=>window.closeModal('settingsModal'));
 await page.click('#addListExpense');
 assert.equal(await page.locator('#categoryGrid .cat-icon svg').count(),10);
 assert.equal(await page.locator('#categoryGrid .cat-icon img').count(),0);
 await page.click('#expenseModal .btn-close');
 // Calendar details share the same full editor and remove moved records from the old month.
 await page.click('#tabCalendar');
 await page.waitForFunction(()=>document.querySelector('#monthTotalExpense').textContent==='$325');
 await page.evaluate(()=>window.openModal('expenseModal','2026-12-25'));
 await page.locator('#dayExpenseList .exp-cat-name').click();
 assert.equal(await page.inputValue('#expenseAmount'),'25');
 await page.fill('#expenseAmount','35');await page.fill('#expenseNote','');
 await page.fill('#expenseDate','2026-11-30');await page.locator('#expenseDate').dispatchEvent('change');
 await page.click('#btnSaveExpense');
 await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent==='紀錄已更新。'&&!document.querySelector('#btnSaveExpense').disabled);
 assert.equal(await page.locator('#monthTotalExpense').innerText(),'$300');
 assert.equal(await page.locator('#monthTotalIncome').innerText(),'$999');
 assert.equal(await page.evaluate(()=>window.__store['expenses/page-25'].date),'2026-11-30');
 await page.click('#expenseModal .btn-close');
 await page.evaluate(()=>window.openModal('expenseModal','2026-12-25'));
 assert.equal(await page.locator('#btnSaveExpense').innerText(),'儲存紀錄');
 assert.equal(await page.inputValue('#expenseAmount'),'');
 assert.equal(await page.getAttribute('#expenseDate','min'),'2026-12-01');
 await page.click('#expenseModal .btn-close');
 await page.evaluate(()=>sessionStorage.setItem('testRole','member'));
 await page.reload();await page.click('#tabList');
 await page.waitForFunction(()=>!document.querySelector('#addListExpense').disabled);
 assert.equal(await page.locator('#listIncomeTab').isVisible(),false);
 assert.equal(await page.locator('#addListIncome').isVisible(),false);
 await page.evaluate(()=>window.openListEntry('income'));
 assert.equal(await page.locator('#expenseModal').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: full record editing with five-field-only updates, metadata preservation, cancel, failed edit retry, changed-group rejection, duplicate-submit protection, type/category/amount/date/name changes and cross-month totals in list and calendar modes; bounded document reads, pagination, cached pages, monthly aggregate totals, single year/month picker, month arrows, one symbol-only add button; month/year selection, totals, order, avatars, legacy records, group isolation, income/expense entry, date limits, validation, failed save/retry, duplicate-submit guard, deletion sync, stale requests, read retry, mobile layout and existing income permissions.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
