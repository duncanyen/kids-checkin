// Run the static server first, then: node tests/farm-hen-lifecycle.cjs
// Requires Playwright and system Chromium; Firebase reads are mocked and writes prohibited.
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');

(async()=>{
 const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const phaser=execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 const p=await b.newPage({viewport:{width:480,height:950}}); const errors=[]; p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 p.setDefaultTimeout(10000);
 await p.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db = {};'}));
 await p.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:`
 const farm={coins:100,hens:2,coopLevel:1,eggsReady:0,lastLayTime:Date.now(),hensState:[{isSick:false},{isSick:true}],cleanliness:0,warehouseLimit:10};
 export const doc=(...args)=>({args}); export const collection=doc; export const query=doc; export const where=doc;
 export function onSnapshot(ref,cb){queueMicrotask(()=>cb({exists:()=>true,data:()=>({farm})}));return ()=>{};}
 export const getDoc=async ref=>({exists:()=>true,data:()=>ref.args.length===3&&ref.args[1]==='groups'?{members:['render-test','neighbor-1','neighbor-2']}:{farm}}); export const getDocs=async()=>({forEach:()=>{}});
 const deny=()=>{throw Error('Test prohibits database writes')};
 export const setDoc=deny,updateDoc=deny,runTransaction=deny,addDoc=deny,serverTimestamp=deny;
 `}));
 // Mailbox subscriptions are covered separately by farm-mail-browser.cjs.
 await p.route('**/js/farm/mail-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmMail(){}'}));
 await p.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await p.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'render-test',groupId:'render-test',name:'Test'})));
 await p.goto((process.env.FARM_BASE_URL || 'http://127.0.0.1:8000') + '/farmgame.html');
 await p.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.hensGroup?.length===2);
 const results=[];
 for (const key of ['MyFarmScene','VisitScene']) {
  if(key==='VisitScene') {
   await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetAccountId:'render-test',targetName:'Test'}));
   await p.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.hensGroup?.length===2);
  }
  await p.waitForFunction(key=>!!window.__farmGame.scene.getScene(key)?.hensGroup?.[0]?.walkTween,key);
  const result=await p.evaluate(key=>{
   const g=window.__farmGame,s=g.scene.getScene(key),old=s.hensGroup.slice();
   old[0].walkTween.setTimeScale(100);
   if(key==='MyFarmScene') s.syncHens(); else s.syncTargetHens();
   return {key,oldTweens:old.reduce((n,h)=>n+s.tweens.getTweensOf(h).length+s.tweens.getTweensOf(h.statusIcon).length,0),frame:g.loop.frame,sickWalking:!!s.hensGroup[1].walkTween};
  },key);
  await p.waitForTimeout(1200);
  const frame=await p.evaluate(()=>window.__farmGame.loop.frame);
  if(result.oldTweens || result.sickWalking || frame<=result.frame || errors.length) throw Error(JSON.stringify({result,frame,errors}));
  results.push({...result,frameAfter:frame});
 }
 await p.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').scene.start('MyFarmScene'));
 await p.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene'));
 await p.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');s.prepareToLayEgg();s.syncHens();if(s.isHenSitting)throw Error('Replacement hens remain stuck sitting');});
 await p.waitForTimeout(5500);
 if(errors.length) throw Error(JSON.stringify(errors));
 console.log(JSON.stringify({passed:true,results,layingResync:'passed',errors}));
await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
