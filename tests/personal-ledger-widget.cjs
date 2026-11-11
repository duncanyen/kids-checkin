const {chromium}=require('playwright'),assert=require('node:assert/strict');
const sdk=require('./fixtures/expense-sdk.cjs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext();
  await context.route('**/ledger-widget-test.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:sdk+`
export const onSnapshot=(ref,next,error)=>{window.__watches.push(ref);window.__next=next;window.__error=error;return()=>window.__stops++;};`}));
  await context.route('**/js/personal-ledger.js',r=>r.fulfill({contentType:'text/javascript',body:`
export const readLedgerPreferences=async()=>{if(window.__fail)throw Error('offline');if(window.__delay)await new Promise(r=>window.__release=r);return{homepageSource:window.__source||'group'};};
export const personalLedgerDatabase=async()=>({});`}));
  const page=await context.newPage();await page.goto((process.env.EXPENSE_BASE_URL||'http://127.0.0.1:8012')+'/ledger-widget-test.html');
  await page.evaluate(async()=>{window.__watches=[];window.__stops=0;window.__results=[];window.__errors=0;window.__widget=await import('/js/expense-home-widget.js');window.start=()=>window.__widget.watchExpenseWidget({db:{},user:{accountId:'alice'},groupId:'A',onValue:(...v)=>window.__results.push(v),onError:()=>window.__errors++});window.__stop=window.start();});
  await page.waitForFunction(()=>window.__watches.length===1);
  assert.equal(await page.evaluate(()=>window.__watches[0].path),'expenses');
  assert.equal(await page.evaluate(()=>window.__watches[0].filters[0].value),'A');
  await page.evaluate(()=>window.__next({forEach:fn=>[{amount:100,type:'expense'},{amount:20},{amount:900,type:'income'}].forEach(data=>fn({data:()=>data}))}));
  assert.deepEqual(await page.evaluate(()=>window.__results),[[120,'群組帳']]);
  await page.evaluate(()=>{window.__stop();window.__source='personal';window.__stop=window.start();});
  await page.waitForFunction(()=>window.__watches.length===2);
  assert.equal(await page.evaluate(()=>window.__watches[1].path),'personalLedgers/alice/expenses');
  assert.ok(await page.evaluate(()=>window.__watches[1].filters.every(f=>f.field!=='groupId')));
  await page.evaluate(()=>window.__next({forEach:fn=>fn({data:()=>({amount:25,type:'expense'})})}));
  assert.deepEqual(await page.evaluate(()=>window.__results.at(-1)),[25,'個人帳']);
  await page.evaluate(()=>{window.__stop();window.__next({forEach:fn=>fn({data:()=>({amount:99999})})});});
  assert.equal(await page.evaluate(()=>window.__results.length),2,'late snapshot after cleanup ignored');
  await page.evaluate(()=>{window.__delay=true;window.__stop=window.start();});
  await page.waitForFunction(()=>!!window.__release);
  await page.evaluate(()=>{window.__stop();window.__release();});
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>window.__watches.length),2,'cleanup during connect must not install another listener');
  await page.evaluate(()=>{window.__delay=false;window.__fail=true;window.__stop=window.start();});
  await page.waitForFunction(()=>window.__errors===1);
  assert.equal(await page.evaluate(()=>window.__watches.length),2,'failed preference lookup must not show a misleading group total');
  assert.equal(await page.evaluate(()=>window.__stops),2);
  console.log('PASS: homepage source selection, monthly filters, income exclusion, real totals, no cross-scope fallback on errors, synchronous listener cleanup and deferred connection cancellation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
