const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const serverFactory=require('./helpers/navigation-performance-server.cjs');
const mode=process.env.TEST_MODE||'all';
(async()=>{
 const delays={'/__cdn/chart.js':700},failures={},overrides={},gates={};
 const server=await serverFactory({delays,failures,overrides,gates});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  const user={accountId:'alice',name:'Alice',role:'parent',avatar:'Nexus.png',menus:['chat','calendar','finance','photodump','gamezone','todo','food','wishlist']};
  sessionStorage.setItem('familyCheckInUser',JSON.stringify(user));sessionStorage.setItem('nexus_active_group_id','A');localStorage.setItem('lastGroupId','A');
  localStorage.setItem('nexus.navigation.v1:alice',JSON.stringify({items:['chat','calendar','finance','photodump','todo','food']}));
  const month=new Date().toISOString().slice(0,7);
  window.__document=crypto.randomUUID();window.__perfFailPath=sessionStorage.getItem('__testFailPath');
  window.__perfStore={'users/a':user,'users/b':{accountId:'bob',name:'Bob',avatar:'Nexus.png'},'groups/A':{members:['alice','bob'],name:'Group A'},'userSettings/alice':{accountId:'alice',navigation:{items:['chat','calendar','finance','photodump','todo','food']}},'expenses/e':{groupId:'A',date:month+'-01',accountId:'alice',operator:'Alice',type:'expense',amount:125,category:'早餐'},'photos/p':{groupId:'A',uploader:'Alice',uploaderAccountId:'alice',storagePaths:['photo-dump/A/fixture/p/example.jpg'],imageUrls:['Nexus.png'],likes:[],comments:[]},'rooms/r':{groupId:'A',name:'Room',participants:['Alice'],lastMessage:'Hello'}};
  if(sessionStorage.getItem('__testLegacy'))delete window.__perfStore['photos/p'].storagePaths;
  window.__perfOperations=[];window.__perfDataDelay=60;
 });
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
 if(mode==='all'||mode==='chart'){
  delays['/js/expense.js']=500;
  await page.goto(server.base+'/expense.html?nav=1',{waitUntil:'commit'});await page.waitForSelector('#calendarGrid');
  const pendingCalendar=await page.locator('.calendar-card').boundingBox();
  await page.waitForFunction(()=>document.getElementById('monthTotalExpense').textContent==='$125');
  const loadedCalendar=await page.locator('.calendar-card').boundingBox();
  assert.ok(Math.abs(loadedCalendar.height-pendingCalendar.height)<2,'calendar skeleton must preserve actual month height');
  delete delays['/js/expense.js'];
  assert.equal(await page.evaluate(()=>!!window.Chart),false,'slow charts must not block amounts or shell');
  assert.equal(await page.locator('.app-bottom-navigation').count(),1);
  await page.evaluate(()=>{switchChartType('income');switchMainView('review');});
  await page.waitForFunction(()=>!!window.Chart?.getChart(document.getElementById('sixMonthBarChart')));
  assert.equal(await page.evaluate(()=>window.Chart.version),'4.6.1');
  assert.deepEqual(await page.evaluate(()=>Chart.getChart(document.getElementById('expensePieChart')).data.labels),['無紀錄']);
  assert.equal(server.requests.filter(r=>r.path==='/__cdn/chart.js').length,1,'pie and review share one script');
  // A failed CDN can be retried while ledger amounts and navigation remain usable.
  failures['/__cdn/chart.js']=503;
  await cdp.send('Network.clearBrowserCache');
  await page.goto(server.base+'/expense.html?nav=1');
  await page.waitForSelector('#expensePieChartStatus button');
  assert.equal(await page.locator('#monthTotalExpense').innerText(),'$125');
  delete failures['/__cdn/chart.js'];await page.locator('#expensePieChartStatus button').click();
  await page.waitForFunction(()=>!!window.Chart?.getChart(document.getElementById('expensePieChart')));
  assert.ok(await page.locator('#expensePieChartStatus').isHidden());
 }
 if(mode==='all'||mode==='gallery'){
  const start=server.requests.length;
  await page.goto(server.base+'/gallery.html?nav=1');await page.waitForSelector('.photo-card');
  const initial=server.requests.slice(start).map(r=>r.path);
  assert.ok(!initial.some(p=>p.includes('gallery-storage')||/firebase-(auth|functions|storage)/.test(p)),'view must not load upload dependencies');
  await page.locator('#fileInput').setInputFiles(require('node:path').resolve(__dirname,'../Nexus.png'));
  await page.waitForFunction(()=>document.getElementById('uploadModal').style.display==='flex');
  await page.locator('#btnConfirmUpload').click();
  await page.waitForFunction(()=>document.getElementById('uploadModal').style.display==='none');
  assert.ok(await page.evaluate(()=>__perfOperations.some(op=>op.kind==='callable'&&op.path==='photoSession')));
  assert.ok(await page.evaluate(()=>__perfOperations.some(op=>op.kind==='setDoc'&&op.path==='photos/new-photo')));
  const requested=server.requests.slice(start).map(r=>r.path);
  for(const name of ['auth','functions','storage'])assert.equal(requested.filter(p=>p==='/__sdk/firebase-'+name+'.js').length,1);
  // A missing lazy chunk must not delete metadata before file cleanup is available.
  failures['/js/gallery-storage.js']=503;await cdp.send('Network.clearBrowserCache');await page.reload();await page.waitForSelector('.photo-card');
  await page.evaluate(()=>deletePhoto('p'));
  assert.equal(await page.evaluate(()=>__perfOperations.some(op=>op.kind==='deleteDoc')),false);
  delete failures['/js/gallery-storage.js'];
  // Existing cloud-backed deletion uses the same lazy module and group validation.
  await page.evaluate(()=>{__perfStore['photos/p'].storagePaths=['photo-dump/A/fixture/p/example.jpg'];});
  // Snapshot data is immutable in real Firestore: reload to receive the changed fixture.
  await page.reload();await page.waitForSelector('.photo-card');
  await page.evaluate(()=>deletePhoto('p'));
  assert.ok(await page.evaluate(()=>__perfOperations.some(op=>op.kind==='callable'&&op.path==='photoSession')));
  assert.ok(await page.evaluate(()=>__perfOperations.some(op=>op.kind==='deleteDoc'&&op.path==='photos/p')));
  await page.evaluate(()=>sessionStorage.setItem('__testLegacy','1'));await page.reload();await page.waitForSelector('.photo-card');
  await page.evaluate(()=>deletePhoto('p'));
  assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('gallery-storage.js'))),false);
  await page.evaluate(()=>sessionStorage.removeItem('__testLegacy'));
 }
 if(mode==='all'||mode==='navigation'){
  delays['/js/app-navigation.js']=500;
  await cdp.send('Network.clearBrowserCache');
  await page.goto(server.base+'/gallery.html?nav=1',{waitUntil:'commit'});
  await page.waitForSelector('#feedContainer');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.navigationEntry),'nav');
  assert.equal(await page.locator('[data-main-menu-back]').isVisible(),false);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).paddingBottom),'94px');
  assert.equal(await page.locator('.nexus-skeleton').count(),1);
  await page.waitForSelector('.photo-card');delete delays['/js/app-navigation.js'];
  const before=await page.evaluate(()=>({id:__document,ops:__perfOperations.length}));
  await page.locator('[data-nav-feature=photodump]').click();await page.waitForTimeout(120);
  assert.deepEqual(await page.evaluate(()=>({id:__document,ops:__perfOperations.length})),before,'same URL must not reload or query');
  // Cancellation must not leave an incorrect pending indicator.
  await page.evaluate(()=>document.body.addEventListener('click',e=>e.preventDefault(),{once:true}));
  await page.locator('[data-nav-feature=calendar]').click();
  await page.waitForFunction(()=>!document.querySelector('.app-nav-link[aria-busy]'));
  assert.equal(await page.evaluate(()=>__document),before.id);
  // A delayed HTML response leaves the actual old page usable with real feedback.
  let releaseCalendar;gates['/calendar.html']=new Promise(resolve=>releaseCalendar=resolve);
  const feedback=await page.evaluate(()=>{const link=document.querySelector('[data-nav-feature=calendar]');link.click();return{busy:link.getAttribute('aria-busy'),id:__document};});
  assert.equal(feedback.busy,'true');assert.equal(feedback.id,before.id);
  releaseCalendar();delete gates['/calendar.html'];
  await page.waitForURL('**/calendar.html?nav=1');
  await page.waitForFunction(()=>document.getElementById('calendarTitle').textContent.includes('年'));
  const bar=await page.locator('.app-bottom-navigation').boundingBox();assert.equal(bar.width,390);assert.equal(bar.height,70);assert.equal(bar.y,774);
  await page.goBack({waitUntil:'commit'});await page.waitForSelector('.photo-card');
  assert.equal(await page.locator('.app-nav-link[aria-busy]').count(),0);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.nexus-skeleton')||document.body).animationName),'none');
  // Direct entry keeps its return control; the game lobby continues hiding global nav.
  await page.goto(server.base+'/gallery.html');await page.waitForSelector('.photo-card');
  assert.equal(await page.locator('[data-main-menu-back]').isVisible(),true);
  assert.equal(await page.locator('.app-bottom-navigation').count(),0);
 }
 if(mode==='all'||mode==='navigation'){
  await page.evaluate(()=>sessionStorage.setItem('__testFailPath','photos'));
  await page.goto(server.base+'/gallery.html?nav=1');await page.waitForFunction(()=>document.getElementById('feedContainer').textContent.includes('載入失敗'));
  assert.equal(await page.locator('.nexus-skeleton').count(),0);
  await page.evaluate(()=>sessionStorage.setItem('__testFailPath','rooms'));
  await page.goto(server.base+'/chat.html?nav=1');await page.waitForFunction(()=>document.getElementById('roomListContainer').textContent.includes('載入失敗'));
  assert.equal(await page.locator('.nexus-skeleton').count(),0);
  await page.evaluate(()=>sessionStorage.removeItem('__testFailPath'));
 }
 if(mode==='all'||mode==='cache-update'){
  const git=require('node:child_process').execFileSync;
  const old=file=>git('git',['show','55eb456:'+file],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8'});
  overrides['expense.html']=old('expense.html');overrides['js/expense.js']=old('js/expense.js');
  await cdp.send('Network.clearBrowserCache');await page.goto(server.base+'/expense.html?nav=1');
  await page.waitForFunction(()=>!!window.Chart?.getChart(document.getElementById('expensePieChart')));
  delete overrides['expense.html'];delete overrides['js/expense.js'];
  // The old unversioned JS is still fresh in HTTP cache. New HTML must not use it.
  await page.reload();await page.waitForFunction(()=>!!window.Chart?.getChart(document.getElementById('expensePieChart')));
  assert.equal(await page.locator('script[src*="expense.js"]').getAttribute('src'),'js/expense.js?v=navigation3');
  assert.equal(await page.locator('#monthTotalExpense').innerText(),'$125');
  // Conversely, old HTML can still execute new JS while its classic Chart tag exists.
  overrides['expense.html']=old('expense.html');await cdp.send('Network.clearBrowserCache');
  await page.reload();await page.waitForFunction(()=>!!window.Chart?.getChart(document.getElementById('expensePieChart')));
  assert.equal(await page.locator('#monthTotalExpense').innerText(),'$125');delete overrides['expense.html'];
 }
 if(mode==='all'||mode==='calendar'){
  await page.goto(server.base+'/calendar.html?nav=1');await page.waitForSelector('#calendarGrid .day-cell');
  await page.locator('#calendarGrid .day-cell').first().click();
  assert.equal(await page.locator('#eventModal').isVisible(),true);
  await page.locator('#btnShowAddForm').click();await page.locator('#evTitle').fill('Calendar regression');await page.locator('#btnSaveEvent').click();
  await page.waitForFunction(()=>__perfOperations.some(op=>op.kind==='addDoc'&&op.path==='events'));
  await page.locator('#btnCloseModal').click();
  await page.locator('#btnToggleView').click();assert.equal(await page.locator('#weekViewContainer').isVisible(),true);
  assert.equal(await page.locator('.app-bottom-navigation').count(),1);
 }
 if(mode==='all'||mode==='auth'){
  if(mode==='auth')await page.goto(server.base+'/gallery.html');
  await page.evaluate(()=>sessionStorage.setItem('__testFailPath','users'));
  await page.goto(server.base+'/index.html?nav=1');await page.waitForSelector('#authSection.active');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.navigationEntry),undefined);
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('has-app-navigation')),false);
  assert.equal(await page.locator('#bottomDockContainer').isVisible(),false);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS navigation loading: '+mode);
 }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
