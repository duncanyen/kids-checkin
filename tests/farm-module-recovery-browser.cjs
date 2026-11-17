// Exercise the real farm HTML and entry in a browser, with isolated module responses.
const assert=require('node:assert/strict'),{chromium}=require('playwright');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8032';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(const scenario of ['root','dependency','persistent','initialization','storage-blocked']){
   const context=await browser.newContext({viewport:{width:390,height:844}});
   await context.addInitScript(blocked=>{
    window.Phaser={};
    if(blocked)Object.defineProperty(window,'sessionStorage',{get(){throw Error('blocked');}});
   },scenario==='storage-blocked');
   await context.route('**/js/farm/constants.js',r=>r.fulfill({contentType:'text/javascript',body:'export const ready=true;'}));
   let documents=0,roots=0,dependencies=0;const alerts=[];
   await context.route('**/js/farm/main.js*',r=>{
    roots++;
    const retry=new URL(r.request().url()).searchParams.has('_farm_module_retry');
    if(scenario==='persistent'||(['root','storage-blocked'].includes(scenario)&&!retry))return r.abort('failed');
    if(scenario==='initialization')return r.fulfill({contentType:'text/javascript',body:"throw new TypeError('Cannot read properties of null (reading cut)');"});
    return r.fulfill({contentType:'text/javascript',body:(scenario==='dependency'?"import './recovery-test-dependency.js';\n":'')+"window.__gameInitializations=(window.__gameInitializations||0)+1;"});
   });
   await context.route('**/js/farm/recovery-test-dependency.js',r=>{
    dependencies++;
    return dependencies===1?r.abort('failed'):r.fulfill({contentType:'text/javascript',body:'export const loaded=true;'});
   });
   const page=await context.newPage();
   page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())documents++;});
   page.on('dialog',async d=>{alerts.push(d.message());await d.dismiss();});
   await page.goto(base+'/farmgame.html?group=keep-me');
   if(['persistent','initialization'].includes(scenario)){
    await page.waitForFunction(()=>document.querySelector('#farm-startup-error-details'));
    await page.waitForTimeout(150);
    assert.equal(documents,scenario==='persistent'?2:1);
    assert.equal(alerts.length,1);
    assert.equal(await page.evaluate(()=>window.__gameInitializations||0),0);
    assert.equal(await page.locator('[data-loading-retry]').isVisible(),true);
   }else{
    await page.waitForFunction(()=>window.__gameInitializations===1&&!location.search.includes('_farm_module_retry'));
    assert.equal(documents,2);assert.equal(roots,2);assert.equal(alerts.length,0);
    assert.equal(new URL(page.url()).searchParams.get('group'),'keep-me');
    if(scenario==='dependency')assert.equal(dependencies,2);
    // Removing the URL marker after success must not permit another automatic loop.
    if(scenario!=='storage-blocked'){
     await context.unroute('**/js/farm/main.js*');
     await context.route('**/js/farm/main.js*',r=>r.abort('failed'));
     await page.reload();await page.waitForFunction(()=>document.querySelector('#farm-startup-error-details'));
     assert.equal(documents,3);
    }
   }
   console.log('PASS module recovery:',scenario);
   await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
