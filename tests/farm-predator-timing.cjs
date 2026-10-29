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

 for (const kind of ['wolf', 'tiger']) {
  await p.evaluate(async kind=>{
   const s=window.__farmGame.scene.getScene('VisitScene');
   window.__predatorModule=await import('/js/farm/predators.js');
   s.time.timeScale=4;s.tweens.timeScale=4;
   window.__arrivals=[];window.__attacks=[];window.__attackDetails=[];window.__patrolDirections=[];window.__patrolErrors=[];
   const original=s[kind+'Escapes'].bind(s);
   s[kind+'Escapes']=()=>{
    const a=s[kind],area=window.__predatorModule.predatorPatrolArea(s);
    window.__arrivals.push({kind,elapsed:a.deadlineTimer.elapsed,inClearing:a.x>=area.left-.1&&a.x<=area.right+.1&&Math.abs(a.y-area.y)<.1});original();
   };
   s['spawn'+kind[0].toUpperCase()+kind.slice(1)+'Event']();
   const a=s[kind];
   if(a.y<700||(kind==='wolf'?a.x<290:a.x>100))throw Error('Wrong entry corner '+kind);
   if(a.moveTween.duration!==10000||a.deadlineTimer.delay!==(kind==='wolf'?60000:50000))throw Error('Incorrect approach/deadline '+kind);
   a.moveTween.on('complete',()=>{window.__arrivedAt=a.deadlineTimer.elapsed;});
   a.on('animationstart',animation=>{
    if(animation.key!==kind+'_attack')return;
    window.__attacks.push(a.deadlineTimer.elapsed);
    window.__attackDetails.push({flip:a.flipX,nearest:a.attackTarget===window.__predatorModule.nearestPredatorHen(s,a),paused:a.moveTween.isPaused()});
   });
   s.events.on('update',()=>{
    if(!a.active||!a.getData('patrolling')||a.getData('resolved'))return;
    const area=window.__predatorModule.predatorPatrolArea(s);
    if(a.x<area.left-.1||a.x>area.right+.1||Math.abs(a.y-area.y)>.1)window.__patrolErrors.push({kind,x:a.x,y:a.y,area});
    if(a.anims.currentAnim.key===kind+'_walk'&&!window.__patrolDirections.includes(a.flipX))window.__patrolDirections.push(a.flipX);
   });
  },kind);
  console.log('Verifying '+kind+' entry, hen attacks, patrol and deadline...');
  for(let n=0;n<5;n++) {
   await p.waitForTimeout(400);
   await p.evaluate(kind=>{const a=window.__farmGame.scene.getScene('VisitScene')[kind];a.emit('pointerdown',{x:a.x,y:a.y});if(a.moveTween.isPaused())throw Error('Hit paused approach');},kind);
  }
  await p.waitForFunction(kind=>window.__farmGame.scene.getScene('VisitScene')[kind].getData('patrolling'),kind,{timeout:12000});
  await p.evaluate(kind=>{
   const s=window.__farmGame.scene.getScene('VisitScene'),a=s[kind];
   if(a.y<=s.coop.getBounds().bottom||a.y>=s.gardenBounds.top)throw Error('Predator did not enter hens clearing');
   const remaining=a.deadlineTimer.getRemaining();a.emit('pointerdown',{x:a.x,y:a.y});
   if(a.attackTimer.delay!==5000||remaining!==a.deadlineTimer.getRemaining())throw Error('Attack interval or deadline changed');
  },kind);
  for(const viewport of [{width:1440,height:900},{width:390,height:960}]) {
   await p.setViewportSize(viewport);await p.waitForTimeout(100);
   await p.evaluate(kind=>{
    const s=window.__farmGame.scene.getScene('VisitScene'),a=s[kind],area=window.__predatorModule.predatorPatrolArea(s);
    if(a.x<area.left-.1||a.x>area.right+.1||Math.abs(a.y-area.y)>.1)throw Error('Resize moved predator outside clearing');
    if(a.deadlineTimer.delay!==(kind==='wolf'?60000:50000)||a.getData('resolved'))throw Error('Resize reset encounter');
   },kind);
  }
  // Hold the actual hen sprites still to check attacks toward both sides.
  await p.evaluate(()=>{
   const s=window.__farmGame.scene.getScene('VisitScene'),area=window.__predatorModule.predatorPatrolArea(s);
   s.avoidPredators=()=>{};
   s.hensGroup.forEach((hen,i)=>{s.tweens.killTweensOf(hen);hen.walkTimer?.remove();hen.setPosition(area.left-30-i*60,area.y);});
   window.__transactionsBeforeAttack=window.__transactionCount;
  });
  await p.waitForFunction(()=>window.__attacks.length>=1,null,{timeout:8000});
  await p.evaluate(()=>{
   if(!window.__attackDetails[0].flip)throw Error('Predator failed to attack hens on its left');
   const s=window.__farmGame.scene.getScene('VisitScene'),area=window.__predatorModule.predatorPatrolArea(s);
   s.hensGroup.forEach((hen,i)=>hen.setPosition(area.right+30+i*60,area.y));
  });
  await p.waitForFunction(()=>window.__attacks.length>=2,null,{timeout:12000});
  await p.evaluate(()=>{
   const times=window.__attacks;
   // At 4x speed, timer activation can span several observed game frames.
   if(Math.abs(times[0]-window.__arrivedAt-5000)>500||Math.abs(times[1]-times[0]-5000)>500)throw Error('Incorrect attack cadence '+JSON.stringify({times,arrived:window.__arrivedAt}));
   if(window.__attackDetails[1].flip||window.__attackDetails.some(a=>!a.nearest||!a.paused))throw Error('Attack did not pause and face nearest hen');
   if(window.__transactionCount!==window.__transactionsBeforeAttack)throw Error('Visual attacks wrote economy data');
  });
  await p.screenshot({path:'/tmp/'+kind+'-clearing-patrol.png',fullPage:true});
  await p.waitForFunction(()=>window.__arrivals.length===1,null,{timeout:25000});
  await p.evaluate(kind=>{
   const result=window.__arrivals[0],deadline=kind==='wolf'?60000:50000;
   if(Math.abs(result.elapsed-deadline)>500||!result.inClearing)throw Error('Incorrect timeout '+JSON.stringify(result));
   if(window.__patrolErrors.length||window.__patrolDirections.length!==2)throw Error('Patrol did not turn both ways within clearing '+JSON.stringify(window.__patrolErrors));
   if(window.__attacks.some(t=>t>=deadline+500))throw Error('Attack continued after escape');
   if(window.__farmGame.scene.getScene('VisitScene')[kind].moveTween.isPlaying())throw Error('Escape did not stop patrol');
  },kind);
  await p.waitForTimeout(400);
  console.log(JSON.stringify(await p.evaluate(()=>({passed:true,arrival:window.__arrivals[0],attacks:window.__attacks}))));
 }
 if(errors.length)throw Error(JSON.stringify(errors));
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
