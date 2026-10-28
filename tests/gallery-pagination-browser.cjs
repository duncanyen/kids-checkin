const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const start=require('./helpers/navigation-performance-server.cjs');
(async()=>{
 const server=await start({overrides:{'phase4-leave.html':'<!doctype html><title>Isolated navigation target</title>',__sdk:fs.readFileSync('tests/fixtures/gallery-performance-sdk.js','utf8')}});
 const browser=await chromium.launch({ignoreDefaultArgs:['--disable-back-forward-cache'],executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(()=>{
 window.__pageInstance=crypto.randomUUID();
 const user={accountId:'alice',name:'Alice',role:'parent'};
 sessionStorage.setItem('familyCheckInUser',JSON.stringify(user));localStorage.setItem('lastGroupId','A');
 window.__perfStore={};window.__perfOperations=[];window.__perfDataDelay=1;
 window.__galleryTest={reads:0,requests:0,listeners:new Set(),delay:80,fail:false,emit(){for(const f of this.listeners)f();}};
 const NativeObserver=IntersectionObserver;
 window.__observers=new Set();
 window.IntersectionObserver=class extends NativeObserver {observe(el){__observers.add(this);super.observe(el);}disconnect(){__observers.delete(this);super.disconnect();}};
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
 await page.goto(server.base+'/gallery.html');await page.waitForFunction(()=>document.querySelector('.gallery-paging button')?.disabled&&document.getElementById('feedContainer').textContent.includes('空空'));
 // Empty group remains realtime without generating duplicate history requests.
 await page.evaluate(()=>{for(let i=0;i<35;i++)__perfStore['photos/p'+i.toString().padStart(3,'0')]={groupId:'A',timestamp:1700000000000-i,uploader:'Alice',imageUrls:['/__avatar.svg'],likes:[],comments:[]};__galleryTest.emit();});
 await page.waitForFunction(()=>document.querySelectorAll('.photo-card').length===35);
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.photo-card').length===0); // isolated store resets with each document
 // Seed a fresh document through an init script, then use the real browser observer.
 await context.addInitScript(()=>{for(let i=0;i<35;i++)__perfStore['photos/p'+i.toString().padStart(3,'0')]={groupId:'A',timestamp:1700000000000-i,uploader:'Alice',imageUrls:['/__avatar.svg'],likes:[],comments:[]};});
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.photo-card').length===15);
 for(let i=0;i<2;i++){
 await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
 await page.waitForFunction(n=>document.querySelectorAll('.photo-card').length===n,i===0?30:35);
 }
 assert.equal(await page.evaluate(()=>__galleryTest.requests),3);
 // Each restored document releases old subscriptions/observer before resuming.
 const expectedListeners=await page.evaluate(()=>__galleryTest.listeners.size);
 for(let i=0;i<20;i++){
 await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
 assert.deepEqual(await page.evaluate(()=>[__galleryTest.listeners.size,__observers.size]),[0,0]);
 await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 assert.equal(await page.evaluate(()=>__galleryTest.listeners.size),expectedListeners);
 }
 // Drawing stickers no longer leave window handlers after clearing the board.
 const object=(await cdp.send('Runtime.evaluate',{expression:'window'})).result.objectId;
 const handlers=async()=> (await cdp.send('DOMDebugger.getEventListeners',{objectId:object})).listeners.filter(l=>['mousemove','touchmove','mouseup','touchend'].includes(l.type)).length;
 const before=await handlers();
 await page.evaluate(()=>{for(let i=0;i<20;i++){openDrawingBoard();addSticker('⭐');clearDraw();}document.getElementById('drawingBoardModal').style.display='none';});
 assert.equal(await handlers(),before);
 // Actual MPA document navigation and browser back, not only synthetic lifecycle events.
 let restoredDocuments=0;
 for(let i=0;i<20;i++){
 const previousInstance=await page.evaluate(()=>__pageInstance);
 await page.goto(server.base+'/phase4-leave.html');
 await page.goBack({waitUntil:'commit'});
 await page.waitForFunction(()=>document.querySelectorAll('.photo-card').length>=15);
 if(await page.evaluate(()=>__pageInstance)===previousInstance)restoredDocuments++;
 assert.ok(await page.evaluate(()=>__galleryTest.listeners.size<=3));
 assert.equal(await page.evaluate(()=>__observers.size),1);
 }
 // A realtime failure can reconnect even after history is exhausted.
 await page.evaluate(()=>{__galleryTest.failLive=true;__galleryTest.emit();});
 await page.waitForFunction(()=>document.querySelector('.gallery-paging button').textContent.includes('中斷'));
 await page.locator('.gallery-paging button').click();await page.waitForTimeout(250);
 assert.ok(await page.evaluate(()=>__galleryTest.listeners.size>=1));
 // Group change while suspended cannot resume old-group reads.
 await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));localStorage.setItem('lastGroupId','B');dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
 await page.waitForURL('**/index.html');
 assert.deepEqual(errors,[]);
 console.log('Restored same document: '+restoredDocuments+'/20');
 console.log('PASS real IntersectionObserver 15 → 30 → 35; empty realtime; 20 lifecycle, real MPA return and sticker cycles; group-change guard');
 }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
