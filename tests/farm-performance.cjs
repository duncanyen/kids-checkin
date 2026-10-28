// Run the static server first, then: node tests/farm-hen-lifecycle.cjs
// Requires Playwright and system Chromium; Firebase reads are mocked and writes prohibited.
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');

(async()=>{
 const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const phaser=require('node:fs').readFileSync('/tmp/kids-phaser.js','utf8');
 const p=await b.newPage({viewport:{width:480,height:950}}); const errors=[]; p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 p.setDefaultTimeout(10000);
 if(process.env.BASELINE==='1') await p.route('**/js/farm/*.js',async r=>{
 const path=new URL(r.request().url()).pathname.slice(1);
 try{const body=execFileSync('git',['show','699cd54:'+path],{encoding:'utf8'});await r.fulfill({contentType:'text/javascript',body});}catch{await r.continue();}
 });
 await p.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db = {};'}));
 await p.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:`
 const farm={coins:100,hens:2,coopLevel:1,eggsReady:0,lastLayTime:Date.now(),hensState:[{isSick:false},{isSick:true}],cleanliness:0,warehouseLimit:10};
 export const doc=(...args)=>({args}); export const collection=doc; export const query=doc; export const where=doc;
 export function onSnapshot(ref,cb){window.__farmListeners=(window.__farmListeners||0)+1;window.__farmSubscriptions=(window.__farmSubscriptions||0)+1;let active=true;queueMicrotask(()=>cb({exists:()=>true,data:()=>({farm})}));return ()=>{if(active){active=false;window.__farmListeners--;}};}
 export const getDoc=async ref=>({exists:()=>true,data:()=>ref.args.length===3&&ref.args[1]==='groups'?{members:['render-test','neighbor-1','neighbor-2']}:{farm}}); export const getDocs=async()=>({forEach:()=>{}});
 const deny=()=>{throw Error('Test prohibits database writes')};
 export const setDoc=deny,updateDoc=deny,runTransaction=deny,addDoc=deny,serverTimestamp=deny;
 `}));
 // Mailbox subscriptions are covered separately by farm-mail-browser.cjs.
 await p.route('**/js/farm/mail-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmMail(){}'}));
 await p.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await p.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'render-test',groupId:'render-test',name:'Test'})));
 const loadStart=Date.now();
 await p.goto((process.env.FARM_BASE_URL || 'http://127.0.0.1:8012') + '/farmgame.html');
 await p.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.hensGroup?.length===2);
 const started=Date.now();
 const initial=await p.evaluate(()=>({version:Phaser.VERSION,objects:__farmGame.scene.getScene('MyFarmScene').children.length,textures:__farmGame.textures.getTextureKeys().length}));
 initial.firstEnterMs=Date.now()-loadStart;
 const samples=[];
 for(let i=0;i<20;i++){
  for(const key of ['ShopScene','WarehouseScene','MyFarmScene']){
   await p.evaluate(key=>{const g=__farmGame;g.scene.getScenes(true)[0].scene.start(key);},key);
   await p.waitForFunction(key=>__farmGame.scene.isActive(key),key);
  }
  samples.push(await p.evaluate(()=>{const g=__farmGame;return {shopShutdown:g.scene.getScene('ShopScene').events.listenerCount('shutdown'),warehouseShutdown:g.scene.getScene('WarehouseScene').events.listenerCount('shutdown'),registry:g.registry.events.listenerCount('changedata-myFarmData'),objects:g.scene.getScene('MyFarmScene').children.length,timers:g.scene.getScene('MyFarmScene').time._active.length,listeners:window.__farmListeners,subscriptions:window.__farmSubscriptions};}));
 }
 const spriteCheck = await p.evaluate(()=>{
 const g=__farmGame,s=g.scene.getScene('MyFarmScene'),hen=s.hensGroup[0],timer=s.farmInterval;
 for(let i=0;i<20;i++)g.registry.set('myFarmData',{...g.registry.get('myFarmData'),coins:100+i});
 return {sameSprite:hen===s.hensGroup[0],sameTimer:timer===s.farmInterval};
 });
 const intervals=[];await p.evaluate(()=>{window.__frames=[];window.__frameLast=performance.now();window.__sample=()=>{const n=performance.now();__frames.push(n-__frameLast);__frameLast=n;};__farmGame.events.on('poststep',__sample);});
 await p.waitForTimeout(Number(process.env.SOAK_MS||5000));
 const frames=await p.evaluate(()=>{__farmGame.events.off('poststep',__sample);return __frames;});frames.sort((a,b)=>a-b);
 const result={initial,samples,spriteCheck,soakMs:Number(process.env.SOAK_MS||5000),frames:{count:frames.length,median:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],p99:frames[Math.floor(frames.length*.99)],averageFps:1000/(frames.reduce((a,b)=>a+b,0)/frames.length)},errors};
 await p.evaluate(()=>{__farmGame.events.once('destroy',()=>window.__destroyed=true);__farmGame.destroy(true);});
 await p.waitForTimeout(500);
 result.destroyed=await p.evaluate(()=>({event:!!window.__destroyed,canvasRemoved:!__farmGame.canvas.isConnected,running:__farmGame.loop.running,atmosphere:document.getElementById('farm-atmosphere')?.dataset.active}));
 if(process.env.BASELINE!=='1'){
 const assert=require('node:assert/strict');
 assert.ok(samples.every(s=>s.shopShutdown===1&&s.warehouseShutdown===1&&s.listeners===1));
 assert.deepEqual(spriteCheck,{sameSprite:true,sameTimer:true});
 assert.deepEqual(result.destroyed,{event:true,canvasRemoved:true,running:false,atmosphere:'false'});
 }
 require('node:fs').writeFileSync(process.env.OUTPUT||'/tmp/farm-phase5.json',JSON.stringify(result,null,2));
 if(errors.length)throw Error(JSON.stringify(errors));
 console.log(JSON.stringify(result));await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
