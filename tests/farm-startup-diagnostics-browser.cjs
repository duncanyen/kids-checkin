// 真實 HTML/entry/loading UI；失敗注入在隔離 module，不連正式 Firebase。
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8032';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(()=>{window.Phaser={};});
  await context.route('**/js/farm/constants.js',r=>r.fulfill({contentType:'text/javascript',body:'window.Phaser={};'}));
  await context.route('**/js/farm/main.js',r=>r.fulfill({contentType:'text/javascript',body:`throw Object.assign(new TypeError('Cannot read properties of null (reading cut)'),{code:'isolated-startup'});`}));
  const page=await context.newPage(),alerts=[],logs=[];
  page.on('dialog',async d=>{alerts.push(d.message());await d.dismiss();});
  page.on('console',m=>{if(m.type()==='error')logs.push(m.text());});
  await page.goto(base+'/farmgame.html');await page.waitForFunction(()=>document.getElementById('farm-startup-error-details'));
  await page.waitForTimeout(100);assert.equal(alerts.length,1);assert.match(alerts[0],/game-module/);assert.match(alerts[0],/Cannot read properties/);assert.match(alerts[0],/isolated-startup/);assert.match(alerts[0],/main.js/);
  assert.ok(logs.some(x=>x.includes('farm-startup-failure')));assert.match(await page.locator('#farm-startup-error-details').textContent(),/Cannot read properties/);
  assert.equal(await page.locator('[data-loading-retry]').isVisible(),true);
  await page.screenshot({path:'/tmp/gugu-startup-error-390.png'});
  // 確認 alert 關閉後詳細資訊仍可截圖，重複回報同錯誤不會再跳。
  await page.evaluate(()=>{const e=Error('repeat');farmStartupDiagnostics.report(e);farmStartupDiagnostics.report(e);});await page.waitForTimeout(100);assert.equal(alerts.length,2);
  // 正常完成後停止捕捉，不影響遊戲中的一般 runtime 錯誤提示。
  await page.evaluate(async()=>{const {farmLoading}=await import('/js/farm/loading-ui.js');farmLoading.complete(true);farmStartupDiagnostics.report(Error('after ready'));});await page.waitForTimeout(50);assert.equal(alerts.length,2);assert.equal(await page.locator('#farm-startup-error-details').count(),0);
  await context.close();
  console.log('PASS startup module failure: one native alert with stage/code/stack, existing Console and retry preserved, persistent mobile details and deduplication, no alerts after ready');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
