// Real page + Phaser + real domain service; all Auth/Firestore transport is isolated.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {MemoryDB}=require('../game-admin/tests/memory-db.cjs'),{createGrowthService}=require('../functions/growth-service.cjs');
require('../scripts/prepare-growth-forest.cjs');
const direct=process.env.GROWTH_DIRECT_BROWSER==='1';
const base=process.env.GROWTH_BASE_URL||'http://127.0.0.1:8030';
(async()=>{
 const db=new MemoryDB(),now=Date.parse('2026-11-05T04:00:00Z');
 await db.doc('users/alice').set({accountId:'alice',name:'小森林',role:'child'});await db.doc('users/parent').set({accountId:'parent',name:'森林家長',role:'parent'});await db.doc('groups/A').set({name:'森林家庭',members:['alice','parent']});
 const service=createGrowthService({db,now:()=>now}),browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const errors=[],network=[];
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Taipei'});
 context.on('request',request=>network.push(request.url()));
 const phaser=fs.existsSync('/tmp/kids-phaser.js')?fs.readFileSync('/tmp/kids-phaser.js','utf8'):execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});fs.writeFileSync('/tmp/kids-phaser.js',phaser);
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 if(!direct){
 await context.route('**/js/growth-forest/client.js',r=>r.fulfill({contentType:'text/javascript',body:`export async function connect(c){return{api:async(action,payload={},mutate=false)=>{const result=await window.__growthCall({accountId:c.accountId,groupId:c.groupId,action,payload,requestId:crypto.randomUUID()});if(result.error)throw Object.assign(Error(result.error.message),{code:result.error.code});return result.data;},subscribe:(_p,refresh)=>{window.__growthRefresh=refresh;return()=>window.__growthRefresh=null;},upload:async()=>{throw Error('No live uploads in isolated test');},close:()=>{}};}`}));
 }else{
  const versions=new Map();
  await context.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const app={},db={};'}));
  await context.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('tests/fixtures/growth-firestore-sdk.js','utf8')}));
  await context.exposeFunction('__webDb',operation=>{
   if(operation.op==='get')return{path:operation.path,data:db.data.has(operation.path)?structuredClone(db.data.get(operation.path)):null,version:versions.get(operation.path)||0};
   if(operation.op==='query'){
    let rows=[...db.data].filter(([path])=>path.startsWith(operation.path+'/')&&path.split('/').length===operation.path.split('/').length+1);
    for(const filter of operation.constraints||[])if(filter.field)rows=rows.filter(([,value])=>filter.op==='in'?filter.value.includes(value[filter.field]):value[filter.field]===filter.value);
    const cap=operation.constraints?.find(f=>f.maximum)?.maximum;rows.sort(([a],[b])=>a.localeCompare(b));if(cap)rows=rows.slice(0,cap);
    return rows.map(([path,data])=>({path,data:structuredClone(data)}));
   }
   if(operation.op==='commit'){
    for(const [path,version]of operation.expected)if((versions.get(path)||0)!==version)throw Error('ABORTED');
    for(const write of operation.writes){if(write.delete)db.data.delete(write.path);else db.data.set(write.path,write.merge?{...db.data.get(write.path),...structuredClone(write.data)}:structuredClone(write.data));versions.set(write.path,(versions.get(write.path)||0)+1);}
    if(operation.writes.length)for(const p of context.pages())p.evaluate(()=>setTimeout(()=>window.__webEmit?.(),0)).catch(()=>{});
    return;
   }
   throw Error('Unexpected Web SDK request');
  });
 }
 await context.exposeFunction('__growthCall',async call=>{
  try{const data=await service.handle({auth:{uid:call.accountId,token:{photoAccountId:call.accountId,photoGroupId:call.groupId}},data:{groupId:call.groupId,action:call.action,payload:call.payload,requestId:call.requestId}});
   if(!['snapshot','list','legacyList','overview'].includes(call.action))for(const p of context.pages())p.evaluate(()=>{setTimeout(()=>window.__growthRefresh?.(),250);}).catch(()=>{});
   return{data};
  }catch(error){return{error:{code:'functions/'+error.code,message:error.message}};}
 });
 async function open(accountId){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(15000);const wait=p.waitForFunction.bind(p);p.waitForFunction=(fn,arg,opts)=>wait(fn,arg,{timeout:15000,...opts});await p.clock.setFixedTime(new Date(now));await p.addInitScript(accountId=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId,name:'舊顯示',role:'child',groupId:'B'}));localStorage.setItem('lastGroupId','A');},accountId);await p.goto(base+'/wishwall.html');await p.waitForFunction(()=>document.querySelector('#pointsBalance').textContent!=='—');return p;}
 const child=await open('alice');await child.waitForSelector('#forestGame canvas');assert.equal(await child.locator('#parentNav').isVisible(),false);assert.match(await child.title(),/成長森林/);assert.equal(await child.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await child.click('[data-plot="0"]');await child.click('[data-plant="sunflower"]');await child.waitForFunction(()=>!document.querySelector('#sheet').open);await child.screenshot({path:'/tmp/nexus-growth-forest-child.png',fullPage:true});
 await child.click('#resourceGuide');assert.ok((await child.locator('#sheetBody').innerText()).includes('家長核准後，三種資源才會一起入帳'));await child.click('#closeSheet');
 await child.click('#openExam');await child.fill('[name=score]','95');
 // Phaser's native canvas listeners must ignore input while a DOM dialog is open.
 await child.evaluate(()=>{const canvas=document.querySelector('#forestGame canvas'),box=canvas.getBoundingClientRect();for(const [x,y]of [[216,573],[564,553],[371,761]]){const init={bubbles:true,clientX:box.left+x/780*box.width,clientY:box.top+y/1000*box.height,button:0,buttons:1};canvas.dispatchEvent(new MouseEvent('mousedown',init));canvas.dispatchEvent(new MouseEvent('mouseup',{...init,buttons:0}));}});
 assert.equal(await child.locator('#sheetTitle').innerText(),'紀錄考試');assert.equal(await child.locator('[name=score]').inputValue(),'95');assert.equal(await child.locator('#waterPlant').count(),0);if(direct)await child.setInputFiles('[name=photo]','Nexus.png');await child.click('#examForm button[type=submit]');await child.waitForFunction(()=>document.querySelector('#status').textContent.includes('等待家長'));assert.equal(await child.locator('#pointsBalance').innerText(),'0');
 console.log('growth: pending exam created');const parent=await open('parent');await parent.click('#parentNav');await parent.locator('[data-record]').first().click();if(direct){await parent.click('#viewPhoto');await parent.waitForFunction(()=>document.querySelector('#photoContainer img')?.naturalWidth>0);assert.equal([...db.data.keys()].filter(path=>path.includes('/growthExamPhotos/')).length,1);}await parent.click('#approveRecord');await parent.waitForFunction(()=>!document.querySelector('#sheet').open);
 await child.waitForFunction(()=>document.querySelector('#pointsBalance').textContent==='100');await child.click('[data-plot="0"]');await child.click('#waterPlant');await child.waitForFunction(()=>document.querySelector('#sheetTitle').textContent==='向日葵'&&document.querySelector('#sheetBody').textContent.includes('10 / 100'));await child.click('#waterPlant');await child.waitForFunction(()=>document.querySelector('#sheetBody').textContent.includes('20 / 100'));await child.click('#closeSheet');
 console.log('growth: exam approved and plant watered');await child.click('#openReading');await child.fill('[name=bookName]','小王子 <img src=x onerror=alert(1)>');await child.fill('[name=readingMinutes]','20');await child.fill('[name=readingPages]','15');await child.click('#readingForm button[type=submit]');await child.waitForFunction(()=>document.querySelector('#pointsBalance').textContent==='110');assert.equal(await child.locator('#coinBalance').innerText(),'15');
 console.log('growth: reading rewarded');await parent.click('[data-parent=settings]');await parent.fill('[name=readingCoins]','300');await parent.click('#settingsForm button[type=submit]');await parent.waitForFunction(()=>!document.querySelector('#settingsForm button[type=submit]').disabled);assert.equal((await db.doc('groups/A/growthSettings/main').get()).data().reading.coins,300);await child.waitForTimeout(500);
 await child.click('#openReading');await child.fill('[name=eventDate]','2026-11-04');await child.fill('[name=bookName]','另一段故事');await child.fill('[name=readingMinutes]','20');await child.click('#readingForm button[type=submit]');await child.waitForFunction(()=>document.querySelector('#coinBalance').textContent==='315');
 await child.click('#seedShop');await child.click('[data-buy=tulip]');await child.click('#buyForm button[type=submit]');await child.waitForFunction(()=>document.querySelector('#coinBalance').textContent==='235');await child.click('[data-plot="1"]');await child.click('[data-plant=tulip]');await child.waitForFunction(()=>!document.querySelector('#sheet').open);
 await child.reload();await child.waitForFunction(()=>document.querySelector('[data-plot="1"]').textContent.includes('鬱金香'));await child.waitForSelector('#forestGame canvas');
 await child.click('[data-view=records]');await child.waitForSelector('[data-record]');assert.equal(await child.locator('#recordList img').count(),0);assert.ok((await child.locator('#recordList').innerText()).includes('<img src=x'));await child.click('#showTransactions');assert.ok((await child.locator('#transactions').innerText()).includes('record')||(await child.locator('#transactions').innerText()).includes('成長獎勵'));await child.click('#closeSheet');
 await child.click('[data-view=forest]');await child.click('#buyPlot');await child.click('#buyPlotForm button[type=submit]');await child.waitForFunction(()=>document.querySelector('#forestPageLabel').textContent.includes('共 4 塊土地')&&document.querySelector('[data-plot="3"]'));
 assert.equal(await child.locator('[data-plot="0"]').count(),0);assert.equal(await child.locator('#coinBalance').innerText(),'135');assert.equal(await child.locator('#waterBalance').innerText(),'15');
 await child.click('#seedShop');await child.click('[data-buy=sunflower]');await child.click('#buyForm button[type=submit]');await child.waitForFunction(()=>!document.querySelector('#sheet').open);
 await child.click('[data-plot="3"]');await child.click('[data-plant=sunflower]');await child.waitForFunction(()=>!document.querySelector('#sheet').open);await child.click('[data-plot="3"]');await child.click('#waterPlant');await child.waitForFunction(()=>document.querySelector('#sheetBody').textContent.includes('10 / 100'));await child.click('#closeSheet');
 await child.reload();await child.waitForFunction(()=>document.querySelector('#forestPageLabel').textContent.includes('共 4 塊土地'));await child.click('#nextForest');await child.waitForSelector('[data-plot="3"]');assert.ok((await child.locator('[data-plot="3"]').innerText()).includes('向日葵'));
 await child.click('#openPlants');await child.click('#plantPrevious');await child.waitForFunction(()=>document.querySelector('#sheetBody').textContent.includes('第 1 / 2 區'));await child.click('[data-open-plot="0"]');assert.equal(await child.locator('#sheetTitle').innerText(),'向日葵');await child.click('#closeSheet');
 await child.click('#buyPlot');assert.equal(await child.locator('#buyPlotForm button[type=submit]').isDisabled(),true);await child.click('#closeSheet');
 console.log('growth: expansion, pagination, new-plot watering, reload and insufficient funds verified');
 await child.click('[data-view=rewards]');await child.locator('[data-reward]').first().click();await child.click('#requestForm button[type=submit]');await child.waitForFunction(()=>!document.querySelector('#sheet').open);
 await parent.click('[data-parent=requests]');await parent.selectOption('[name=parentTarget]','alice');await parent.waitForSelector('[data-request][data-status=completed]');await parent.click('[data-request][data-status=completed]');await parent.fill('[name=reason]','獎品已交付');await parent.click('#reasonForm button[type=submit]');await parent.waitForFunction(()=>!document.querySelector('#sheet').open);
 await parent.setViewportSize({width:1440,height:1000});await parent.click('[data-parent=overview]');await parent.waitForSelector('.summary-grid');await parent.screenshot({path:'/tmp/nexus-growth-forest-parent.png',fullPage:true});
 assert.equal(await parent.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await child.bringToFront();await child.click('[data-view=forest]');await child.screenshot({path:'/tmp/nexus-growth-forest-progress.png',fullPage:true});
 if(direct){assert.ok(!network.some(url=>/cloudfunctions[.]net|firebase-functions[.]js|firebase-auth[.]js/.test(url)));assert.equal(db.data.has('groups/A/settings/growthForestCutover'),false);}
 assert.deepEqual(errors,[]);console.log((direct?'PASS DIRECT FIRESTORE (no Auth/Functions calls): ':'PASS CLOUD SERVICE FIXTURE: ')+'Growth Forest: real Phaser, child/parent separation, initial planting, pending exam, parent approval, live balances, water/stage change, reading rewards, rule snapshots, seed purchase/plant/reload, modal input isolation, expandable plots and pagination, XSS-safe history, transaction ledger, legacy reward request and completion, 390px mobile and 1440px desktop.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
