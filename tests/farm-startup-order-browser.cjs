// 實際 entry/loading script，延遲 constants 回應，確認主模組只在常數模組就緒後才開始。
const assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 let release;
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  await context.addInitScript(()=>{window.Phaser={};});
  const gate=new Promise(resolve=>release=resolve);let requested=false,mainRequested=false;
  await context.route('**/js/farm/constants.js',async route=>{requested=true;await gate;await route.fulfill({contentType:'text/javascript',body:'window.__contextReady=true;export const membershipReady=new Promise(()=>{});'});});
  await context.route('**/js/farm/main.js',route=>{mainRequested=true;return route.fulfill({contentType:'text/javascript',body:'if(!window.__contextReady)throw Error("context not ready");window.__mainReady=true;'});});
  const errors=[],alerts=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{alerts.push(d.message());await d.dismiss();});
  await page.goto((process.env.FARM_BASE_URL||'http://127.0.0.1:8032')+'/farmgame.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(300);assert.equal(requested,true);assert.equal(mainRequested,false,'constants 尚未初始化時不得啟動 main graph');
  release();await page.waitForFunction(()=>window.__mainReady);assert.equal(mainRequested,true);
  assert.deepEqual(errors,[]);assert.deepEqual(alerts,[]);
  console.log('PASS real entry startup order: delayed constants block main module; unresolved membershipReady does not block public module initialization');
 }finally{release?.();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
