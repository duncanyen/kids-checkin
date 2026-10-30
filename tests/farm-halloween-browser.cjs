// Run the static server first, then: node tests/farm-map.cjs
// Requires Playwright, curl, and system Chromium. All Firebase operations are mocked.
// Transaction callbacks are never executed; tests count requests without writing data.
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict'),fs=require('node:fs');

(async()=>{
 const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const phaser=fs.readFileSync('/tmp/kids-phaser.js','utf8') || execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 const p=await b.newPage({viewport:{width:390,height:900},timezoneId:'America/Los_Angeles'}); const errors=[]; p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 p.setDefaultTimeout(10000);
 await p.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db = {};'}));
 await p.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:`
 const farm={coins:100,hens:2,coopLevel:1,eggsReady:0,lastLayTime:Date.now(),hensState:[{isSick:false},{isSick:true}],cleanliness:0,warehouseLimit:10};
 export const doc=(...args)=>({args}); export const collection=doc; export const query=doc; export const where=doc;
 export function onSnapshot(ref,cb){queueMicrotask(()=>cb({exists:()=>true,data:()=>({farm})}));return ()=>{};}
 export const getDoc=async ref=>({exists:()=>true,data:()=>ref.args.length===3&&ref.args[1]==='groups'?{members:['render-test','neighbor-1','neighbor-2']}:{farm}});
 export const getDocs=async()=>({forEach:cb=>[{accountId:'render-test',name:'Self'},{accountId:'neighbor-1',name:'鄰居一'},{accountId:'neighbor-2',name:'鄰居二'}].forEach(data=>cb({data:()=>data}))});
 const deny=()=>{throw Error('Test prohibits database writes')};
 export const setDoc=deny,updateDoc=deny,addDoc=deny,serverTimestamp=deny;
 export const runTransaction=async()=>{window.__transactionCount=(window.__transactionCount||0)+1;return false;};
 `}));
 // Mailbox subscriptions are covered separately by farm-mail-browser.cjs.
 await p.route('**/js/farm/mail-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmMail(){}'}));
 await p.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await p.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'render-test',groupId:'render-test',name:'Test'})));
 let serverNow=Date.parse('2026-10-30T12:00:00+08:00'),clockRequests=0,seasonRequests=0;
 await p.route('**/farmgame.html?event-clock=*',r=>{clockRequests++;return r.fulfill({status:200,headers:{date:new Date(serverNow).toUTCString()},body:''});});
 p.on('request',request=>{if(/halloween-2026\.(png|json)/.test(request.url()))seasonRequests++;});
 await p.addInitScript(()=>{Date.now=()=>Date.parse('1999-01-01T00:00:00Z');});
 await p.goto((process.env.FARM_BASE_URL || 'http://127.0.0.1:8000') + '/farmgame.html');
 await p.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.hensGroup?.length===2);


 await p.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').halloween?.active);
 await p.waitForTimeout(1200);
 assert.equal(clockRequests,1);assert.equal(seasonRequests,2);
 const baseline=await p.evaluate(()=>({farm:JSON.stringify(__farmGame.scene.getScene('MyFarmScene').farmData),updates:__farmGame.scene.getScene('MyFarmScene').events.listenerCount('update')}));
 const checks=[];
 for(const viewport of [{width:390,height:900},{width:1440,height:900},{width:844,height:390}]){
  await p.setViewportSize(viewport);await p.waitForTimeout(200);
  await p.evaluate(()=>{
   const s=__farmGame.scene.getScene('MyFarmScene');
   const overlaps=(a,b)=>Phaser.Geom.Intersects.RectangleToRectangle(a,b);
   if(s.halloween.ornaments.length!==8)throw Error('Missing decorations');
   for(const item of s.halloween.ornaments){
    if(item.input?.enabled)throw Error('Decorations intercept input');
    const box=item.getBounds();
    if(overlaps(box,s.coopEgg.getBounds())||overlaps(box,s.coop.levelBadge.getBounds()))throw Error('Decoration covers egg or level plaque '+item.frame.name);
    if(s.gardenPlants.some(plant=>overlaps(box,plant.getBounds())))throw Error('Decoration covers cabbage '+item.frame.name);
   }
  });
  await p.screenshot({path:'/tmp/farm-halloween-'+viewport.width+'.png',fullPage:true});
  checks.push('layout '+viewport.width);
 }
 await p.setViewportSize({width:390,height:900});
 // Actual Phaser clicks still reach the coop and cabbage beneath the overlay.
 await p.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');s.farmData.cleanliness=20;s.coop.emit('pointerdown');if(!s.dialogContainer.visible)throw Error('Coop input blocked');s.dialogContainer.setVisible(false);});
 async function scene(key,data={}){
  await p.evaluate(({key,data})=>new Promise(resolve=>{
   const game=__farmGame,current=game.scene.getScenes(true).find(s=>s.scene.key!=='FarmAssetScene');
   game.scene.getScene(key).events.once('create',resolve);current.scene.start(key,data);
  }),{key,data});
 }
 await scene('VisitScene',{targetAccountId:'render-test',targetName:'Test'});
 await p.waitForFunction(()=>__farmGame.scene.getScene('VisitScene').halloween?.active);
 assert.equal(await p.evaluate(()=>__farmGame.scene.getScene('VisitScene').halloween.ornaments.length),8);
 await scene('LobbyScene');await p.waitForFunction(()=>__farmGame.scene.getScene('LobbyScene').halloween?.active);
 assert.equal(await p.evaluate(()=>__farmGame.scene.getScene('LobbyScene').halloween.ornaments.length),3);
 await p.screenshot({path:'/tmp/farm-halloween-lobby.png',fullPage:true});
 await scene('MyFarmScene');await p.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').halloween?.active);
 assert.equal(seasonRequests,2);assert.equal(clockRequests,1);
 assert.equal(await p.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').events.listenerCount('update')),baseline.updates);
 await p.emulateMedia({reducedMotion:'reduce'});await p.waitForTimeout(120);
 assert.equal(await p.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').halloween.ornaments.find(o=>o.frame.name==='ghost').angle),0);
 // Correct server time to seconds before the deadline, then stop Phaser time.
 // A native boundary timer must remove everything without a page refresh.
 const end=Date.parse('2026-11-01T00:00:00+08:00');serverNow=end-3000;
 await p.evaluate(async()=>{
  const {holidayClock}=await import('/js/farm/holiday-clock.js');await holidayClock(__farmGame).refresh(true);
  const s=__farmGame.scene.getScene('MyFarmScene');s.time.timeScale=0;s.tweens.timeScale=0;s.scene.pause();
 });
 assert.equal(await p.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').halloween.active),true);
 await p.waitForFunction(()=>!__farmGame.scene.getScene('MyFarmScene').halloween.active);
 await p.evaluate(()=>{
  const s=__farmGame.scene.getScene('MyFarmScene');
  if(s.children.list.some(o=>o.name.startsWith('halloween-')))throw Error('Expired layer/glow remains '+JSON.stringify(s.children.list.filter(o=>o.name.startsWith('halloween-')).map(o=>({name:o.name,active:o.active,visible:o.visible,scene:!!o.scene,list:o.list?.length}))));
  s.scene.resume();s.time.timeScale=1;s.tweens.timeScale=1;
 });
 // Offline focus/pageshow cannot restore decorations after monotonic expiry.
 await p.route('**/farmgame.html?event-clock=*',r=>r.abort());
 await p.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});
 await p.waitForTimeout(150);
 assert.equal(await p.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').halloween.active),false);
 await p.screenshot({path:'/tmp/farm-halloween-expired.png',fullPage:true});
 await scene('LobbyScene');assert.equal(await p.evaluate(()=>__farmGame.scene.getScene('LobbyScene').halloween.active),false);
 await scene('VisitScene',{targetAccountId:'render-test',targetName:'Test'});
 assert.equal(await p.evaluate(()=>__farmGame.scene.getScene('VisitScene').halloween.active),false);
 assert.equal(seasonRequests,2);
 // A fresh post-event visit never requests the atlas, even in a different timezone.
 serverNow=end;
 await p.route('**/farmgame.html?event-clock=*',r=>r.fulfill({status:200,headers:{date:new Date(serverNow).toUTCString()},body:''}));
 await p.reload();
 await p.waitForFunction(()=>!!window.__farmGame?.scene.getScene('MyFarmScene')?.halloween);
 await p.evaluate(async()=>{const {holidayClock}=await import('/js/farm/holiday-clock.js');await holidayClock(window.__farmGame).refresh();});
 assert.equal(await p.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').halloween.active),false);
 assert.equal(seasonRequests,2);
 // An in-flight atlas finishing after the cutoff must not create decorations.
 let releaseAtlas,requestedAtlas;
 const atlasGate=new Promise(resolve=>releaseAtlas=resolve),requested=new Promise(resolve=>requestedAtlas=resolve);
 await p.route('**/assets/farm/halloween-2026.png',async r=>{requestedAtlas();await atlasGate;await r.continue();});
 serverNow=Date.parse('2026-10-31T12:00:00+08:00');await p.reload();await requested;
 serverNow=end;
 await p.evaluate(async()=>{const {holidayClock}=await import('/js/farm/holiday-clock.js');await holidayClock(__farmGame).refresh(true);});
 releaseAtlas();await p.waitForFunction(()=>__farmGame.textures.exists('halloween_2026'));
 assert.equal(await p.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').halloween.active),false);
 assert.equal(seasonRequests,4);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:[...checks,'wrong device clock/server correction','no decorative input or cabbage/egg/plaque occlusion','home/visit/lobby and cached atlas','no duplicate scene listeners','native midnight expiry with paused Phaser','offline foreground and post-deadline scene entry','reduced motion','fresh expired visit downloads no atlas','late artwork cannot revive expired decorations'],errors}));
 await b.close();
})().catch(error=>{console.error(error);process.exit(1)});
