// Actual MPA navigation timing with HTTP cache enabled, isolated Firebase, real Chart.js.
// Download Chart once as documented; no npm dependencies added to the application.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const startServer=require('./helpers/navigation-performance-server.cjs');
const baseline=process.env.BASELINE==='1';
const routes=[['index.html','chat.html','chat'],['chat.html','calendar.html','calendar'],['calendar.html','expense.html','finance'],['expense.html','index.html','home'],['index.html','gallery.html','photodump'],['gallery.html','index.html','home']];
const user={accountId:'alice',name:'Alice',avatar:'Nexus.png',role:'parent',docId:'a',menus:['chat','calendar','finance','photodump','todo','food','gamezone','wishlist','checkin']};
const month=new Date().toISOString().slice(0,7);
const store={
 'users/a':user,'users/b':{accountId:'bob',name:'Bob',avatar:'Nexus.png',role:'child'},
 'groups/A':{name:'Group A',members:['alice','bob']},
 'userSettings/alice':{accountId:'alice',navigation:{items:['chat','calendar','finance','photodump','food','todo']},order:['chat','finance','photodump'],modules:{todo:false}},
 'rooms/r':{groupId:'A',name:'Test room',participants:['Alice','Bob'],participantAccountIds:['alice','bob'],lastMessage:'Bob: Hello',unreadCount:{Alice:0}},
 'events/e':{groupId:'A',date:month+'-15',title:'Test event',visibility:'public',operator:'Alice',isAllDay:true},
 'expenses/e':{groupId:'A',accountId:'alice',operator:'Alice',date:month+'-01',type:'expense',category:'早餐',amount:125},
 'photos/p':{groupId:'A',uploader:'Alice',imageUrls:['Nexus.png'],caption:'Test photo',likes:[],comments:[]}
};
function ready(file){return `(()=>{const f=${JSON.stringify(file)};if(!document.querySelector('.app-bottom-navigation'))return false;return f==='index.html'?document.getElementById('dashboardView')?.style.display==='block'&&document.getElementById('loadingView')?.style.display==='none':f==='chat.html'?!!window.chatRooms:f==='calendar.html'?document.getElementById('calendarTitle')?.textContent.includes('年'):f==='expense.html'?typeof window.changeMonth==='function':typeof window.openPhotoViewer==='function';})()`;}
function dataReady(file){return `(()=>{const f=${JSON.stringify(file)};return f==='index.html'?document.querySelector('.carousel-item')&&document.getElementById('financeWidgetValue')?.textContent.includes('125'):f==='chat.html'?document.querySelector('.room-item'):f==='calendar.html'?document.querySelector('.event-badge'):f==='expense.html'?document.getElementById('monthTotalExpense')?.textContent==='$125':document.querySelector('.photo-card');})()`;}

async function finishTrace(cdp){
 const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
 await cdp.send('Tracing.end');const {stream}=await complete;let text='';
 for(;;){const chunk=await cdp.send('IO.read',{handle:stream});text+=chunk.data;if(chunk.eof)break;}
 await cdp.send('IO.close',{handle:stream});
 const events=JSON.parse(text).traceEvents;
 const threads=new Set(events.filter(e=>e.name==='thread_name'&&e.args?.name==='CrRendererMain').map(e=>e.pid+':'+e.tid));
 const names=new Set(['EvaluateScript','EvaluateModule','FunctionCall','RunMicrotasks','V8.Execute','v8.compile']);
 const spans=events.filter(e=>e.ph==='X'&&typeof e.dur==='number'&&threads.has(e.pid+':'+e.tid)&&names.has(e.name)).map(e=>[e.ts,e.ts+e.dur]).sort((a,b)=>a[0]-b[0]);
 let total=0,end=-Infinity;
 for(const [start,stop]of spans){total+=Math.max(0,stop-Math.max(start,end));end=Math.max(end,stop);}
 return {scriptMainThreadMs:spans.length?total/1000:null,scriptTraceSpans:spans.length};
}

