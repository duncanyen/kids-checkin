const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const sdk = require('./fixtures/expense-sdk.cjs');
const base = process.env.EXPENSE_BASE_URL || 'http://127.0.0.1:8012';
(async () => {
 const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
  await context.route('**/js/chart-loader.js',r=>r.fulfill({contentType:'text/javascript',body:'export const loadChart=async()=>class{destroy(){}};'}));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.clock.setFixedTime(new Date('2026-11-01T04:00:00Z'));
  await page.addInitScript(()=>{
   const user={accountId:'alice',name:'Alice',role:'member',password:'fixture'};
   sessionStorage.setItem('familyCheckInUser',JSON.stringify(user));localStorage.setItem('lastGroupId','A');
   window.__writes=0;window.__editWrites=0;window.__editPatches=[];window.__documentReads=[];
   window.__store={
    'users/alice':user,
    'expenses/g':{groupId:'A',accountId:'alice',operator:'Alice',date:'2026-11-01',type:'expense',category:'交通',note:'group only',amount:100},
    'expenses/oct':{groupId:'A',date:'2026-10-01',type:'expense',category:'交通',note:'old group month',amount:77},
    'expenses/other':{groupId:'B',date:'2026-11-01',type:'expense',amount:99999},
    'customCategories/g':{groupId:'A',type:'expense',name:'群組分類',icon:'cart'},
    'personalLedgers/alice/expenses/p':{accountId:'alice',operator:'Alice',date:'2026-11-01',type:'expense',category:'早餐',note:'private only',amount:25},
    'personalLedgers/alice/expenses/i':{accountId:'alice',operator:'Alice',date:'2026-11-01',type:'income',category:'薪資',note:'',amount:200},
    'personalLedgers/bob/expenses/hidden':{accountId:'bob',date:'2026-11-01',type:'expense',amount:999999},
    'personalLedgers/alice/customCategories/p':{accountId:'alice',type:'expense',name:'個人分類',icon:'cart',imgBase64:null,color:'#e53935'}
   };
  });
  await page.goto(base+'/expense.html?nav=1');
  await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 100');
  assert.equal(await page.locator('#ledgerMode-group').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#listIncomeTab').isVisible(),false);
  await page.click('#ledgerMode-personal');
  await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 25');
  assert.match(await page.locator('#ledgerList').innerText(),/private only/);assert.doesNotMatch(await page.locator('#ledgerList').innerText(),/group only/);
  assert.equal(await page.locator('#listIncomeTab').isVisible(),true,'personal income is available for an ordinary group member');
  await page.click('[aria-label="帳本設定"]');
  assert.match(await page.locator('#manageCategoryList').innerText(),/個人分類/);assert.doesNotMatch(await page.locator('#manageCategoryList').innerText(),/群組分類/);
  await page.selectOption('#homepageLedgerSource','personal');await page.selectOption('#defaultLedgerMode','personal');
  await page.click('#saveLedgerPreferences');await page.waitForFunction(()=>document.querySelector('#preferencesStatus').textContent.includes('已儲存'));
  assert.deepEqual(await page.evaluate(()=>window.__store['personalLedgers/alice']),{defaultMode:'personal',homepageSource:'personal'});
  // Settings affect the next visit rather than altering the current ledger mid-form.
  await page.click('.btn-add-cat');await page.fill('#newCatName','私人新分類');await page.click('#btnSaveCustomCat');
  await page.waitForFunction(()=>document.querySelector('#customCatModal').style.display==='none');
  assert.equal(await page.evaluate(()=>window.__store['personalLedgers/alice/customCategories/new-1'].accountId),'alice');
  assert.equal(await page.evaluate(()=>window.__store['customCategories/new-1']),undefined);
  await page.click('#settingsModal .btn-close');
  await page.click('#addListExpense');await page.fill('#expenseAmount','12.5');
  await page.evaluate(()=>window.__delaySave=true);await page.click('#btnSaveExpense');
  await page.evaluate(()=>window.switchLedgerMode('group'));
  assert.equal(await page.locator('#ledgerMode-personal').getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>window.__releaseSave());
  await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent.includes('已儲存'));
  const created=await page.evaluate(()=>window.__store['personalLedgers/alice/expenses/new-2']);
  assert.equal(created.amount,12.5);assert.equal(created.accountId,'alice');assert.equal(created.groupId,undefined);
  assert.equal(await page.evaluate(()=>window.__store['expenses/new-2']),undefined);
  await page.locator('#dayExpenseList .expense-item').filter({hasText:'12.5'}).locator('.exp-note').click();
  await page.fill('#expenseAmount','15');await page.click('#btnSaveExpense');
  await page.waitForFunction(()=>document.querySelector('#entryStatus').textContent==='紀錄已更新。');
  assert.equal(await page.evaluate(()=>window.__store['personalLedgers/alice/expenses/new-2'].amount),15);
  await page.locator('#dayExpenseList .expense-item').filter({hasText:'15'}).locator('.btn-del-exp').click();
  await page.waitForFunction(()=>!window.__store['personalLedgers/alice/expenses/new-2']);
  await page.click('#expenseModal .btn-close');
  await page.click('#tabCalendar');await page.waitForFunction(()=>document.querySelector('#monthTotalExpense').textContent==='$25');
  assert.equal(await page.locator('#monthTotalIncome').innerText(),'$200');
  await page.click('#tabReview');await page.waitForFunction(()=>document.querySelector('#revThisMonthExpense').textContent.includes('25'));
  assert.doesNotMatch(await page.locator('#revThisMonthExpense').innerText(),/100/);
  await page.click('#ledgerMode-group');await page.waitForFunction(()=>document.querySelector('#revThisMonthExpense').textContent.includes('100'));
  assert.equal(await page.locator('#revThisMonthIncome').isVisible(),false);
  await page.click('#tabList');await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 100');
  // Delayed old month results cannot overwrite the personal scope.
  await page.evaluate(()=>{window.__delayOctober=true;window.changeMonth(-1);});
  await page.waitForFunction(()=>typeof window.__releaseOctober==='function');
  await page.click('#ledgerMode-personal');
  await page.waitForFunction(()=>!document.querySelector('#ledgerMode-personal').disabled);
  await page.evaluate(()=>window.__releaseOctober());
  await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 0');
  assert.doesNotMatch(await page.locator('#ledgerList').innerText(),/group only/);
  // Persist fixture through reload; verify account-wide scope survives a group change and rename.
  await page.evaluate(()=>{window.__delayOctober=false;localStorage.setItem('fixture',JSON.stringify(window.__store));});
  await page.addInitScript(()=>{window.__store=JSON.parse(localStorage.getItem('fixture'));localStorage.setItem('lastGroupId','B');const u=JSON.parse(sessionStorage.getItem('familyCheckInUser'));u.name='New Alice';sessionStorage.setItem('familyCheckInUser',JSON.stringify(u));});
  await page.reload();await page.waitForFunction(()=>document.querySelector('#listTotal').textContent==='NT$ 25');
  assert.equal(await page.locator('#ledgerMode-personal').getAttribute('aria-pressed'),'true');
  await page.waitForFunction(()=>!document.querySelector('#ledgerMode-personal').disabled);
  await page.screenshot({path:'/tmp/nexus-personal-ledger-mobile.png',fullPage:true,animations:'disabled'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:'/tmp/nexus-personal-ledger-desktop.png',fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);
  console.log('PASS: group/personal isolation, category isolation and create, personal income for members, preference persistence, independent create/edit/delete, in-flight save guard, calendar/review, stale reads, same account across groups and rename, mobile/desktop layout.');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
