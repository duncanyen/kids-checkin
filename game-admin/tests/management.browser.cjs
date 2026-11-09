const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {fixture}=require('./fixture.cjs');
const base=process.env.OPS_UI_BASE||'http://127.0.0.1:8030/game-admin/site';
const runtime=`
export const observe=fn=>queueMicrotask(()=>fn({uid:'admin'}));
export const identity=async()=>({uid:'admin',email:'operator@example.test',admin:true});
export const logout=async()=>{};
export async function api(action,payload={},requestId){const result=await window.__managementAPI({action,payload,requestId});if(result.error)throw Object.assign(Error(result.error.message),{code:result.error.code});return result.data;}
`;
(async()=>{
 const f=await fixture();f.clock(Date.now());
 await f.db.doc('users/alice').update({name:'更新後的名稱',password:'PRIVATE-PASSWORD-MUST-NOT-APPEAR',pin:'PRIVATE-PIN-MUST-NOT-APPEAR'});
 await f.db.doc('groups/A').update({name:'甲村'});await f.db.doc('groups/B').update({name:'乙村'});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(12000);
  await page.route('**/game-admin/site/runtime.js*',route=>route.fulfill({contentType:'text/javascript',body:runtime}));
  await page.exposeFunction('__managementAPI',async request=>{f.clock(Date.now());try{return{data:await f.service.adminAPI({auth:f.adminAuth,data:request})};}catch(error){return{error:{code:'functions/'+error.code,message:error.message}};}});
  await page.goto(base+'/index.html');await page.locator('#app').waitFor({state:'visible'});
  await page.click('[data-view=players]');await page.getByLabel('帳號（完整 accountId）').fill('alice');await page.getByRole('button',{name:'查詢',exact:true}).click();
  await page.locator('#managementView tbody tr').waitFor();assert.equal(await page.locator('#managementView tbody tr').count(),1);assert.ok((await page.locator('#managementView').innerText()).includes('更新後的名稱'));
  const openPlayer=async()=>{await page.getByRole('button',{name:'查看／管理',exact:true}).click();await page.locator('#managementEditor').waitFor({state:'visible'});};
  const save=async()=>{await page.locator('#managementEditor').getByRole('button',{name:'確認儲存',exact:true}).click();await page.locator('#managementEditor').waitFor({state:'hidden'});};
  await openPlayer();assert.ok(!(await page.content()).includes('PRIVATE-PASSWORD-MUST-NOT-APPEAR'));assert.ok(!(await page.content()).includes('PRIVATE-PIN-MUST-NOT-APPEAR'));
  await page.getByLabel('營運功能',{exact:true}).selectOption('true');await page.getByLabel('管理備註',{exact:true}).fill('已聯繫玩家');await page.getByLabel('本次操作原因',{exact:true}).fill('測試限制');await save();
  await assert.rejects(f.service.announcements(f.request()),{code:'permission-denied'});
  await openPlayer();await page.getByLabel('營運功能',{exact:true}).selectOption('false');await page.getByLabel('本次操作原因',{exact:true}).fill('解除限制');await save();
  await openPlayer();await page.getByRole('button',{name:'調整金幣',exact:true}).first().click();await page.getByLabel('增減金幣（減少請填負數）').fill('50');await page.getByLabel('調整原因',{exact:true}).fill('測試補償');await save();
  assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,150);assert.equal((await f.db.doc('groups/B/users/alice').get()).data().farm.coins,100);
  await openPlayer();await page.getByRole('button',{name:'調整金幣',exact:true}).first().click();
  const ref=f.db.doc('groups/A/users/alice'),snapshot=(await ref.get()).data();await ref.update({farm:{...snapshot.farm,coins:151}});
  await page.getByLabel('增減金幣（減少請填負數）').fill('10');await page.getByLabel('調整原因',{exact:true}).fill('過期餘額');await page.getByRole('button',{name:'確認儲存',exact:true}).click();
  await page.getByText('玩家金幣已變動，請重新讀取後確認',{exact:true}).waitFor();assert.equal((await ref.get()).data().farm.coins,151);await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.screenshot({path:'/tmp/nexus-management-players.png'});
  await page.click('[data-view=balance]');await page.getByRole('row',{name:/邊境牧羊犬/}).getByRole('button',{name:'編輯',exact:true}).click();
  await page.getByLabel('每日租金',{exact:true}).fill('250');await page.getByLabel('每週租金',{exact:true}).fill('1250');await page.getByLabel('商品狀態',{exact:true}).selectOption('true');await page.getByLabel('調整原因',{exact:true}).fill('開放測試');await save();
  const quote=await f.service.guardDog({...f.request(),data:{groupId:'A',action:'catalog'}});assert.equal(quote.breeds.collie.rentable,true);assert.equal(quote.breeds.collie.dayPrice,250);
  await page.screenshot({path:'/tmp/nexus-management-balance.png'});
  await page.click('[data-view=settings]');await page.getByLabel('開放禮包兌換',{exact:true}).selectOption('false');await page.getByLabel('開放新租犬交易',{exact:true}).selectOption('false');await page.getByLabel('暫停時對玩家顯示的訊息',{exact:true}).fill('營運測試維護中');await page.getByLabel('本次變更原因',{exact:true}).fill('維護測試');await page.getByRole('button',{name:'儲存系統設定',exact:true}).click();await page.getByText('系統設定已儲存',{exact:true}).waitFor();
  await assert.rejects(f.service.redeem(f.request()),{code:'failed-precondition'});
  assert.equal((await f.service.guardDog({...f.request(),data:{groupId:'A',action:'catalog'}})).breeds.collie.availability,'paused');
  await page.getByLabel('開放禮包兌換',{exact:true}).selectOption('true');await page.getByLabel('開放新租犬交易',{exact:true}).selectOption('true');await page.getByLabel('本次變更原因',{exact:true}).fill('恢復');await page.getByRole('button',{name:'儲存系統設定',exact:true}).click();await page.getByText('系統設定已儲存',{exact:true}).waitFor();
  await page.click('[data-view=events]');await page.getByRole('button',{name:'新增活動',exact:true}).click();await page.getByLabel('活動名稱',{exact:true}).fill('村落週末活動');await page.getByLabel('活動內容（純文字）',{exact:true}).fill('活動內容 <script>window.hacked=true</script>');await page.getByLabel('活動碼（選填）',{exact:true}).fill('EVENT2026');await page.getByLabel('發布狀態',{exact:true}).selectOption('active');await page.getByLabel('對象',{exact:true}).selectOption('accounts');await page.getByLabel('指定 accountId（逗號或換行分隔）',{exact:true}).fill('alice');await page.getByLabel('操作原因',{exact:true}).fill('發布活動');await save();
  assert.equal((await f.service.announcements(f.request())).rows.length,1);assert.equal((await f.service.announcements(f.request('bob'))).rows.length,0);assert.equal(await page.evaluate(()=>window.hacked),undefined);
  await page.click('[data-view=announcements]');await page.getByRole('button',{name:'至活動管理',exact:true}).click();await page.getByRole('button',{name:'查看／編輯',exact:true}).click();await page.getByLabel('發布狀態',{exact:true}).selectOption('ended');await page.getByLabel('操作原因',{exact:true}).fill('結束活動');await save();assert.equal((await f.service.announcements(f.request())).rows.length,0);
  await page.screenshot({path:'/tmp/nexus-management-events.png'});
  await page.setViewportSize({width:390,height:844});await page.click('#menuButton');await page.click('[data-view=settings]');await page.getByLabel('本次變更原因',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/nexus-management-mobile.png'});
  await page.click('#menuButton');await page.click('[data-view=players]');await page.getByRole('button',{name:'查看／管理',exact:true}).first().click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/nexus-management-player-mobile.png'});await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.ok((await f.admin('list',{kind:'audit'})).rows.some(r=>r.action==='adjustPlayerCoins'&&r.result==='success'));
  assert.deepEqual(errors,[]);console.log('PASS management UI: player identity/redaction/control/coin adjustment/stale balance, live guard config, server settings gates, targeted event publication/end/link ownership, audits, confirmations and desktop/mobile layout; isolated backend transport');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
