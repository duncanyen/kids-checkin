// Real Phaser scene, supplied PNG assets and real service logic; all Firebase data is isolated.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {fixture}=require('../game-admin/tests/fixture.cjs');
const {createDailyChallenges,DEFAULT_CONFIG}=require('../game-admin/functions/daily-challenges.cjs');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8012';
(async()=>{
 const backend=await fixture(),start=Date.parse('2026-11-13T04:00:00Z');backend.clock(start);
 await backend.db.doc('users/self').set({accountId:'self',name:'測試玩家',role:'child'});
 await backend.db.doc('groups/dragon-test').set({members:['self','neighbor']});
 let releaseStatus,holdStatus=false,releaseClaim,holdClaim=false,failStatus=false,layoutService=null,statusRequests=0;
 const req=(action,payload={})=>({auth:{uid:'self',token:{photoAccountId:'self',photoGroupId:'dragon-test'}},data:{groupId:'dragon-test',action,...payload}});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true}),errors=[],assetErrors=[];
 page.on('response',r=>{if(r.url().includes('/daily-missions/')&&r.status()>=400)assetErrors.push(r.url());});
 page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});page.on('dialog',d=>d.accept());
 await page.exposeFunction('__dailyApi',async(action,payload)=>{
  if(action==='status')statusRequests++;
  if(action==='status'&&holdStatus){holdStatus=false;await new Promise(r=>releaseStatus=r);}
  if(action==='status'&&failStatus)throw Error('測試網路中斷');
  if(action==='claim'&&holdClaim){holdClaim=false;await new Promise(r=>releaseClaim=r);}
  const result=await (layoutService?layoutService.handle(req(action,payload)):backend.service.dailyChallenges(req(action,payload)));
  if(action==='claim'||action==='status'){
   const farm=(await backend.db.doc('groups/dragon-test/users/self').get()).data().farm;
   await page.evaluate(farm=>__farmTest.patch('self',farm),farm);
  }
  return result;
 });
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('/tmp/kids-phaser.js','utf8')}));
 await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('tests/fixtures/farm-daily-sdk.js','utf8')}));
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.route('**/js/farm/mail-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmMail(){}'}));
 await page.route('**/js/farm/operations-client.js',r=>r.fulfill({contentType:'text/javascript',body:"export const GAME_ANNOUNCEMENTS_ENABLED=false,GAME_REDEMPTION_ENABLED=false;export const createGameOperationsClient=()=>({dailyChallenges:(action,payload)=>window.__dailyApi(action,payload)});"}));
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await page.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',groupId:'dragon-test',name:'測試玩家'})));
 await page.goto(base+'/farmgame.html');
 await page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&__farmGame.registry.get('farmLoadState')?.phase==='ready');
 await backend.db.doc('groups/dragon-test/users/self').set({farm:await page.evaluate(()=>__farmTest.docs['groups/dragon-test/users/self'].farm)});
 const tasks=page.locator('.farm-hud-side button[aria-label="每日任務"]');assert.equal(await tasks.count(),1);
 await tasks.click();await page.waitForFunction(()=>!document.querySelector('.farm-daily-claim').disabled);
 assert.equal(await page.locator('.farm-daily-card').count(),7);
 assert.ok(await page.locator('.farm-daily-title').evaluate(n=>getComputedStyle(n).backgroundImage.includes('/v2/title.png')));
 assert.ok(await page.locator('.farm-daily-close img').evaluate(n=>n.complete&&n.naturalWidth>0&&n.src.includes('/v2/close.png')));
 const amounts=await page.locator('.farm-daily-amount').allTextContents();assert.deepEqual(amounts,['100','100','100','100','100','100','1,000']);
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').input.enabled),false);
 for(const width of [320,390,430,768]){
  await page.setViewportSize({width,height:width===768?1024:844});
  const fits=await page.locator('.farm-daily-panel').evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});assert.ok(fits,'panel fits '+width);
  assert.ok(await page.locator('.farm-daily-body').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
  await page.screenshot({path:`/tmp/gugu-daily-checkin-${width}.png`});
 }
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('tab',{name:'每日任務',exact:true}).click();
 assert.equal(await page.locator('.farm-daily-mission').count(),3);assert.equal(await page.locator('.farm-daily-claim').isDisabled(),true);
 assert.deepEqual(await page.locator('.farm-daily-count').allTextContents(),['0/3','0/3','0/3']);assert.match(await page.locator('.farm-daily-notice').innerText(),/尚未接上後端驗證/);
 await page.screenshot({path:'/tmp/gugu-daily-missions-390.png'});
 assert.ok(await page.locator('.farm-daily-mission').last().evaluate(n=>n.getBoundingClientRect().bottom<=document.querySelector('.farm-daily-body').getBoundingClientRect().bottom),'all three mission rows fit without cropping');
 await page.getByRole('tab',{name:'每日簽到',exact:true}).click();
 // A delayed claim can be closed safely; multiple clicks must not duplicate the award.
 holdClaim=true;await page.locator('.farm-daily-claim').click();
 assert.equal(await page.locator('.farm-daily-claim').isDisabled(),true);
 await page.locator('.farm-daily-close').click();
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').input.enabled),true);
 while(!releaseClaim)await new Promise(r=>setTimeout(r,10));releaseClaim();
 await page.waitForFunction(()=>document.querySelector('.farm-daily-status').textContent.includes('領取成功'));
 assert.equal((await backend.db.doc('groups/dragon-test/users/self').get()).data().farm.coins,250);
 await tasks.click();await page.waitForFunction(()=>document.querySelector('.farm-daily-claim').textContent==='今日已領取');
 assert.equal(await page.evaluate(()=>__farmGame.registry.get('myFarmData').coins),250);
 await page.evaluate(()=>window.__cachedDailyCard=document.querySelector('.farm-daily-card'));
 await page.keyboard.press('Escape');assert.equal(await page.locator('.farm-daily-overlay').isVisible(),false);
 const beforeFastReopen=statusRequests;
 await tasks.click();assert.equal(await page.evaluate(()=>window.__cachedDailyCard===document.querySelector('.farm-daily-card')),true,'same-view warm reopen retains image nodes');
 assert.equal(statusRequests,beforeFastReopen,'fresh warm reopening does not repeat the status API');
 await page.locator('.farm-daily-close').click();
 // Rapid close and reopen must not strand the UI behind an obsolete load lock.
 holdStatus=true;await page.evaluate(()=>__farmGame.events.emit('dailyChallengeChanged'));await tasks.click();while(!releaseStatus)await new Promise(r=>setTimeout(r,10));
 await page.locator('.farm-daily-close').click();await tasks.click();releaseStatus();
 await page.waitForFunction(()=>document.querySelector('.farm-daily-claim').textContent==='今日已領取');
 await page.locator('.farm-daily-close').click();failStatus=true;await page.evaluate(()=>__farmGame.events.emit('dailyChallengeChanged'));await tasks.click();
 await page.waitForFunction(()=>document.querySelector('.farm-daily-status').textContent.includes('測試網路中斷'));
 assert.equal(await page.locator('.farm-daily-claim').isDisabled(),true);
 failStatus=false;await page.locator('.farm-daily-retry').click();await page.waitForFunction(()=>document.querySelector('.farm-daily-claim').textContent==='今日已領取');
 // Confirm persistence across reload and expose actual day 7 from server-owned test history.
 await page.locator('.farm-daily-close').click();
 for(let day=2;day<=6;day++){
  backend.clock(start+(day-1)*86400000);const s=await backend.service.dailyChallenges(req('status')),c=s.challenges.checkin;
  await backend.service.dailyChallenges(req('claim',{type:'checkin',dateKey:s.dateKey,cycleId:c.cycleId,day:c.day,requestId:require('crypto').randomUUID()}));
 }
 backend.clock(start+6*86400000);
 holdStatus=true;releaseStatus=null;
 await page.reload();await page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&__farmGame.registry.get('farmLoadState')?.phase==='ready');
 while(!releaseStatus)await new Promise(r=>setTimeout(r,10));
 assert.equal(await page.locator('.farm-daily-overlay').isVisible(),false,'background status starts before the panel opens');
 const backgroundCount=statusRequests;
 await page.locator('.farm-hud-side button[aria-label="每日任務"]').click();
 assert.equal(statusRequests,backgroundCount,'opening shares the pending background request');
 assert.equal(await page.locator('.farm-daily-card').count(),7,'preview is visible before the new page authenticates');
 assert.equal(await page.locator('.farm-daily-claim').isDisabled(),true,'preview cannot authorize a claim');
 await page.screenshot({path:'/tmp/gugu-daily-cached-preview-390.png'});
 while(!releaseStatus)await new Promise(r=>setTimeout(r,10));releaseStatus();
 await page.waitForFunction(()=>!document.querySelector('.farm-daily-claim').disabled);
 assert.equal(await page.locator('.farm-daily-card[data-today=true] h3').innerText(),'第 7 天');
 await page.screenshot({path:'/tmp/gugu-daily-day7-390.png'});
 // Encounter/start of visit closes the modal and releases all prior input locks.
 await page.evaluate(()=>{__farmGame.scene.getScene('MyFarmScene').preparingEncounter=true;});
 await page.waitForFunction(()=>document.querySelector('.farm-daily-overlay').hidden);
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').input.enabled),true);
 await page.evaluate(()=>{__farmGame.scene.getScene('MyFarmScene').preparingEncounter=false;});
 // Layout-only example uses the server event consumer with TEST-ONLY producers.
 // No production producer/config or client-side progress mutation is introduced.
 const testIdentity=async()=>({uid:'self',accountId:'self',groupId:'dragon-test'});
 layoutService=createDailyChallenges({db:backend.db,now:()=>backend.now(),player:testIdentity,playerSession:testIdentity,throttle:async()=>{},verifiedProducers:Object.fromEntries(DEFAULT_CONFIG.mission.tasks.map(t=>[t.type,'isolated-layout-test']))});
 const event=async(id,type)=>{
  await backend.db.doc('ops_verified_farm_events/'+id).set({uid:'self',accountId:'self',groupId:'dragon-test',producer:'isolated-layout-test',type,success:true,occurredAt:backend.now(),collected:20,targetAccountId:'neighbor'});
  await layoutService.consumeVerifiedEvent(id);
 };
 const layoutStart=backend.now();
 for(let day=1;day<=2;day++){
  backend.clock(layoutStart+(day-1)*86400000);
  for(const task of DEFAULT_CONFIG.mission.tasks)for(let i=0;i<3;i++)await event(`layout-${day}-${task.type}-${i}`,task.type);
  const s=await layoutService.handle(req('status')),c=s.challenges.mission;
  await layoutService.handle(req('claim',{type:'mission',dateKey:s.dateKey,cycleId:c.cycleId,day:c.day,requestId:require('crypto').randomUUID()}));
 }
 backend.clock(layoutStart+2*86400000);
 for(let i=0;i<3;i++)await event('layout-third-egg-'+i,'COLLECT_EGG_ACTION');
 for(let i=0;i<2;i++)await event('layout-third-clean-'+i,'HELP_CLEAN_OTHER');
 await page.evaluate(()=>__farmGame.events.emit('dailyChallengeChanged'));
 await page.locator('.farm-hud-side button[aria-label="每日任務"]').click();
 await page.getByRole('tab',{name:'每日任務',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.farm-daily-count')?.textContent==='3/3');
 assert.deepEqual(await page.locator('.farm-daily-count').allTextContents(),['3/3','2/3','0/3']);
 assert.match(await page.locator('.farm-daily-task-day').innerText(),/第 3 天任務/);
 for(const width of [320,390,430,768]){
  await page.setViewportSize({width,height:width===768?1024:844});
  const overlaps=await page.locator('.farm-daily-mission').evaluateAll(rows=>rows.some(row=>{
   const icon=row.querySelector('.farm-daily-task-icon').getBoundingClientRect(),info=row.querySelector('.farm-daily-task-info').getBoundingClientRect(),bar=row.querySelector('.farm-daily-progress').getBoundingClientRect(),count=row.querySelector('.farm-daily-count').getBoundingClientRect(),mark=row.querySelector('.farm-daily-task-completed').getBoundingClientRect();
   return icon.right>info.left+1||bar.right>count.left+1||count.right>mark.left+1;
  }));assert.equal(overlaps,false,'no row collisions at '+width);
  await page.screenshot({path:`/tmp/gugu-daily-missions-layout-example-${width}.png`});
 }
 await page.evaluate(()=>__farmGame.destroy(true));await page.waitForFunction(()=>!document.querySelector('.farm-daily-overlay'));
 assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);
 console.log('PASS: supplied PNGs in real Phaser, existing single HUD entry, two tabs, seven rewards, truthful mission block, atomic check-in/UI balance sync, pending claim close, obsolete-read recovery, network retry, server day 7 persistence, 320/390/430/768 layout, completed/partial/empty mission rows and non-overlapping progress/count/markers; persisted read-only previews, background warmup, shared requests and retained art nodes; encounter and destroy cleanup.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
