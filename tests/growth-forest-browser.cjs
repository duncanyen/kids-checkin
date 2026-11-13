// Real page + Phaser + real domain service; all Auth/Firestore transport is isolated.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {MemoryDB}=require('../game-admin/tests/memory-db.cjs'),{createGrowthService}=require('../functions/growth-service.cjs');
require('../scripts/prepare-growth-forest.cjs');
const parentRaceOnly=process.env.GROWTH_PARENT_RACE_ONLY==='1';
const startupOnly=process.env.GROWTH_STARTUP_ONLY==='1';
const forestNavOnly=process.env.GROWTH_NAV_ONLY==='1';
const direct=process.env.GROWTH_DIRECT_BROWSER==='1',nineOnly=process.env.GROWTH_NINE_ONLY==='1',memberOnly=process.env.GROWTH_MEMBERS_ONLY==='1',themeOnly=process.env.GROWTH_THEME_ONLY==='1',layoutOnly=process.env.GROWTH_LAYOUT_ONLY==='1';
const base=process.env.GROWTH_BASE_URL||'http://127.0.0.1:8030';
(async()=>{
 const db=new MemoryDB(),now=Date.parse('2026-11-05T04:00:00Z');
 await db.doc('users/alice').set({accountId:'alice',name:'小森林',role:'child'});await db.doc('users/parent').set({accountId:'parent',name:'森林家長',role:'parent'});await db.doc('groups/A').set({name:'森林家庭',members:['alice','parent']});
 const service=createGrowthService({db,now:()=>now,markCutover:!direct}),browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const errors=[],network=[];let heldRead=null;
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Taipei',hasTouch:nineOnly||memberOnly});
 context.on('request',request=>network.push(request.url()));
 const phaser=fs.existsSync('/tmp/kids-phaser.js')?fs.readFileSync('/tmp/kids-phaser.js','utf8'):execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});fs.writeFileSync('/tmp/kids-phaser.js',phaser);
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser+(layoutOnly?'\n{const Original=Phaser.Game;Phaser.Game=class extends Original{constructor(config){super(config);window.__testForestGame=this;}}}':'')}));
 if(!direct){
 await context.route('**/js/growth-forest/client.js',r=>r.fulfill({contentType:'text/javascript',body:`export async function connect(c){${startupOnly?'await new Promise(resolve=>setTimeout(resolve,800));':''}return{api:async(action,payload={},mutate=false)=>{const result=await window.__growthCall({accountId:c.accountId,groupId:c.groupId,action,payload,requestId:crypto.randomUUID()});if(result.error)throw Object.assign(Error(result.error.message),{code:result.error.code});return result.data;},subscribe:(_p,refresh)=>{window.__growthRefresh=refresh;return()=>window.__growthRefresh=null;},upload:async()=>{throw Error('No live uploads in isolated test');},close:()=>{}};}`}));
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
  if(heldRead&&call.accountId==='parent'&&call.action===heldRead.action&&(!heldRead.kind||call.payload.kind===heldRead.kind)){const hold=heldRead;heldRead=null;hold.started();await hold.wait;}
  if(startupOnly&&call.action==='snapshot')await new Promise(resolve=>setTimeout(resolve,800));
  try{const data=await service.handle({auth:{uid:call.accountId,token:{photoAccountId:call.accountId,photoGroupId:call.groupId}},data:{groupId:call.groupId,action:call.action,payload:call.payload,requestId:call.requestId}});
   if(!['snapshot','list','legacyList','overview'].includes(call.action))for(const p of context.pages())p.evaluate(()=>{setTimeout(()=>window.__growthRefresh?.(),250);}).catch(()=>{});
   return{data};
  }catch(error){return{error:{code:'functions/'+error.code,message:error.message}};}
 });
 async function open(accountId){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(15000);const wait=p.waitForFunction.bind(p);p.waitForFunction=(fn,arg,opts)=>wait(fn,arg,{timeout:15000,...opts});await p.clock.setFixedTime(new Date(now));await p.addInitScript(accountId=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId,name:'舊顯示',role:'child',groupId:'B'}));localStorage.setItem('lastGroupId','A');},accountId);await p.goto(base+'/wishwall.html'+(process.env.GROWTH_NAV_ENTRY==='1'?'?nav=1':''));await p.waitForFunction(()=>document.querySelector('#pointsBalance').textContent!=='—');return p;}
 async function clickPlot(page,index){await page.waitForFunction(()=>document.querySelector('#forestGame').getAttribute('aria-busy')==='false');await page.locator('#forestGame canvas').scrollIntoViewIfNeeded();const box=await page.locator('#forestGame canvas').boundingBox(),local=index%9;await page.mouse.click(box.x+(190+(local%3)*200)/780*box.width,box.y+(535+Math.floor(local/3)*175-3)/1000*box.height);}
 if(parentRaceOnly){
  const page=await open('parent');await page.click('#parentNav');await page.waitForSelector('#parentRecordSection');
  for(const {tab,action,kind}of [{tab:'overview',action:'overview'},{tab:'requests',action:'list',kind:'requests'},{tab:'migration',action:'snapshot'},{tab:'records',action:'list',kind:'records'},{tab:'transactions',action:'list',kind:'transactions'}]){
   let release,started;const began=new Promise(resolve=>started=resolve),wait=new Promise(resolve=>release=resolve);heldRead={action,kind,wait,started};
   await page.click('[data-parent='+tab+']');await began;
   await page.click('[data-parent=settings]');await page.waitForSelector('#settingsForm');await page.fill('[name=readingCoins]','777');
   release();await page.waitForTimeout(150);
   assert.equal(await page.locator('#settingsForm').count(),1,'late '+tab+' must not replace reward rules');
   assert.equal(await page.inputValue('[name=readingCoins]'),'777','late '+tab+' must not reset edits');
   assert.equal(await page.locator('#status').getAttribute('class'),'success','no stale handler errors after '+tab);
   assert.equal(await page.locator('[role=tab][aria-selected=true]').getAttribute('data-parent'),'settings');
  }
  await page.click('#settingsForm button[type=submit]');await page.waitForFunction(()=>document.querySelector('#settingsForm button[type=submit]')?.disabled===false);assert.equal((await db.doc('groups/A/growthSettings/main').get()).data().reading.coins,777);
  await page.click('[data-parent=overview]');await page.waitForSelector('#manualReward');await page.click('#manualReward');await page.waitForSelector('#manualForm');await page.click('#closeSheet');
  await page.click('[data-parent=requests]');await page.waitForSelector('#oldParentRequests');await page.click('#oldParentRequests');await page.waitForSelector('.requests-rows');
  assert.deepEqual(errors,[]);console.log('PASS delayed overview/requests/migration/records/transactions cannot overwrite settings or bind detached controls; rules save and management actions work.');return;
 }
 if(startupOnly){
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'alice',groupId:'A'}));localStorage.setItem('lastGroupId','A');});
  await page.goto(base+'/wishwall.html');
  await page.waitForFunction(()=>Boolean(window.Phaser));
  assert.equal(await page.locator('#pointsBalance').innerText(),'—','engine loads while connection and snapshot are still pending');
  await page.waitForFunction(()=>document.querySelector('#pointsBalance').textContent!=='—');
  await page.waitForFunction(()=>document.querySelector('#forestGame').getAttribute('aria-busy')==='false');
  assert.ok(network.some(url=>url.endsWith('/assets/growth-forest/lavender-5.svg')),'all existing stage art is warmed');
  assert.equal(await page.locator('#forestGame canvas').count(),1,'preload never creates an extra game');
  await page.screenshot({path:'/tmp/nexus-growth-forest-startup.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS real Phaser and plant assets load before delayed account/snapshot completes; one canvas and fresh balances.');return;
 }
 if(!process.env.GROWTH_FLOWERS_ONLY&&!nineOnly&&!memberOnly&&!themeOnly&&!layoutOnly&&!forestNavOnly){
 const child=await open('alice');await child.waitForSelector('#forestGame canvas');assert.equal(await child.locator('#parentNav').isVisible(),false);assert.match(await child.title(),/成長森林/);assert.equal(await child.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await clickPlot(child,0);await child.click('[data-plant="sunflower"]');await child.waitForFunction(()=>!document.querySelector('#sheet').open);await child.screenshot({path:'/tmp/nexus-growth-forest-child.png',fullPage:true});
 await child.click('#resourceGuide');assert.ok((await child.locator('#sheetBody').innerText()).includes('家長核准後，三種資源才會一起入帳'));await child.click('#closeSheet');
 await child.click('#openExam');await child.fill('[name=score]','95');
 // Phaser's native canvas listeners must ignore input while a DOM dialog is open.
 await child.evaluate(()=>{const canvas=document.querySelector('#forestGame canvas'),box=canvas.getBoundingClientRect();for(const [x,y]of [[216,573],[564,553],[371,761]]){const init={bubbles:true,clientX:box.left+x/780*box.width,clientY:box.top+y/1000*box.height,button:0,buttons:1};canvas.dispatchEvent(new MouseEvent('mousedown',init));canvas.dispatchEvent(new MouseEvent('mouseup',{...init,buttons:0}));}});
 assert.equal(await child.locator('#sheetTitle').innerText(),'紀錄考試');assert.equal(await child.locator('[name=score]').inputValue(),'95');assert.equal(await child.locator('#waterPlant').count(),0);if(direct)await child.setInputFiles('[name=photo]','Nexus.png');await child.click('#examForm button[type=submit]');await child.waitForFunction(()=>document.querySelector('#status').textContent.includes('等待家長'));assert.equal(await child.locator('#pointsBalance').innerText(),'0');
 console.log('growth: pending exam created');const parent=await open('parent');await parent.click('#parentNav');await parent.click('#parentRecordSection>summary');await parent.locator('[data-record]').first().click();if(direct){await parent.click('#viewPhoto');await parent.waitForFunction(()=>document.querySelector('#photoContainer img')?.naturalWidth>0);assert.equal([...db.data.keys()].filter(path=>path.includes('/growthExamPhotos/')).length,1);}await parent.click('#approveRecord');await parent.waitForFunction(()=>!document.querySelector('#sheet').open);
 await child.waitForFunction(()=>document.querySelector('#pointsBalance').textContent==='100');await clickPlot(child,0);await child.click('#waterPlant');await child.waitForFunction(()=>document.querySelector('#sheetTitle').textContent==='向日葵'&&document.querySelector('.plant-info')?.textContent.includes('10 / 100'));await child.click('#waterPlant');await child.waitForFunction(()=>document.querySelector('.plant-info')?.textContent.includes('20 / 100'));await child.click('#closeSheet');
 console.log('growth: exam approved and plant watered');await child.click('#openReading');await child.fill('[name=bookName]','小王子 <img src=x onerror=alert(1)>');await child.fill('[name=readingMinutes]','20');await child.fill('[name=readingPages]','15');await child.click('#readingForm button[type=submit]');await child.waitForFunction(()=>document.querySelector('#pointsBalance').textContent==='110');assert.equal(await child.locator('#coinBalance').innerText(),'15');
 console.log('growth: reading rewarded');await parent.click('[data-parent=settings]');await parent.fill('[name=readingCoins]','300');await parent.click('#settingsForm button[type=submit]');await parent.waitForFunction(()=>!document.querySelector('#settingsForm button[type=submit]').disabled);assert.equal((await db.doc('groups/A/growthSettings/main').get()).data().reading.coins,300);await child.waitForTimeout(500);
 await child.click('#openReading');await child.fill('[name=eventDate]','2026-11-04');await child.fill('[name=bookName]','另一段故事');await child.fill('[name=readingMinutes]','20');await child.click('#readingForm button[type=submit]');await child.waitForFunction(()=>document.querySelector('#coinBalance').textContent==='315');
 await child.click('#seedShop');await child.click('[data-buy=tulip]');await child.click('#buyForm button[type=submit]');await child.waitForFunction(()=>document.querySelector('#coinBalance').textContent==='235');await clickPlot(child,1);await child.click('[data-plant=tulip]');await child.waitForFunction(()=>!document.querySelector('#sheet').open);
 await child.reload();await child.waitForSelector('#forestGame canvas');await clickPlot(child,1);assert.equal(await child.locator('#sheetTitle').innerText(),'鬱金香');await child.click('#closeSheet');
 await child.click('[data-view=records]');await child.waitForSelector('[data-record]');assert.equal(await child.locator('#recordList img').count(),0);assert.ok((await child.locator('#recordList').innerText()).includes('<img src=x'));await child.click('#showTransactions');assert.ok((await child.locator('#transactions').innerText()).includes('record')||(await child.locator('#transactions').innerText()).includes('成長獎勵'));await child.click('#closeSheet');
 await child.click('[data-view=forest]');await child.click('#buyPlot');await child.click('#buyPlotForm button[type=submit]');await child.waitForFunction(()=>document.querySelector('#forestPageLabel').textContent.includes('共 4 塊土地'));
 assert.equal(await child.locator('[data-plot]').count(),0);assert.equal(await child.locator('#coinBalance').innerText(),'135');assert.equal(await child.locator('#waterBalance').innerText(),'15');
 await child.click('#seedShop');await child.click('[data-buy=sunflower]');await child.click('#buyForm button[type=submit]');await child.waitForFunction(()=>!document.querySelector('#sheet').open);
 await clickPlot(child,3);await child.click('[data-plant=sunflower]');await child.waitForFunction(()=>!document.querySelector('#sheet').open);await clickPlot(child,3);await child.click('#waterPlant');await child.waitForFunction(()=>document.querySelector('.plant-info')?.textContent.includes('10 / 100'));await child.click('#closeSheet');
 await child.reload();await child.waitForFunction(()=>document.querySelector('#forestPageLabel').textContent.includes('共 4 塊土地'));await clickPlot(child,3);assert.equal(await child.locator('#sheetTitle').innerText(),'向日葵');await child.click('#closeSheet');
 await child.click('#openPlants');await child.waitForFunction(()=>document.querySelector('#sheetBody').textContent.includes('第 1 / 1 區'));await child.click('[data-open-plot="0"]');assert.equal(await child.locator('#sheetTitle').innerText(),'向日葵');await child.click('#closeSheet');
 await child.click('#buyPlot');assert.equal(await child.locator('#buyPlotForm button[type=submit]').isDisabled(),true);await child.click('#closeSheet');
 console.log('growth: expansion, pagination, new-plot watering, reload and insufficient funds verified');
 await child.click('[data-view=rewards]');await child.locator('[data-reward]').first().click();await child.click('#requestForm button[type=submit]');await child.waitForFunction(()=>!document.querySelector('#sheet').open);
 await parent.click('[data-parent=requests]');await parent.selectOption('[name=parentTarget]','alice');await parent.waitForSelector('[data-request][data-status=completed]');await parent.click('[data-request][data-status=completed]');await parent.fill('[name=reason]','獎品已交付');await parent.click('#reasonForm button[type=submit]');await parent.waitForFunction(()=>!document.querySelector('#sheet').open);
 await parent.setViewportSize({width:1440,height:1000});await parent.click('[data-parent=overview]');await parent.waitForSelector('.summary-grid');await parent.screenshot({path:'/tmp/nexus-growth-forest-parent.png',fullPage:true});
 assert.equal(await parent.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await child.bringToFront();await child.click('[data-view=forest]');await child.screenshot({path:'/tmp/nexus-growth-forest-progress.png',fullPage:true});await child.close();await parent.close();
 }
 if(!nineOnly&&!memberOnly&&!themeOnly&&!layoutOnly&&!forestNavOnly){
 // New flower catalog works for an existing-style seed bag and the real renderer.
 await db.doc('users/flora').set({accountId:'flora',name:'花園',role:'child'});await db.doc('groups/A').set({name:'森林家庭',members:['alice','parent','flora']});
 await service.handle({auth:{uid:'flora',token:{photoAccountId:'flora',photoGroupId:'A'}},data:{groupId:'A',action:'snapshot'}});
 const floraWallet=(await db.doc('groups/A/growthProfiles/flora').get()).data();await db.doc('groups/A/growthProfiles/flora').set({...floraWallet,coinBalance:1000,waterBalance:1000});
 const floraGarden=(await db.doc('groups/A/gardens/flora').get()).data();await db.doc('groups/A/gardens/flora').set({...floraGarden,seeds:{sunflower:1,tulip:0,sakura:0}});
 const florist=await open('flora');let flowerCoins=1000;
 for(const [index,[type,name,price,required]]of [['rose','玫瑰花',100,200],['daffodil','水仙花',150,300],['lavender','薰衣草',200,400]].entries()){
  await florist.click('#seedShop');assert.equal(await florist.locator('[data-buy]').count(),6);const card=florist.locator(`[data-buy="${type}"]`).locator('..');assert.ok((await card.innerText()).includes(name));assert.ok((await card.innerText()).includes(`${price} 金幣`));await florist.click(`[data-buy="${type}"]`);await florist.click('#buyForm button[type=submit]');flowerCoins-=price;await florist.waitForFunction(expected=>document.querySelector('#coinBalance').textContent===String(expected),flowerCoins);
  await clickPlot(florist,index);await florist.click(`[data-plant="${type}"]`);await florist.waitForFunction(()=>!document.querySelector('#sheet').open);await clickPlot(florist,index);await florist.click('#waterPlant');await florist.waitForFunction(required=>document.querySelector('.plant-info')?.textContent.includes(`10 / ${required}`),required).catch(async error=>{console.error('Flower watering diagnostic:',type,await florist.locator('#status').innerText(),await florist.locator('#sheetBody').innerText());await florist.screenshot({path:'/tmp/new-flowers-error.png',fullPage:true});throw error;});await florist.click('#closeSheet');
 }
 // Render all mature assets in the actual Phaser scene after isolated fixture hydration.
 for(const [path,plant]of db.data)if(path.startsWith('groups/A/gardenPlants/')&&plant.accountId==='flora')db.data.set(path,{...plant,growthValue:plant.growthRequired,growthStage:5});
 await florist.reload();await florist.waitForSelector('#forestGame canvas');await clickPlot(florist,0);assert.ok((await florist.locator('.plant-info').innerText()).includes('Lv.5'));await florist.click('#closeSheet');await florist.waitForTimeout(500);await florist.screenshot({path:'/tmp/nexus-growth-forest-new-flowers.png',fullPage:true});await florist.click('#seedShop');await florist.screenshot({path:'/tmp/nexus-growth-forest-new-seeds.png',fullPage:true});
 assert.equal(await florist.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);console.log('growth: six seed types, exact new prices, legacy seed bag, three new plants, watering and mature Phaser rendering verified');
 }
 if(nineOnly){
  await db.doc('users/gardener').set({accountId:'gardener',name:'九宮花園',role:'child'});await db.doc('groups/A').set({name:'森林家庭',members:['alice','parent','gardener']});
  const auth={uid:'gardener',token:{photoAccountId:'gardener',photoGroupId:'A'}},call=(action,payload)=>service.handle({auth,data:{groupId:'A',action,payload,requestId:require('node:crypto').randomUUID()}});
  await call('snapshot',{});const garden=(await db.doc('groups/A/gardens/gardener').get()).data(),wallet=(await db.doc('groups/A/growthProfiles/gardener').get()).data();
  await db.doc('groups/A/gardens/gardener').set({...garden,plotCount:10,seeds:{rose:3,daffodil:2,lavender:2,sunflower:1,tulip:1,sakura:1}});await db.doc('groups/A/growthProfiles/gardener').set({...wallet,waterBalance:125,coinBalance:1000});
  const planted=[];
  for(const [i,type]of ['rose','daffodil','lavender','sunflower','tulip','sakura','rose','lavender','daffodil','rose'].entries()){
   const created=await call('plant',{positionIndex:i,plantType:type}),ref=db.doc('groups/A/gardenPlants/'+created.id),plant=(await ref.get()).data();planted.push(plant);
   if(i!==8)await ref.set({...plant,growthValue:i===0||i===9?plant.growthRequired*.7:plant.growthRequired,growthStage:i===0||i===9?4:5});
  }
  const page=await open('gardener');await page.waitForSelector('#forestGame canvas');assert.equal(await page.locator('[data-plot]').count(),0);assert.equal(await page.locator('[data-plot="9"]').count(),0);assert.ok((await page.locator('#forestPageLabel').innerText()).includes('第 1 / 2 區'));
  async function flowerClick(local,touch=false){await page.waitForFunction(()=>document.querySelector('#forestGame').getAttribute('aria-busy')==='false');await page.locator('#forestGame canvas').scrollIntoViewIfNeeded();const box=await page.locator('#forestGame canvas').boundingBox(),point={x:190+(local%3)*200,y:535+Math.floor(local/3)*175};const x=box.x+point.x/780*box.width,y=box.y+(point.y-74)/1000*box.height;if(touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);}
  await flowerClick(0);await page.waitForSelector('#waterPlant');assert.equal(await page.locator('#sheetTitle').innerText(),'玫瑰花');assert.equal(await page.locator('#waterAmount').innerText(),'10 滴');
  await page.click('#waterPlus');assert.equal(await page.locator('#waterAmount').innerText(),'20 滴');await page.click('#waterMinus');assert.equal(await page.locator('#waterAmount').innerText(),'10 滴');await page.click('#waterMax');assert.equal(await page.locator('#waterAmount').innerText(),'60 滴');
  assert.equal((await db.doc('groups/A/growthProfiles/gardener').get()).data().waterBalance,125);await page.click('[data-close]');await flowerClick(0,true);await page.waitForSelector('#waterMax');await page.click('#waterMax');
  await page.evaluate(()=>{const button=document.querySelector('#waterPlant');button.click();button.click();});await page.waitForFunction(()=>document.querySelector('.plant-info')?.textContent.includes('200 / 200'));
  assert.equal((await db.doc('groups/A/growthProfiles/gardener').get()).data().waterBalance,65);assert.equal(await page.locator('#waterPlant').isDisabled(),true);await page.click('#closeSheet');
  const logs=()=>[...db.data.values()].filter(row=>row.accountId==='gardener'&&row.kind==='plant-watered');assert.equal(logs().length,1);assert.equal(logs()[0].delta.water,-60);
  await clickPlot(page,8);await page.click('#waterMax');assert.equal(await page.locator('#waterAmount').innerText(),'65 滴');await page.click('#waterMinus');assert.equal(await page.locator('#waterAmount').innerText(),'60 滴');await page.click('#waterPlus');assert.equal(await page.locator('#waterAmount').innerText(),'65 滴');await page.click('#waterPlant');await page.waitForFunction(()=>document.querySelector('.plant-info')?.textContent.includes('65 / 300'));
  assert.equal((await db.doc('groups/A/growthProfiles/gardener').get()).data().waterBalance,0);assert.equal(logs().length,2);assert.equal(await page.locator('#waterPlant').isDisabled(),true);await page.click('#closeSheet');
  await page.screenshot({path:'/tmp/nexus-growth-forest-nine-mobile.png',fullPage:true});await page.click('#nextForest');await page.waitForFunction(()=>document.querySelector('#forestPageLabel').textContent.includes('第 2 / 2 區'));await flowerClick(0);assert.equal(await page.locator('#sheetTitle').innerText(),'玫瑰花');assert.ok((await page.locator('#sheetBody').innerText()).includes('140 / 200'));await page.click('#closeSheet');
  await page.click('#previousForest');await page.waitForFunction(()=>document.querySelector('#forestPageLabel').textContent.includes('第 1 / 2 區'));await page.reload();await page.waitForSelector('#forestGame canvas');assert.equal(await page.locator('[data-plot]').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:1440,height:1100});await page.waitForSelector('#forestGame canvas');await page.screenshot({path:'/tmp/nexus-growth-forest-nine-desktop.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log('PASS nine plots per region, partial second region, mouse and touch on flower heads, local +/- and MAX, cancel, one atomic bulk request, double-click deduplication, balance-tail watering, mature/empty guards, reload, mobile and desktop');
 }
 if(memberOnly){
  await db.doc('users/parent').set({accountId:'parent',name:'改名後的成員',role:'parent',avatar:'data:image/png;base64,'+fs.readFileSync('Nexus.png').toString('base64'),password:'not-public'});await db.doc('users/newbie').set({accountId:'newbie',name:'還沒種花',role:'member'});await db.doc('users/removed').set({accountId:'removed',name:'停用成員',role:'removed'});await db.doc('groups/A').set({name:'森林家庭',members:['alice','parent','newbie','removed']});
  const parentAuth={uid:'parent',token:{photoAccountId:'parent',photoGroupId:'A'}},call=(action,payload)=>service.handle({auth:parentAuth,data:{groupId:'A',action,payload,requestId:require('node:crypto').randomUUID()}});
  await call('snapshot',{});const garden=(await db.doc('groups/A/gardens/parent').get()).data();await db.doc('groups/A/gardens/parent').set({...garden,plotCount:10,seeds:{rose:2}});await call('plant',{plantType:'rose',positionIndex:0});await call('plant',{plantType:'rose',positionIndex:9});
  const page=await open('alice');await page.waitForSelector('#forestGame canvas');assert.equal(await page.locator('[data-plot]').count(),0);assert.equal(await page.locator('.forest-identity').count(),0);assert.equal(await page.locator('#status').isVisible(),false);assert.equal(await page.locator('#greeting').innerText(),'小森林的成長森林');assert.equal((await page.locator('#forestBack').innerText()).trim(),'返回主選單');
  await page.waitForFunction(()=>document.querySelector('#resourceGuide svg')?.width.baseVal.value===24);const header=await page.locator('.forest-header').boundingBox(),title=await page.locator(process.env.GROWTH_NAV_ENTRY==='1'?'.forest-feature-title':'#forestBack').boundingBox(),qa=await page.locator('#resourceGuide').boundingBox();assert.ok(title.y>=header.y&&title.y+title.height<=header.y+header.height);assert.ok(qa.x>title.x);assert.ok((await page.locator('#forestGame').boundingBox()).y<(process.env.GROWTH_NAV_ENTRY==='1'?320:250));
  await page.click('#resourceGuide');assert.equal(await page.locator('#sheetTitle').innerText(),'資源怎麼獲得？');await page.click('#closeSheet');await page.click('#membersNav');await page.waitForSelector('[data-member-account="parent"]');assert.equal(await page.locator('[data-member-account]').count(),3);assert.equal(await page.locator('[data-member-account="removed"]').count(),0);assert.ok((await page.locator('[data-member-account="parent"]').innerText()).includes('改名後的成員'));await page.waitForFunction(()=>document.querySelector('[data-member-account="parent"] img').naturalWidth>0);await page.screenshot({path:'/tmp/nexus-growth-forest-members-mobile.png',fullPage:true});
  await page.click('[data-member-account="parent"]');await page.waitForSelector('#visitGame canvas');await page.waitForFunction(()=>document.querySelector('#greeting').textContent==='改名後的成員的成長森林');assert.equal(await page.locator('.resource-strip').isVisible(),false);assert.equal(await page.locator('.forest-nav').isVisible(),false);assert.equal(await page.locator('#resourceGuide').isVisible(),false);assert.equal(await page.locator('#seedShop').isVisible(),false);assert.equal(await page.locator('#waterPlant').count(),0);
  await page.waitForFunction(()=>document.querySelector('#visitGame').getAttribute('aria-busy')==='false');const before=JSON.stringify([...db.data]);const box=await page.locator('#visitGame canvas').boundingBox();await page.mouse.click(box.x+190/780*box.width,box.y+535/1000*box.height);assert.equal(await page.locator('#sheet').isVisible(),false);assert.equal(JSON.stringify([...db.data]),before);
  await page.click('#visitNext');await page.waitForFunction(()=>document.querySelector('#visitPageLabel').textContent==='第 2 / 2 區');await page.screenshot({path:'/tmp/nexus-growth-forest-visit-mobile.png',fullPage:true});await page.click('#forestBack');assert.equal(await page.locator('#forestView').isVisible(),true);assert.equal(await page.locator('.resource-strip').isVisible(),true);assert.equal(await page.locator('#greeting').innerText(),'小森林的成長森林');
  await page.click('#membersNav');await page.waitForSelector('[data-member-account="newbie"]');const emptyBefore=JSON.stringify([...db.data]);await page.click('[data-member-account="newbie"]');await page.waitForFunction(()=>document.querySelector('#greeting').textContent==='還沒種花的成長森林');await page.waitForSelector('#visitGame canvas');assert.equal(JSON.stringify([...db.data]),emptyBefore);assert.equal(db.data.has('groups/A/gardens/newbie'),false);await page.click('#forestBack');
  await page.screenshot({path:'/tmp/nexus-growth-forest-compact-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:'/tmp/nexus-growth-forest-compact-desktop.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log('PASS compact header, no flower buttons or normal status gap, SVG Q&A, account-based member avatars, read-only member forest, pagination, direct return, empty forest without writes, mobile and desktop');
 }
 if(themeOnly){
  await db.doc('userSettings/alice').set({accountId:'alice',appearance:{theme:'wisteria'}});await db.doc('userSettings/parent').set({accountId:'parent',appearance:{theme:'evergreen'}});
  await context.addInitScript(()=>{if(!localStorage.getItem('nexus.appearance.v1:alice'))localStorage.setItem('nexus.appearance.v1:alice',JSON.stringify({theme:'aqua'}));if(!localStorage.getItem('nexus.appearance.v1:parent'))localStorage.setItem('nexus.appearance.v1:parent',JSON.stringify({theme:'lapis'}));});
  const page=await open('alice');await page.waitForFunction(()=>document.documentElement.dataset.nexusTheme==='wisteria');await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('nexus.appearance.v1:alice')).theme),'wisteria');await page.click('#openExam');await page.fill('[name=score]','95');
  const palettes=await page.evaluate(()=>window.NexusTheme.themes),rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')+')';
  for(const palette of palettes){
   await page.evaluate(id=>window.NexusTheme.apply(id),palette.id);
   const colors=await page.evaluate(()=>{const style=selector=>getComputedStyle(document.querySelector(selector));return{body:style('body').backgroundColor,text:style('body').color,resource:style('.resource-strip').backgroundColor,nav:style('.forest-nav').backgroundColor,dialog:style('#sheet').backgroundColor,input:style('[name=score]').backgroundColor,inputText:style('[name=score]').color,button:style('#examForm button[type=submit]').backgroundColor,buttonText:style('#examForm button[type=submit]').color,help:style('#resourceGuide').color,meta:document.querySelector('meta[name=theme-color]').content,mode:document.documentElement.dataset.colorMode};});
   assert.equal(colors.body,rgb(palette.bg),palette.id+' body');assert.equal(colors.text,rgb(palette.text));assert.equal(colors.resource,rgb(palette.surface));assert.equal(colors.nav,rgb(palette.surface));assert.equal(colors.dialog,rgb(palette.surface));assert.equal(colors.input,rgb(palette.surface));assert.equal(colors.inputText,rgb(palette.text));assert.equal(colors.button,rgb(palette.primary));assert.equal(colors.buttonText,rgb(palette.onPrimary));assert.equal(colors.help,rgb(palette.primary));assert.equal(colors.meta,palette.bg);assert.equal(colors.mode,palette.dark?'dark':'light');assert.equal(await page.inputValue('[name=score]'),'95');
  }
  await page.screenshot({path:'/tmp/nexus-growth-forest-theme-dark-form.png',fullPage:true});await page.click('#closeSheet');
  await db.doc('userSettings/alice').set({accountId:'alice',appearance:{theme:'grape'}});await page.evaluate(()=>window.__webEmit());await page.waitForFunction(()=>document.documentElement.dataset.nexusTheme==='grape');await page.reload();await page.waitForFunction(()=>document.querySelector('#pointsBalance').textContent!=='—'&&document.documentElement.dataset.nexusTheme==='grape');
  await page.waitForFunction(()=>document.querySelector('#forestGame').getAttribute('aria-busy')==='false');await page.waitForTimeout(150);await page.screenshot({path:'/tmp/nexus-growth-forest-theme-dark.png',fullPage:true});const other=await open('parent');await other.waitForFunction(()=>document.documentElement.dataset.nexusTheme==='evergreen');assert.equal(await page.evaluate(()=>window.NexusTheme.current),'grape');await other.close();
  await page.click('#membersNav');await page.waitForSelector('[data-member-account="parent"]');await page.click('[data-member-account="parent"]');await page.waitForSelector('#visitGame canvas');assert.equal(await page.evaluate(()=>window.NexusTheme.current),'grape');await page.click('#forestBack');
  await db.doc('userSettings/alice').set({accountId:'alice',appearance:{theme:'terracotta'}});await page.evaluate(()=>{localStorage.setItem('nexus.appearance.v1:alice',JSON.stringify({theme:'terracotta'}));window.dispatchEvent(new StorageEvent('storage',{key:'nexus.appearance.v1:alice'}));});await page.waitForFunction(()=>document.documentElement.dataset.nexusTheme==='terracotta');await page.evaluate(()=>window.__webEmit());await page.waitForFunction(()=>window.NexusTheme.current==='terracotta');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:'/tmp/nexus-growth-forest-theme-light-desktop.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log('PASS all personal palettes, stored-account hydration over stale cache, live setting update, reload, account isolation, visitor keeps own theme, cross-tab cache refresh, themed forms/buttons/Q&A and mobile/desktop');
 }
 if(layoutOnly){
  const auth={uid:'alice',token:{photoAccountId:'alice',photoGroupId:'A'}},call=(action,payload)=>service.handle({auth,data:{groupId:'A',action,payload,requestId:require('node:crypto').randomUUID()}});
  for(let i=0;i<45;i++)await call('createRecord',{type:'exam',eventDate:'2026-11-05',subject:'數學',examType:'小考',score:50+i/10,maxScore:100,note:'版面驗證 '+i});
  const child=await open('alice');
  async function checkDates(page,selector){const rows=await page.locator(selector).evaluateAll(elements=>elements.map(input=>{const rect=input.getBoundingClientRect(),label=input.parentElement.getBoundingClientRect();return{left:rect.left,right:rect.right,width:rect.width,labelLeft:label.left,labelRight:label.right,value:input.value};}));for(const row of rows){assert.ok(row.width<220,'date is sized to its contents');assert.ok(row.left>=0&&row.right<=await page.evaluate(()=>innerWidth)+1,'date stays within viewport');assert.ok(row.left>=row.labelLeft-1&&row.right<=row.labelRight+1,'date stays within its label');}}
  async function equalFilterDates(page,root){
   const sizes=await page.locator(root+' [name=status],'+root+' [type=date]').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return{width:box.width,height:box.height};}));
   assert.equal(sizes.length,3);for(const size of sizes){assert.ok(Math.abs(size.width-sizes[0].width)<1,'date width matches status');assert.ok(Math.abs(size.height-sizes[0].height)<1,'date height matches status');}
  }
  for(const width of [320,390,768]){
   await child.setViewportSize({width,height:844});await child.click('#openExam');await child.fill('[name=eventDate]','2026-11-05');await checkDates(child,'#examForm input[type=date]');assert.equal(await child.inputValue('#examForm [name=eventDate]'),'2026-11-05');await child.click('#closeSheet');
   await child.click('#openReading');await child.fill('[name=eventDate]','2026-11-04');await checkDates(child,'#readingForm input[type=date]');assert.equal(await child.inputValue('#readingForm [name=eventDate]'),'2026-11-04');await child.click('#closeSheet');
   await child.click('[data-view=records]');await child.waitForSelector('#recordFilters [name=from]');await checkDates(child,'#recordFilters input[type=date]');await equalFilterDates(child,'#recordFilters');const status=await child.locator('#recordFilters [name=status]').boundingBox(),exam=await child.locator('#recordFilters [name=examType]').boundingBox(),from=await child.locator('#recordFilters [name=from]').boundingBox(),to=await child.locator('#recordFilters [name=to]').boundingBox();assert.ok(exam.x>status.x&&Math.abs(exam.y-status.y)<1,'exam type sits to the right of status');if(width>=390)assert.ok(from.x<to.x&&Math.abs(from.y-to.y)<1,'start date sits left of end date');assert.equal(await child.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await child.click('[data-view=forest]');
  }
  await child.close();const parent=await open('parent');
  await clickPlot(parent,0);await parent.click('[data-plant=sunflower]');await parent.waitForFunction(()=>!document.querySelector('#sheet').open);
  await parent.click('#parentNav');
  await parent.waitForFunction(()=>window.__testForestGame.scene.getScenes(true)[0]?.input.enabled===false);
  assert.equal(await parent.evaluate(()=>window.__testForestGame.input.enabled),true,'global input still receives touchend');
  assert.equal(await parent.locator('[name=parentTarget]').count(),0,'review has a single member filter');
  assert.equal(await parent.locator('#parentFilters .filter-member>label').evaluate(el=>el.firstChild.textContent),'成員');
  for(const accountId of ['alice','parent','all']){
   await parent.selectOption('#parentFilters [name=accountId]',accountId);
   await parent.evaluate(()=>{
    const scene=window.__testForestGame.scene.getScenes(true)[0],pointer={getDistance:()=>0};
    // 重現選單操作期間隱藏場景收到殘留 pointerup，花朵及土壤都不得開窗。
    scene.sprites[0].emit('pointerup',pointer);scene.hits[0].emit('pointerup',pointer);
    const canvas=document.querySelector('#forestGame canvas');for(const type of ['mousedown','mouseup'])canvas.dispatchEvent(new MouseEvent(type,{bubbles:true,clientX:120,clientY:400}));
   });
   assert.equal(await parent.locator('#sheet').evaluate(el=>el.open),false);
  }
  assert.ok((await parent.locator('#parentFilters [name=accountId]').boundingBox()).width<200,'member filter sizes to text');
  await parent.click('[data-view=forest]');await clickPlot(parent,0);assert.equal(await parent.locator('#sheetTitle').innerText(),'向日葵');await parent.click('#closeSheet');await parent.click('#parentNav');
await parent.waitForFunction(()=>document.querySelector('#parentRecordCount')?.textContent.includes('20'));assert.equal(await parent.locator('#parentRecordSection').getAttribute('open'),null);assert.equal(await parent.locator('#parentRecords').isVisible(),false);
  for(const width of [320,390,768,1440]){await parent.setViewportSize({width,height:1000});await checkDates(parent,'#parentFilters input[type=date]');await equalFilterDates(parent,'#parentFilters');const tabs=await parent.locator('[data-parent]').evaluateAll(buttons=>buttons.map(button=>{const rect=button.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height};}));assert.ok(tabs.every(tab=>Math.abs(tab.y-tabs[0].y)<1&&tab.height>=44),'management tabs stay in one scrollable row with touch targets');assert.equal(await parent.locator('[role=tablist]').evaluate(el=>getComputedStyle(el).overflowX),'auto');assert.equal(await parent.locator('[role=tab][aria-selected=true]').count(),1);assert.equal(await parent.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await parent.setViewportSize({width:390,height:844});
  await parent.locator('#parentTab-records').focus();await parent.keyboard.press('ArrowRight');await parent.waitForSelector('.summary-grid');assert.equal(await parent.locator('#parentTab-overview').getAttribute('aria-selected'),'true');assert.equal(await parent.locator('#parentContent').getAttribute('aria-labelledby'),'parentTab-overview');await parent.keyboard.press('Home');await parent.waitForSelector('#parentRecordSection');
  await parent.click('#parentRecordSection>summary');const metrics=await parent.locator('#parentRecordScroll').evaluate(el=>({client:el.clientHeight,total:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));assert.ok(metrics.total>metrics.client);assert.ok(metrics.client<500);assert.equal(metrics.overflow,'auto');await parent.locator('#parentRecordScroll').evaluate(el=>el.scrollTop=123);await parent.evaluate(()=>{window.__oldRecordSection=document.querySelector('#parentRecordSection');window.__webEmit();});await parent.waitForFunction(()=>document.querySelector('#parentRecordSection')!==window.__oldRecordSection&&document.querySelector('#parentRecordCount').textContent.includes('20'));assert.equal(await parent.locator('#parentRecordSection').getAttribute('open'),'');assert.equal(await parent.locator('#parentRecordScroll').evaluate(el=>el.scrollTop),123);
  await parent.fill('#parentFilters [name=from]','2026-11-01');await parent.fill('#parentFilters [name=to]','2026-11-05');await parent.locator('#parentFilters button').click();await parent.waitForFunction(()=>document.querySelector('#parentRecordScroll').scrollTop===0);assert.equal(await parent.locator('#parentRecordSection').getAttribute('open'),'');await parent.click('#parentMore');await parent.waitForFunction(()=>document.querySelector('#parentRecordCount').textContent.includes('40'));assert.equal(await parent.locator('#parentRecords [data-record]').count(),40);
  await parent.click('#parentRecordSection>summary');assert.equal(await parent.locator('#parentRecords').isVisible(),false);await parent.screenshot({path:'/tmp/nexus-growth-forest-parent-collapsed.png',fullPage:true});await parent.click('#parentRecordSection>summary');await parent.screenshot({path:'/tmp/nexus-growth-forest-parent-scroll.png',fullPage:true});await parent.click('[data-parent=overview]');await parent.waitForSelector('.summary-grid');await parent.click('[data-parent=records]');await parent.waitForSelector('#parentRecordSection');assert.equal(await parent.locator('#parentRecordSection').getAttribute('open'),null);
  await parent.click('[data-view=records]');await parent.screenshot({path:'/tmp/nexus-growth-forest-record-filters.png',fullPage:true});
  console.log('PASS compact exam/reading/filter dates at 320/390/768/1440px, status/exam pairing, ordered date range, scrollable accessible parent tabs, default-collapsed scrollable records, live-refresh expansion/scroll preservation, filter reset, pagination and tab reset');
 }
 if(forestNavOnly){
  await db.doc('users/admin').set({accountId:'admin',name:'管理員',role:'admin'});
  await db.doc('groups/A').set({name:'森林家庭',members:['alice','parent','admin']});
  for(const accountId of ['alice','parent','admin']){
   const page=await open(accountId);await page.waitForSelector('#forestGame canvas');
   assert.equal(await page.locator('#forestView').isVisible(),true,'every role starts in own forest');
   assert.equal(await page.locator('#parentView').isVisible(),false);
   assert.equal(await page.locator('.app-bottom-navigation').count(),0);
   assert.equal(await page.locator('.forest-nav').count(),1);
   const expected=['首頁','我的森林','成長紀錄','夢想獎勵',...(accountId==='alice'?[]:['家長管理']),'成員森林'];
   assert.deepEqual(await page.locator('.forest-nav>:visible').allTextContents(),expected);
   assert.equal(await page.locator('.forest-nav button[aria-current=page]').getAttribute('data-view'),'forest');
   assert.equal(await page.evaluate(async()=>{const {icon}=await import('/js/ui-icons.js');return icon('wishlist')===icon('forest');}),true);
   for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:844});
    const bar=await page.locator('.forest-nav').boundingBox();assert.ok(Math.abs(bar.y+bar.height-844)<2);
    const controls=await page.locator('.forest-nav>:visible').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,right:r.right,width:r.width,height:r.height};}));
    assert.ok(controls.every(r=>r.x>=0&&r.right<=width&&r.width>=44&&r.height>=44));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(accountId==='admin'&&[390,1440].includes(width))await page.screenshot({path:'/tmp/nexus-forest-nav-'+width+'.png'});
   }
   await page.click('[data-view=records]');await page.waitForSelector('#recordFilters');
   await page.click('[data-view=rewards]');assert.equal(await page.locator('#rewardsView').isVisible(),true);
   if(accountId!=='alice'){await page.click('#parentNav');await page.waitForSelector('#parentRecordSection');}
   await page.click('#membersNav');await page.waitForSelector('[data-member-account]');
   await page.click('[data-member-account="'+(accountId==='alice'?'parent':'alice')+'"]');await page.waitForSelector('#visitGame canvas');
   assert.equal(await page.locator('#forestBack').isVisible(),true);await page.click('#forestBack');assert.equal(await page.locator('#forestView').isVisible(),true);
   await page.reload();await page.waitForSelector('#forestGame canvas');assert.equal(await page.locator('#forestView').isVisible(),true);
   assert.equal(await page.locator('.forest-home').getAttribute('href'),'index.html?nav=1');
   await page.goto(base+'/wishwall.html');await page.waitForFunction(()=>document.querySelector('#pointsBalance').textContent!=='—');
   assert.equal(await page.locator('#forestBack').innerText(),'返回主選單');assert.equal(await page.locator('.forest-feature-title').innerText(),'成長森林');
   await page.close();
  }
  console.log('PASS forest-owned bottom navigation, home and unnumbered tabs, role visibility, all roles default to forest, tab actions, member return, refresh, direct-entry return, shared forest SVG and 320/390/768/1440px.');
 }
 if(direct){assert.ok(!network.some(url=>/cloudfunctions[.]net|firebase-functions[.]js|firebase-auth[.]js/.test(url)));assert.equal(db.data.has('groups/A/settings/growthForestCutover'),false);}
 assert.deepEqual(errors,[]);console.log((forestNavOnly?'FOREST NAVIGATION FLOW: ':layoutOnly?'RECORD LAYOUT FLOW: ':themeOnly?'PERSONAL THEME FLOW: ':memberOnly?'MEMBER FOREST FLOW: ':nineOnly?'NINE-PLOT FLOW: ':process.env.GROWTH_FLOWERS_ONLY?'FLOWER CATALOG FLOW: ':'')+(direct?'PASS DIRECT FIRESTORE (no Auth/Functions calls): ':'PASS CLOUD SERVICE FIXTURE: ')+(forestNavOnly?'forest navigation and default entry.':layoutOnly?'record forms and parent review layout.':themeOnly?'personal themes.':memberOnly?'compact forest and read-only member visits.':nineOnly?'nine plots and bulk watering.':process.env.GROWTH_FLOWERS_ONLY?'six seed types, exact new prices, legacy seed bag, planting/watering and mature flower rendering.':'Growth Forest: real Phaser, child/parent separation, initial planting, pending exam, parent approval, live balances, water/stage change, reading rewards, rule snapshots, seed purchase/plant/reload, modal input isolation, expandable plots and pagination, XSS-safe history, transaction ledger, legacy reward request and completion, 390px mobile and 1440px desktop.'));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
