// Run the static server first, then: node tests/farm-predator-timing.cjs
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
 export const getDoc=async ref=>({exists:()=>true,data:()=>ref.args.length===3&&ref.args[1]==='groups'?{members:['render-test','neighbor-1','neighbor-2']}:{farm}}); export const getDocs=async()=>({forEach:()=>{}});
 const deny=()=>{throw Error('Test prohibits database writes')};
 export const setDoc=deny,updateDoc=deny,addDoc=deny,serverTimestamp=deny;
 export const runTransaction=async()=>{window.__transactionCount=(window.__transactionCount||0)+1;return false;};
 `}));
 // Mailbox subscriptions are covered separately by farm-mail-browser.cjs.
 await p.route('**/js/farm/mail-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmMail(){}'}));
 await p.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await p.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'render-test',groupId:'render-test',name:'Test'})));
 await p.goto((process.env.FARM_BASE_URL || 'http://127.0.0.1:8000') + '/farmgame.html');
 await p.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.hensGroup?.length===2);

 await p.evaluate(()=>{Phaser.Math.Between=(min,max)=>max;window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetAccountId:'render-test',targetName:'Test'});});
 await p.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene')?.hensGroup?.length===2);
 await p.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('VisitScene');window.__arrivals=[];
  window.__tigerModule=await import('/js/farm/predators.js');
  s.time.timeScale=4;s.tweens.timeScale=4;
  for(const kind of ['wolf','tiger']) {
   const original=s[kind+'Escapes'].bind(s);
   s[kind+'Escapes']=()=>{
    const a=s[kind],area=window.__tigerModule.tigerPatrolArea(s);
    window.__arrivals.push({kind,elapsed:kind==='tiger'?a.deadlineTimer.elapsed:a.moveTween.elapsed,x:a.x,y:a.y,targetX:s.coop.x,targetY:kind==='tiger'?area.y:s.coop.y+s.coop.displayHeight/2+20,inClearing:a.x>=area.left-.1&&a.x<=area.right+.1});original();
   };
   const cap=kind[0].toUpperCase()+kind.slice(1);s['spawn'+cap+'Event']();
  }
  const tiger=s.tiger;
  if(tiger.y<700||tiger.x>100)throw Error('Tiger did not enter from lower left');
  if(tiger.moveTween.duration!==10000||tiger.deadlineTimer.delay!==50000)throw Error('Incorrect approach/deadline duration');
  tiger.moveTween.on('complete',()=>{window.__tigerArrivedAt=tiger.deadlineTimer.elapsed;});
  window.__tigerAttacks=[];window.__attackDetails=[];window.__patrolDirections=[];window.__patrolErrors=[];
  tiger.on('animationstart',animation=>{
   if(animation.key!=='tiger_attack')return;
   window.__tigerAttacks.push(tiger.deadlineTimer.elapsed);
   window.__attackDetails.push({flip:tiger.flipX,nearest:tiger.attackTarget===window.__tigerModule.nearestTigerHen(s,tiger),paused:tiger.moveTween.isPaused()});
  });
  s.events.on('update',()=>{
   if(!tiger.active||!tiger.getData('patrolling')||tiger.getData('resolved'))return;
   const area=window.__tigerModule.tigerPatrolArea(s);
   if(tiger.x<area.left-.1||tiger.x>area.right+.1||Math.abs(tiger.y-area.y)>.1)window.__patrolErrors.push({x:tiger.x,y:tiger.y,area});
   if(tiger.anims.currentAnim.key==='tiger_walk'&&!window.__patrolDirections.includes(tiger.flipX))window.__patrolDirections.push(tiger.flipX);
  });
 });
 console.log('Verifying 50/60-second Phaser deadlines while repeatedly attacking...');
 for(let n=0;n<5;n++) {
  await p.waitForTimeout(400);
  await p.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');for(const kind of ['wolf','tiger']){const a=s[kind];a.emit('pointerdown',{x:a.x,y:a.y});if(a.moveTween.isPaused())throw Error('Hit paused deadline');}});
 }
 await p.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').tiger.getData('patrolling'),null,{timeout:12000});
 await p.evaluate(()=>{
  const s=window.__farmGame.scene.getScene('VisitScene'),a=s.tiger;
  if(a.y<=s.coop.getBounds().bottom||a.y>=s.gardenBounds.top)throw Error('Tiger did not enter hens clearing');
  const remaining=a.deadlineTimer.getRemaining();a.emit('pointerdown',{x:a.x,y:a.y});
  if(a.attackTimer.delay!==5000)throw Error('Attack interval changed');
  if(remaining!==a.deadlineTimer.getRemaining())throw Error('Hit extended 50s deadline');
 });
 for(const viewport of [{width:1440,height:900},{width:390,height:960}]) {
  await p.setViewportSize(viewport);await p.waitForTimeout(100);
  await p.evaluate(()=>{
   const s=window.__farmGame.scene.getScene('VisitScene'),a=s.tiger;
   const area=window.__tigerModule.tigerPatrolArea(s);
   if(a.x<area.left-.1||a.x>area.right+.1||Math.abs(a.y-area.y)>.1)throw Error('Resize moved tiger outside clearing');
   if(a.deadlineTimer.delay!==50000||a.getData('resolved'))throw Error('Resize reset encounter');
  });
 }
 // Hold the real hen sprites still to check attacks toward either side.
 await p.evaluate(()=>{
  const s=window.__farmGame.scene.getScene('VisitScene'),area=window.__tigerModule.tigerPatrolArea(s);
  s.avoidPredators=()=>{};
  s.hensGroup.forEach((hen,i)=>{s.tweens.killTweensOf(hen);hen.walkTimer?.remove();hen.setPosition(area.left-30-i*60,area.y);});
  window.__transactionsBeforeAttack=window.__transactionCount;
 });
 await p.waitForFunction(()=>window.__tigerAttacks.length>=1,null,{timeout:8000});
 await p.evaluate(()=>{
  if(!window.__attackDetails[0].flip)throw Error('Tiger failed to attack hens on its left');
  const s=window.__farmGame.scene.getScene('VisitScene'),area=window.__tigerModule.tigerPatrolArea(s);
  s.hensGroup.forEach((hen,i)=>hen.setPosition(area.right+30+i*60,area.y));
 });
 await p.waitForFunction(()=>window.__tigerAttacks.length>=2,null,{timeout:12000});
 await p.evaluate(()=>{
  const times=window.__tigerAttacks;
  // At 4x speed, timer activation and observation can span multiple game frames.
  if(Math.abs(times[0]-window.__tigerArrivedAt-5000)>500||Math.abs(times[1]-times[0]-5000)>500)throw Error('Incorrect attack cadence '+JSON.stringify({times,arrived:window.__tigerArrivedAt}));
  if(window.__attackDetails[1].flip||window.__attackDetails.some(a=>!a.nearest||!a.paused))throw Error('Tiger did not pause and face the nearest hen');
  if(window.__transactionCount!==window.__transactionsBeforeAttack)throw Error('Visual attacks wrote economy data');
 });
 await p.screenshot({path:'/tmp/tiger-clearing-patrol.png',fullPage:true});
 await p.waitForFunction(()=>window.__arrivals.length===2,null,{timeout:65000});
 const arrivals=await p.evaluate(()=>window.__arrivals);
 for(const a of arrivals)if(Math.abs(a.elapsed-(a.kind==='wolf'?60000:50000))>500 || Math.abs(a.y-a.targetY)>0.01 || (a.kind==='tiger'?!a.inClearing:Math.abs(a.x-a.targetX)>0.01))throw Error(JSON.stringify(a));
 await p.evaluate(()=>{if(window.__patrolErrors.length||window.__patrolDirections.length!==2)throw Error('Patrol must turn both ways and stay inside clearing '+JSON.stringify(window.__patrolErrors));});
 if(errors.length)throw Error(JSON.stringify(errors));
 const attacks=await p.evaluate(()=>window.__tigerAttacks);
 if(attacks.some(t=>t>=50500))throw Error('Attack continued after escape');
 console.log(JSON.stringify({passed:true,arrivals,attacks,errors}));await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
