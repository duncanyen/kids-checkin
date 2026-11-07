// Isolate header/first-paint layout from game and accounting data operations.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FARM_BASE_URL||'http://127.0.0.1:8030';
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{
   sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',name:'小明',menus:['calendar','finance','wishlist']}));
   localStorage.setItem('nexus.appearance.v1:alice',JSON.stringify({theme:'grape'}));
   window.__seenThemes=[];
   addEventListener('nexus-theme-change',event=>window.__seenThemes.push(event.detail.id));
  });
  await context.route(/\/js\/(expense\.js|calendar\.js|todo\.js|games\.js|admin\.js|growth-forest\/main\.js)(\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:''}));
  let releaseCSS;
  const cssGate=new Promise(resolve=>releaseCSS=resolve);
  await context.route('**/css/growth-forest.css',async route=>{await cssGate;await route.continue();});
  const loading=page.goto(base+'/wishwall.html?nav=1');
  await page.waitForFunction(()=>document.documentElement.dataset.nexusTheme==='grape');
  assert.equal(await page.evaluate(()=>document.documentElement.style.backgroundColor),'rgb(24, 20, 33)','saved background applies before forest CSS');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.navigationEntry),'nav');
  releaseCSS();await loading;
  for(const [file,title,selector,actions]of [
   ['expense.html','記帳本','.top-nav .page-title','.btn-settings'],
   ['calendar.html','行事曆','.navigation-page-title','.nav-actions'],
   ['wishwall.html','成長森林','.forest-feature-title','#resourceGuide']
  ]){
   await page.goto(base+'/'+file+'?nav=1');
   await page.waitForSelector(selector+' svg');
   assert.equal((await page.locator(selector).innerText()).trim(),title);
   assert.equal(await page.locator('[data-main-menu-back]').isVisible(),false);
   assert.ok((await page.evaluate(()=>window.__seenThemes)).every(id=>id==='grape'));
   for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:844});
    const name=await page.locator(selector).boundingBox(),buttons=await page.locator(actions).boundingBox();
    assert.ok(name.x<buttons.x&&name.x+name.width<=buttons.x,title+' title stays left of controls');
    assert.ok(Math.abs((name.y+name.height/2)-(buttons.y+buttons.height/2))<3,title+' controls vertically align');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(width===390)await page.screenshot({path:'/tmp/nexus-header-'+file+'.png'});
   }
   if(file==='expense.html'){
    const button=await page.locator('.btn-settings').evaluate(el=>{const s=getComputedStyle(el);return{radius:s.borderRadius,width:el.offsetWidth,height:el.offsetHeight};});
    assert.equal(button.radius,'50%');assert.equal(button.width,44);assert.equal(button.height,44);
   }
   if(file==='calendar.html')assert.equal(await page.locator('.nav-actions button svg').count(),2);
   if(file==='wishwall.html'){
    await page.evaluate(()=>document.body.classList.add('visiting-forest'));
    assert.equal(await page.locator('#forestBack').isVisible(),true);
    assert.equal(await page.locator('#greeting').isVisible(),true);
    assert.equal(await page.locator('.forest-feature-title').isVisible(),false);
   }
   await page.goto(base+'/'+file);
   assert.equal(await page.locator('[data-main-menu-back]').isVisible(),true);
  }
  // Side-menu/direct entry: centered identity with usable return/action controls.
  for(const [file,title]of [['calendar.html','行事曆'],['wishwall.html','成長森林'],['todo.html','待辦事項'],['games.html','遊戲大廳'],['admin.html','管理者後台']]){
   await page.goto(base+'/'+file);
   const heading=page.locator('.feature-header .feature-header-title');
   await heading.locator('svg').waitFor();
   assert.equal((await heading.innerText()).trim(),title);
   if(file==='todo.html'){
    assert.equal(await page.locator('.todo-header').count(),0);
    assert.equal(await page.locator('[data-action="open-recurring"]').count(),0);
   }
   if(file==='games.html')assert.equal(await page.locator('#gameZoneTitle').count(),1);
   for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    const header=await page.locator('.feature-header').boundingBox(),name=await heading.boundingBox(),back=await page.locator('.feature-header-start').boundingBox();
    assert.ok(Math.abs(name.x+name.width/2-(header.x+header.width/2))<2,file+' centered identity');
    assert.ok(name.y>=header.y&&name.y+name.height<=header.y+header.height+1);
    const overlaps=name.x<back.x+back.width&&name.x+name.width>back.x&&name.y<back.y+back.height&&name.y+name.height>back.y;
    assert.equal(overlaps,false,file+' title clears return button');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,file+' overflow');
    if(width===390)await page.screenshot({path:'/tmp/nexus-side-header-'+file+'.png'});
   }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: five centered side-menu headers, removed todo heading/recurring trigger, three navigation headers, circular ledger settings, calendar right controls, forest member return, saved theme before delayed CSS, no default theme events, direct-entry return links, 320/390/1440px layout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