(async()=>{
 const server=await startServer({baseline});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],args:['--no-sandbox','--enable-features=BackForwardCache']});
 const results=[],errors=[];
 try{
  for(const network of ['normal','slow'])for(const cache of ['cold','warm']){
   if(process.env.QUICK==='1'&&(network==='slow'||cache==='cold'))continue;
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
   await context.addInitScript(({user,store,network})=>{
    if(!sessionStorage.getItem('familyCheckInUser'))sessionStorage.setItem('familyCheckInUser',JSON.stringify(user));
    sessionStorage.setItem('nexus_active_group_id','A');localStorage.setItem('lastGroupId','A');
    localStorage.setItem('nexus.navigation.v1:alice',JSON.stringify({items:['chat','calendar','finance','photodump','food','todo']}));
    window.__perfStore=store;window.__perfOperations=[];window.__perfDataDelay=network==='slow'?180:60;
    window.__perfDocument=crypto.randomUUID();window.__perfNavReady=null;window.__perfLayoutShifts=[];
    window.__perfUIReady=null;window.__perfDataReady=null;
    document.addEventListener('click',e=>{if(e.target.closest?.('.app-nav-link'))sessionStorage.setItem('__perfClickAt',String(performance.timeOrigin+performance.now()));},true);
    function probe(){
     const f=location.pathname.split('/').at(-1),bar=document.querySelector('.app-bottom-navigation');
     const visible=bar&&!bar.hidden&&bar.getClientRects().length;
     const ui=visible&&(f==='index.html'?document.getElementById('dashboardView')?.style.display==='block'&&document.getElementById('loadingView')?.style.display==='none':f==='chat.html'?!!window.chatRooms:f==='calendar.html'?document.getElementById('calendarTitle')?.textContent.includes('年'):f==='expense.html'?typeof window.changeMonth==='function':typeof window.openPhotoViewer==='function');
     const data=f==='index.html'?document.querySelector('.carousel-item')&&document.getElementById('financeWidgetValue')?.textContent.includes('125'):f==='chat.html'?document.querySelector('.room-item'):f==='calendar.html'?document.querySelector('.event-badge'):f==='expense.html'?document.getElementById('monthTotalExpense')?.textContent==='$125':document.querySelector('.photo-card');
     if(ui&&window.__perfUIReady===null)window.__perfUIReady=performance.now();
     if(data&&window.__perfDataReady===null)window.__perfDataReady=performance.now();
     if(window.__perfUIReady===null||window.__perfDataReady===null)requestAnimationFrame(probe);
    }
    requestAnimationFrame(probe);
    const observer=new MutationObserver(()=>{if(document.querySelector('.app-bottom-navigation')?.getClientRects().length&&!document.querySelector('.app-bottom-navigation').hidden){window.__perfNavReady=performance.now();observer.disconnect();}});observer.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','style']});
    new PerformanceObserver(list=>{for(const e of list.getEntries())window.__perfLayoutShifts.push({value:e.value,hadRecentInput:e.hadRecentInput,sources:e.sources.map(s=>({node:s.node?.id||s.node?.className||s.node?.nodeName,previous:s.previousRect.toJSON(),current:s.currentRect.toJSON()}))});}).observe({type:'layout-shift',buffered:true});window.__perfPageShows=[];window.addEventListener('pageshow',e=>__perfPageShows.push({persisted:e.persisted,time:performance.now()}));
   },{user,store,network});
   const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Performance.enable');
   await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:network==='slow'?140:30,downloadThroughput:network==='slow'?200*1024:2*1024*1024,uploadThroughput:1024*1024});
   let responses=[];cdp.on('Network.responseReceived',e=>responses.push({url:e.response.url,type:e.type,fromDiskCache:e.response.fromDiskCache,fromPrefetchCache:e.response.fromPrefetchCache,fromServiceWorker:e.response.fromServiceWorker}));
   async function open(file){await page.goto(server.base+'/'+file+'?nav=1');await page.waitForFunction(ready(file));await page.waitForFunction(dataReady(file));if(file==='expense.html')await page.waitForFunction(()=>!!window.Chart);}
   async function capture(source,target,feature,label){
    await cdp.send('Tracing.start',{categories:'devtools.timeline,v8',transferMode:'ReturnAsStream'});
    const oldDocument=await page.evaluate(()=>__perfDocument);
    const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const count=server.requests.length;responses=[];
    const start=performance.now();await page.locator(`[data-nav-feature="${feature}"]`).click();
    await page.waitForURL('**/'+target+'?nav=1');await page.waitForFunction(()=>__perfUIReady!==null&&__perfDataReady!==null);
    const {uiReadyMs,dataReadyMs,clickThroughDataReadyMs}=await page.evaluate(()=>({uiReadyMs:__perfUIReady,dataReadyMs:__perfDataReady,clickThroughDataReadyMs:performance.timeOrigin+__perfDataReady-Number(sessionStorage.getItem('__perfClickAt'))}));
    await page.waitForLoadState('load');
    const details=await page.evaluate(()=>{
     const nav=performance.getEntriesByType('navigation')[0],paint=performance.getEntriesByType('paint'),bar=document.querySelector('.app-bottom-navigation').getBoundingClientRect();
     return{document:__perfDocument,navigation:nav.toJSON(),fcp:paint.find(p=>p.name==='first-contentful-paint')?.startTime??null,
      resources:performance.getEntriesByType('resource').map(r=>({name:r.name,initiatorType:r.initiatorType,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize,decodedBodySize:r.decodedBodySize,duration:r.duration})),
      navReadyMs:__perfNavReady,layoutShifts:__perfLayoutShifts,bar:{x:bar.x,y:bar.y,width:bar.width,height:bar.height},operations:__perfOperations,pageShows:__perfPageShows};
    });
    assert.notEqual(details.document,oldDocument,'must remain a full document navigation');
    assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('familyCheckInUser')).accountId),'alice');
    assert.equal(await page.evaluate(()=>localStorage.getItem('lastGroupId')),'A');
    const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const trace=await finishTrace(cdp);
    const record={network,cache,label,source,target,uiReadyMs,dataReadyMs,clickThroughDataReadyMs,...trace,cpuCounters:{before,after},...details,serverRequests:server.requests.slice(count),responses};
    results.push(record);
    console.log(JSON.stringify({network,cache,label,source,target,dcl:details.navigation.domContentLoadedEventEnd,fcp:details.fcp,uiReadyMs,dataReadyMs,requests:record.serverRequests.length}));
   }
   for(const [source,target,feature]of routes){
    if(cache==='warm')await open(target);
    await open(source);
    if(cache==='cold')await cdp.send('Network.clearBrowserCache');
    await capture(source,target,feature,'pair');
   }
   if(network==='normal'&&cache==='warm'){
    await open('index.html');
    const sequence=[['chat.html','chat'],['calendar.html','calendar'],['expense.html','finance'],['gallery.html','photodump'],['index.html','home']];
    let source='index.html';
    for(let i=0;i<20;i++){const [target,feature]=sequence[i%sequence.length];await capture(source,target,feature,'repeat-'+(i+1));source=target;}
    await page.goBack({waitUntil:'commit'});await page.waitForFunction(dataReady('gallery.html'));const back=await page.evaluate(()=>({document:__perfDocument,shows:__perfPageShows,nav:performance.getEntriesByType('navigation')[0].toJSON()}));
    await page.goForward({waitUntil:'commit'});await page.waitForFunction(dataReady('index.html'));const forward=await page.evaluate(()=>({document:__perfDocument,shows:__perfPageShows,nav:performance.getEntriesByType('navigation')[0].toJSON()}));
    results.push({label:'history',back,forward});
   }
   await context.close();
  }
  assert.deepEqual(errors,[]);
  const out=process.env.PERF_OUTPUT||`/tmp/nexus-navigation-${baseline?'baseline':'optimized'}.json`;
  fs.writeFileSync(out,JSON.stringify({mode:baseline?'baseline':'optimized',baselineRef:'55eb456',method:'Actual local HTTP, cache enabled; Firebase memory SDK replacement; real Chart 4.6.1; CDP network shaping; Chromium mobile viewport, not Safari',results,errors},null,2));console.log('PASS '+out);
 }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
