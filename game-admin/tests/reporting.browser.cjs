const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {fixture}=require('./fixture.cjs'),{createReporting}=require('../functions/reporting.cjs');
(async()=>{
 const f=await fixture(),now=Date.now();f.clock(now);await f.db.doc('groups/A').update({name:'測試甲村'});await f.db.doc('groups/B').update({name:'測試乙村'});await f.db.doc('users/alice').update({name:'新玩家名稱',password:'PRIVATE-NEVER-RETURN'});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-TW',timezoneId:'Asia/Taipei'}),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  const runtime=`export const observe=fn=>queueMicrotask(()=>fn({uid:'admin'}));export const identity=async()=>({uid:'admin',email:'admin@example.test',admin:true});export const logout=async()=>{};export async function api(action,payload,requestId){const r=await window.__reportAPI({action,payload,requestId});if(r.error)throw Error(r.error);return r.data;}`;
  await page.route('**/game-admin/site/runtime.js*',r=>r.fulfill({contentType:'text/javascript',body:runtime}));
  await page.exposeFunction('__reportAPI',async data=>{calls.push(data);f.clock(Date.now());try{return{data:await f.service.adminAPI({auth:f.adminAuth,data})};}catch(e){return{error:e.message};}});
  await page.goto('http://127.0.0.1:8030/game-admin/site/index.html');await page.locator('#app').waitFor({state:'visible'});await page.click('[data-view=reports]');
  assert.equal(calls.filter(r=>r.action==='farmReport').length,0,'opening the page does not scan data');
  const run=async()=>{await page.getByRole('button',{name:'查詢報表',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='報表已更新');};
  await run();assert.match(await page.locator('#managementView').innerText(),/尚未開始收集/);assert.equal(await page.locator('#managementView tbody tr').count(),4);assert.ok(!(await page.content()).includes('PRIVATE-NEVER-RETURN'));
  await createReporting({db:f.db,now:f.now}).capture({id:'report-browser',groupId:'A',accountId:'alice',occurredAt:now-60000,before:{coins:100},after:{coins:150,reportHarvestedEggs:12,reportStolenEggs:2,combatKills:{wolf:1,tiger:2},dragonResults:[{id:'dragon-1',outcome:'win'}]}});
  await page.locator('[name=startAt]').fill(new Date(now-120000+8*3600000).toISOString().slice(0,19));await run();assert.match(await page.locator('#managementView').innerText(),/部分紀錄/);
  const alice=page.locator('#managementView tbody tr').filter({hasText:'測試甲村'}).filter({hasText:'新玩家名稱'});assert.equal(await alice.locator('td').nth(3).innerText(),'12');assert.equal(await alice.locator('td').nth(4).innerText(),'2');assert.equal(await alice.locator('td').nth(13).innerText(),'50');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok(await page.locator('.farm-report-table').evaluate(el=>el.scrollWidth>el.clientWidth));await page.screenshot({path:`/tmp/farm-report-${width}.png`,fullPage:true});}
  const before=calls.filter(r=>r.action==='farmReport').length;await page.locator('[name=startAt]').fill(new Date(now+8*3600000).toISOString().slice(0,19));await page.locator('[name=endAt]').fill(new Date(now-120000+8*3600000).toISOString().slice(0,19));await page.getByRole('button',{name:'查詢報表',exact:true}).click();assert.match(await page.locator('#status').textContent(),/早於/);assert.equal(calls.filter(r=>r.action==='farmReport').length,before);
  await page.click('[data-view=players]');await page.waitForSelector('#managementView tbody tr');assert.deepEqual(errors,[]);console.log('PASS report UI: separate navigation, date-only filters, actual service fixture, absent/partial history, current names, all-group rows, error validation, responsive scroll and existing player navigation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
