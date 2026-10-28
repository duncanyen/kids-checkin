const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const serverFactory=require('./helpers/navigation-performance-server.cjs');
(async()=>{
 const baseline=process.env.BASELINE==='1';process.env.BASELINE_REF='963e5eb';
 const server=await serverFactory({baseline,overrides:{__sdk:fs.readFileSync('tests/fixtures/gallery-performance-sdk.js','utf8')}});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const results=[];
 try{
 for(const count of (process.env.COUNTS?process.env.COUNTS.split(',').map(Number):[10,100,500,1000])){
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 await context.addInitScript(({count,delay,commentCount})=>{
 const user={accountId:'alice',name:'Alice',role:'parent'};
 sessionStorage.setItem('familyCheckInUser',JSON.stringify(user));localStorage.setItem('lastGroupId','A');
 window.__perfStore={};window.__perfOperations=[];window.__perfDataDelay=1;
 for(let i=0;i<count;i++)window.__perfStore['photos/p'+String(i).padStart(4,'0')]={groupId:'A',timestamp:1700000000000-i*1000,uploader:'Alice',caption:'Post '+i,imageUrls:['/__avatar.svg?image='+i],likes:[],comments:Array.from({length:commentCount},(_,j)=>({sender:'Alice',timestamp:1700000000000+j,text:'hello '+j}))};
 window.__perfStore['photos/foreign']={groupId:'B',timestamp:1800000000000,uploader:'Other',imageUrls:[],comments:[]};
 window.__galleryTest={reads:0,requests:0,listeners:new Set(),delay,fail:false,observers:new Set(),emit(){for(const fn of this.listeners)fn();}};
 window.IntersectionObserver=class {constructor(cb){this.cb=cb;}observe(){__galleryTest.observers.add(this);}disconnect(){__galleryTest.observers.delete(this);}};
 window.__firstCards=null;new MutationObserver(()=>{if(window.__firstCards===null&&document.querySelector('.photo-card'))window.__firstCards=performance.now();}).observe(document,{childList:true,subtree:true});
 window.__longTasks=[];new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
 },{count,delay:process.env.SLOW==='1'?180:20,commentCount:Number(process.env.COMMENTS||1)});
 const page=await context.newPage();let imageRequests=0;page.on('request',r=>{if(r.url().includes('image='))imageRequests++;});page.on('dialog',d=>d.accept());const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});await cdp.send('Performance.enable');
 await page.goto(server.base+'/gallery.html',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('.photo-card');await page.waitForTimeout(process.env.SLOW==='1'?240:100);
 const initial=await page.evaluate(()=>({cards:document.querySelectorAll('.photo-card').length,nodes:document.getElementById('feedContainer').querySelectorAll('*').length,reads:__galleryTest.reads,requests:__galleryTest.requests,listeners:__galleryTest.listeners.size,images:performance.getEntriesByType('resource').filter(r=>r.name.includes('image=')).length,longTasks:__longTasks,first:window.__firstCards,dcl:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd}));
 initial.imageRequests=imageRequests;
 const metrics=(await cdp.send('Performance.getMetrics')).metrics;
 initial.jsMs=metrics.find(x=>x.name==='ScriptDuration').value*1000;initial.heapBytes=metrics.find(x=>x.name==='JSHeapUsedSize').value;initial.taskMs=metrics.find(x=>x.name==='TaskDuration').value*1000;initial.layoutMs=metrics.find(x=>x.name==='LayoutDuration').value*1000;
 assert.equal(initial.cards,baseline?count:Math.min(15,count));assert.equal(await page.getByText('Other',{exact:true}).count(),0);
 // Preserve identities and drafts when an unrelated interaction updates snapshots.
 await page.evaluate(()=>{window.__image=document.querySelector('.card-image');window.__comment=document.querySelector('.comment-item');document.querySelector('.comment-input').value='draft';window.__galleryStart=performance.now();});
 await page.evaluate(()=>toggleLike('p0000',false));await page.waitForTimeout(100);
 const interaction=await page.evaluate(()=>({sameImage:__image===document.querySelector('.card-image'),sameComment:__comment===document.querySelector('.comment-item'),draft:document.querySelector('.comment-input').value}));
 if(process.env.BENCH==='1'){results.push({count,initial,interaction});await context.close();continue;}
 let nextPageReads=null;
 if(count===10){
 for(let i=0;i<10;i++){
 await page.evaluate(async i=>{await toggleLike('p0000',i%2===0);document.getElementById('input-p0000').value='reply '+i;await submitComment('p0000');},i);
 await page.waitForTimeout(process.env.SLOW==='1'?240:50);
 }
 assert.equal(await page.evaluate(()=>__perfStore['photos/p0000'].comments.length),Number(process.env.COMMENTS||1)+10);
 }
 if(!baseline && count===10){
 await page.evaluate(async()=>{__perfStore['photos/p0000'].comments.push({sender:'Bob',timestamp:1900000000000,text:'concurrent'});await deleteComment('p0000',0);});
 assert.equal(await page.evaluate(()=>__perfStore['photos/p0000'].comments.some(c=>c.text==='concurrent')),true);
 }
 if(!baseline){assert.equal(interaction.sameImage,true);assert.equal(interaction.sameComment,true);assert.equal(interaction.draft,'draft');
 // Rapid triggers must share exactly one request.
 if(count>15){const n=await page.evaluate(()=>__galleryTest.requests), previousReads=await page.evaluate(()=>__galleryTest.reads);await page.evaluate(()=>{for(let i=0;i<20;i++)for(const o of __galleryTest.observers)o.cb([{isIntersecting:true}]);});await page.waitForFunction(()=>document.querySelectorAll('.photo-card').length===30);assert.equal(await page.evaluate(()=>__galleryTest.requests),n+1);await page.waitForTimeout(process.env.SLOW==='1'?240:100);nextPageReads=await page.evaluate(()=>__galleryTest.reads)-previousReads;assert.equal(nextPageReads,30);}
 if(count===100){
 // Historical interactions remain realtime, equal timestamps use document IDs,
 // deleted cursor documents must not invalidate later pages.
 await page.evaluate(()=>{__perfStore['photos/p0020'].likes=['Alice'];__perfStore['photos/p0019'].timestamp=__perfStore['photos/p0020'].timestamp;__galleryTest.emit();});
 await page.waitForTimeout(300);
 assert.equal(await page.locator('.photo-card').count(),30);
 await page.evaluate(()=>{window.__deleted=__perfStore['photos/p0014'];delete __perfStore['photos/p0014'];__galleryTest.emit();});await page.waitForTimeout(300);
 assert.equal(await page.locator('.photo-card').count(),29);
 await page.evaluate(()=>{__perfStore['photos/p0014']=window.__deleted;__galleryTest.emit();});await page.waitForTimeout(300);
 assert.equal(await page.locator('.photo-card').count(),30);
 // Partial cache snapshots cannot erase previously confirmed cards.
 await page.evaluate(()=>{window.__cached=__perfStore['photos/p0001'];delete __perfStore['photos/p0001'];__galleryTest.cache=true;__galleryTest.emit();});await page.waitForTimeout(300);
 assert.equal(await page.locator('.photo-card').count(),30);
 await page.evaluate(()=>{__galleryTest.cache=false;__galleryTest.emit();});await page.waitForTimeout(300);
 assert.equal(await page.locator('.photo-card').count(),29);
 await page.evaluate(()=>{__perfStore['photos/p0001']=window.__cached;__galleryTest.emit();});await page.waitForTimeout(300);
 // A failed next-page fetch preserves existing content and offers a retry.
 await page.evaluate(()=>__galleryTest.fail=true);await page.locator('.gallery-paging button').click();
 await page.waitForFunction(()=>document.querySelector('.gallery-paging button').textContent.includes('失敗'));
 assert.equal(await page.locator('.photo-card').count(),30);
 }
 // New posts, stable ordering and real-time historical updates.
 await page.evaluate(()=>{for(let i=0;i<3;i++)__perfStore['photos/new'+i]={groupId:'A',timestamp:1800000000000+i,uploader:'Alice',caption:'New '+i,imageUrls:[],comments:[],likes:[]};__galleryTest.emit();});
 await page.waitForFunction(()=>document.querySelector('.card-caption')?.textContent==='New 2');
 assert.equal(await page.locator('.photo-card').count(),Math.min(count,30)+3);
 await page.evaluate(()=>{__perfStore['photos/p0000'].comments.push({sender:'Alice',text:'second',timestamp:1700000000001});__galleryTest.emit();});await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>__image.isConnected),true);
 // 20 suspend/resume cycles: no remaining listeners/observers while suspended.
 for(let i=0;i<20;i++){
 await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
 assert.deepEqual(await page.evaluate(()=>[__galleryTest.listeners.size,__galleryTest.observers.size]),[0,0]);
 await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 }
 assert.equal(await page.evaluate(()=>__galleryTest.listeners.size),count>15?2:1);
 // No history page is fetched again on restore.
 const requests=await page.evaluate(()=>__galleryTest.requests);assert.equal(requests,count===100?3:count>15?2:1);
 // Exhaust all pages; final empty page terminates requests, no duplicate IDs.
 while(await page.locator('.gallery-paging button').isEnabled()){
 await page.locator('.gallery-paging button').click();await page.waitForTimeout(250);
 }
 assert.equal(await page.locator('.photo-card').count(),count+3);
 const finalRequests=await page.evaluate(()=>__galleryTest.requests);
 await page.evaluate(()=>{for(const o of __galleryTest.observers)o.cb([{isIntersecting:true}]);});await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>__galleryTest.requests),finalRequests);
 }
 assert.deepEqual(errors,[]);
 results.push({count,initial,interaction,nextPageReads});await context.close();
 }
 const output={baseline,comments:Number(process.env.COMMENTS||1),slow:process.env.SLOW==='1',results};fs.writeFileSync(process.env.OUTPUT||'/tmp/gallery-phase4.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
