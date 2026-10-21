// Run the static server first, then: node tests/farm-hen-avoidance.cjs
// Requires Playwright, curl, and system Chromium. All Firebase operations are mocked.
// Transaction callbacks are never executed; tests count requests without writing data.
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');

(async()=>{
 const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const phaser=execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 const p=await b.newPage({viewport:{width:390,height:960}}); const errors=[]; p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 p.setDefaultTimeout(10000);
 await p.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db = {};'}));
 await p.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:`
 const farm={coins:100,hens:2,coopLevel:1,eggsReady:0,lastLayTime:Date.now(),hensState:[{isSick:false},{isSick:true}],cleanliness:0,warehouseLimit:10};
 export const doc=(...args)=>({args}); export const collection=doc; export const query=doc; export const where=doc;
 export function onSnapshot(ref,cb){queueMicrotask(()=>cb({exists:()=>true,data:()=>({farm})}));return ()=>{};}
 export const getDoc=async()=>({exists:()=>true,data:()=>({farm})});
 export const getDocs=async()=>({forEach:cb=>[{accountId:'render-test',name:'Self'},{accountId:'neighbor-1',name:'鄰居一'},{accountId:'neighbor-2',name:'鄰居二'}].forEach(data=>cb({data:()=>data}))});
 const deny=()=>{throw Error('Test prohibits database writes')};
 export const setDoc=deny,updateDoc=deny,addDoc=deny,serverTimestamp=deny;
 export const runTransaction=async()=>{window.__transactionCount=(window.__transactionCount||0)+1;return false;};
 `}));
 await p.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','window.__farmGame =')});});
 await p.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'render-test',groupId:'render-test',name:'Test'})));
 await p.goto((process.env.FARM_BASE_URL || 'http://127.0.0.1:8000') + '/farmgame.html');
 await p.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.hensGroup?.length===2);

 const geometry=await p.evaluate(async()=>{
  const {segmentIsSafe}=await import('/js/farm/hen-navigation.js');
  const zones=[{left:10,right:20,top:10,bottom:20}];
  const cases=[
   [{x:0,y:15},{x:30,y:15},false],
   [{x:0,y:0},{x:30,y:30},false],
   [{x:0,y:0},{x:30,y:0},true],
   [{x:0,y:10},{x:30,y:10},false],
   [{x:15,y:15},{x:15,y:15},false],
   [{x:5,y:5},{x:5,y:5},true],
  ];
  for(const [a,b,expected]of cases)if(segmentIsSafe(a,b,zones)!==expected)throw Error('Path intersection regression');
  return cases.length;
 });
 await p.evaluate(()=>{window.__between=Phaser.Math.Between;Phaser.Math.Between=(min,max)=>max;window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetAccountId:'render-test',targetName:'Test'});});
 await p.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.hensGroup?.length===2);
 await p.evaluate(()=>{
  Phaser.Math.Between=window.__between;
  const s=window.__farmGame.scene.getScene('VisitScene');
  s.targetFarmData.hens=8;s.targetFarmData.hensState=Array.from({length:8},(_,i)=>({isSick:i===7}));s.syncTargetHens();
  for(const h of s.hensGroup){s.tweens.killTweensOf(h);h.walkTimer?.remove();h.setPosition(300,400);h.walkPath=[{x:60,y:400}];h.walkTween=s.tweens.add({targets:h,x:60,y:400,duration:4000});}
  s.spawnWolfEvent();s.wolf.moveTween.pause();
  if(s.wolf.displayWidth!==192||s.wolf.frame.width!==256||s.wolf.input.hitArea.width!==208)throw Error('High resolution sprite/hit target not doubled');
 });
 const phases=[];
 async function assertClear(label){
  await p.waitForTimeout(1800);
  const result=await p.evaluate(async()=>{
   const s=window.__farmGame.scene.getScene('VisitScene');
   const {getThreatZones,pointIsSafe,henRouteIsSafe}=await import('/js/farm/hen-navigation.js');
   const zones=getThreatZones(s);
   for(const h of s.hensGroup){
    if(!pointIsSafe(h,zones)||!henRouteIsSafe(s,h))throw Error('Hen overlaps or routes through predator');
    if(h.getBounds().top<s.coop.getBounds().bottom || h.y>422)throw Error('Fleeing hen crossed coop or garden');
    if(h.statusIcon&&Math.abs(h.statusIcon.x-h.x)>1)throw Error('Sick icon did not follow fleeing hen');
   }
   return {hens:s.hensGroup.length,threats:zones.length};
  });
  phases.push({label,...result});
 }
 await assertClear('already walking when wolf appears');
 await p.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.wolf.setPosition(200,440);});
 await assertClear('predator moves across current route');
 await p.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.targetFarmData.coopLevel=3;s.syncTargetHens();});
 await assertClear('farm resync and upgraded coop');
 await p.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.wolf.setPosition(320,500);s.spawnTigerEvent();s.tiger.moveTween.pause();s.tiger.setPosition(70,500);});
 await assertClear('two visible predators');
 if(process.env.FARM_SCREENSHOTS)await p.screenshot({path:process.env.FARM_SCREENSHOTS+'/farm-large-predators.png',fullPage:true});
 await p.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.wolf.destroy();s.tiger.destroy();s.scene.start('MyFarmScene');});
 await p.waitForTimeout(1000);
 if(errors.length)throw Error(JSON.stringify(errors));
 console.log(JSON.stringify({passed:true,geometry,phases,errors}));await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
