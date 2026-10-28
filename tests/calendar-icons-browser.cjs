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
  const today=new Date(),date=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  for(const [index,category] of ['school','company','restaurant','birthday','personal','other'].entries())window.__perfStore['events/e'+index]={groupId:'A',title:index===0?'聚會 🎉':'Event '+index,desc:'User note 🌿',date,category,operator:'Alice',visibility:index===0?'private':'public',isAllDay:true,reminderUnit:'minutes',reminderValue:10};
  window.__perfOperations=[];window.__perfDataDelay=60;
 });
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});

 await page.goto(server.base+'/calendar.html?nav=1');
 await page.waitForSelector('#calendarGrid .today');
 assert.equal(await page.locator('#btnToggleView svg.nexus-icon').count(),1);
 assert.equal(await page.locator('#btnSettings svg.nexus-icon').count(),1);
 const navSvg=await page.locator('[data-nav-feature=calendar] svg').getAttribute('stroke-width');
 assert.equal(await page.locator('#btnSettings svg').getAttribute('stroke-width'),navSvg);
 const options=await page.locator('#evCategory option,#evVisibility option').allTextContents();
 assert.ok(options.every(text=>!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)));
 await page.locator('#calendarGrid .today').click();
 await page.waitForSelector('.event-item');
 assert.equal(await page.locator('.event-item').count(),6);
 assert.equal(await page.locator('.event-item-title svg').count(),7,'six category icons and one private lock');
 assert.equal(await page.locator('.event-item-meta svg').count(),12);
 assert.equal(await page.locator('.event-actions .edit svg').count(),6);
 assert.equal(await page.locator('.event-actions .del svg').count(),6);
 assert.ok((await page.locator('.event-item-title').first().textContent()).includes('聚會 🎉'));
 assert.ok((await page.locator('.day-event-list').textContent()).includes('User note 🌿'));
 await page.locator('.event-actions .edit svg').first().click();
 assert.equal(await page.locator('#evTitle').inputValue(),'聚會 🎉');
 await page.locator('#btnCancelForm').click();
 await page.locator('.event-actions .del svg').last().click();
 await page.waitForFunction(()=>__perfOperations.some(op=>op.kind==='deleteDoc'&&op.path.startsWith('events/')));
 await page.locator('#btnCloseModal').click();
 await page.locator('#btnToggleView svg').click();assert.equal(await page.locator('#weekViewContainer').isVisible(),true);
 await page.locator('#btnSettings svg').click();
 assert.deepEqual(errors,[]);
 console.log('PASS calendar SVG toolbar, all six categories, private/time/reminder/actions, native select labels, edit/delete SVG clicks, preserved user emoji, week/settings controls');
 }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
