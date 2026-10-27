// Run the static server first, then: node tests/farm-actors.cjs
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
 await p.goto((process.env.FARM_BASE_URL || 'http://127.0.0.1:8000') + '/farmgame.html');
 await p.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.hensGroup?.length===2);
 const checks=[];
 const paths=await p.evaluate(async()=>{
  const {randomHenPosition}=await import('/js/farm/scenery.js');
  const s=window.__farmGame.scene.getScene('MyFarmScene');
  for(const level of [1,2,3]) {
   s.farmData.coopLevel=level;s.syncHens();
   const edge=s.coop.getBounds().bottom;
   for(const hen of s.hensGroup) if(hen.getBounds().top<edge) throw Error('Hen spawned on coop');
   let previous=randomHenPosition(s);
   for(let n=0;n<300;n++) {
    const next=randomHenPosition(s);
    for(let step=0;step<=10;step++) {
     const y=previous.y+(next.y-previous.y)*step/10;
     if(y-32<edge || y+32>s.gardenBounds.top) throw Error('Hen route crosses coop or garden');
    }
    previous=next;
   }
  }
  const sign=s.children.list.find(o=>o.texture?.key==='signboard');
  if(!sign?.input?.enabled || sign.displayWidth!==32)throw Error('Sign missing or not interactive');
  sign.emit('pointerdown');
  s.prepareToLayEgg();
  return {levels:3,segments:900};
 });
 await p.waitForTimeout(2300);
 await p.evaluate(()=>{const s=window.__farmGame.scene.getScene('MyFarmScene');for(const h of s.hensGroup){if(h.getBounds().top<s.coop.getBounds().bottom)throw Error('Laying hens overlap coop');}});
 if(process.env.FARM_SCREENSHOTS) await p.screenshot({path:process.env.FARM_SCREENSHOTS+'/farm-sign-path.png',fullPage:true});
 checks.push({paths});
 await p.evaluate(()=>{window.__between=Phaser.Math.Between;Phaser.Math.Between=(min,max)=>max;window.__farmGame.scene.getScene('MyFarmScene').scene.start('VisitScene',{targetAccountId:'render-test',targetName:'Test'});});
 await p.waitForFunction(()=>window.__farmGame.scene.isActive('VisitScene') && window.__farmGame.scene.getScene('VisitScene').hensGroup?.length===2);
 await p.evaluate(()=>{Phaser.Math.Between=window.__between;});
 for(const kind of ['wolf','tiger']) {
  const cap=kind[0].toUpperCase()+kind.slice(1);
  await p.evaluate(({kind,cap})=>{
   const s=window.__farmGame.scene.getScene('VisitScene');s['spawn'+cap+'Event']();
   if(s[kind].anims.currentAnim.key!==kind+'_walk')throw Error('Approach must start walking');
   const animal=s[kind],duration=kind==='wolf'?60000:50000;
   if(animal.moveTween.duration!==duration)throw Error('Wrong approach duration');
   const expectedFlip=kind==='wolf';
   if(animal.flipX!==expectedFlip || animal.frame.width!==256 || animal.displayWidth!==192)throw Error('Pixel frame or direction mismatch');
   for(const action of ['walk','run','hit','dead']) if(s.anims.get(kind+'_'+action).frames.length!==4)throw Error('Missing animation frames');
  },{kind,cap});
  await p.waitForTimeout(1100);
  await p.evaluate(kind=>{const s=window.__farmGame.scene.getScene('VisitScene'),a=s[kind];if(a.anims.currentAnim.key!==kind+'_walk')throw Error('Approach should remain walking');window.__hitPosition={x:a.x,y:a.y};a.emit('pointerdown',{x:a.x,y:a.y});if(a.anims.currentAnim.key!==kind+'_hit'||a.moveTween.isPaused())throw Error('Hit must animate without pausing travel');},kind);
  await p.waitForTimeout(180);
  await p.evaluate(kind=>{const a=window.__farmGame.scene.getScene('VisitScene')[kind];if(a.y>=window.__hitPosition.y)throw Error('Attack stopped forward movement');},kind);
  if(process.env.FARM_SCREENSHOTS)await p.screenshot({path:process.env.FARM_SCREENSHOTS+'/'+kind+'-hit.png',fullPage:true});
  await p.waitForTimeout(500);
  await p.evaluate(kind=>{const a=window.__farmGame.scene.getScene('VisitScene')[kind];if(a.anims.currentAnim.key!==kind+'_walk'||a.moveTween.isPaused())throw Error('Stun did not recover');},kind);
  await p.evaluate(({kind,cap})=>{
   const s=window.__farmGame.scene.getScene('VisitScene'),a=s[kind];window.__beforeTransactions=window.__transactionCount||0;
   s[kind+'HitCount']=199;a.emit('pointerdown',{x:a.x,y:a.y});
   if(a.anims.currentAnim.key!==kind+'_dead'||a.input.enabled||a.warning.scene)throw Error('Defeat did not disable input or clear warning');
   // A pending hit or escape callback must not grant another reward/penalty.
   a.emit('pointerdown',{x:a.x,y:a.y});s['defeat'+cap]();s[kind+'Escapes']();
   if(window.__transactionCount!==window.__beforeTransactions+1)throw Error('Duplicate defeat transaction');
  },{kind,cap});
  await p.waitForTimeout(750);
  await p.evaluate(kind=>{const a=window.__farmGame.scene.getScene('VisitScene')[kind];if(a.frame.name!==15 || a.anims.currentAnim.key!==kind+'_dead')throw Error('Defeated animal resumed walking');},kind);
  if(process.env.FARM_SCREENSHOTS)await p.screenshot({path:process.env.FARM_SCREENSHOTS+'/'+kind+'-dead.png',fullPage:true});
  await p.waitForTimeout(2100);
  await p.evaluate(kind=>{if(window.__farmGame.scene.getScene('VisitScene')[kind].active)throw Error('Defeated animal not cleaned up');},kind);
  // Verify the timeout escape path uses running frames and ignores later hits.
  await p.evaluate(({kind,cap})=>{
   const s=window.__farmGame.scene.getScene('VisitScene');s['spawn'+cap+'Event']();
   const a=s[kind];const count=window.__transactionCount;s[kind+'Escapes']();
   a.emit('pointerdown',{x:a.x,y:a.y});s[kind+'Escapes']();
   if(a.anims.currentAnim.key!==kind+'_run'||a.input.enabled||a.warning.scene||window.__transactionCount!==count+1)throw Error('Escape state invalid');
  },{kind,cap});
  await p.waitForTimeout(1200);
  checks.push({kind,states:['run','walk','hit','dead','escape'],duplicateTransactions:'prevented'});
 }
 await p.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.spawnWolfEvent();s.wolf.emit('pointerdown',{x:s.wolf.x,y:s.wolf.y});s.scene.start('MyFarmScene');});
 await p.waitForTimeout(1200);
 await p.evaluate(()=>window.__farmGame.scene.getScene('MyFarmScene').scene.start('LobbyScene'));
 await p.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.content?.list.filter(o=>o.texture?.key==='coop').length===2);
 await p.evaluate(()=>{const s=window.__farmGame.scene.getScene('LobbyScene'),houses=s.content.list.filter(o=>o.texture?.key==='coop');if(houses.some(h=>h.displayWidth!==96||!h.input.enabled)||s.content.list.some(o=>o.texture?.key==='mini_house'))throw Error('Lobby must use painted coops');});
 if(process.env.FARM_SCREENSHOTS)await p.screenshot({path:process.env.FARM_SCREENSHOTS+'/farm-neighbors.png',fullPage:true});
 const canvas=await p.locator('canvas').boundingBox();
 await p.mouse.click(canvas.x+80*canvas.width/390,canvas.y+245*canvas.height/844);
 await p.waitForFunction(()=>window.__farmGame.scene.isActive('VisitScene')&&window.__farmGame.scene.getScene('VisitScene').targetAccountId==='neighbor-1');
 checks.push({neighbors:'painted coops with working visit navigation'});
 if(errors.length)throw Error(JSON.stringify(errors));
 console.log(JSON.stringify({passed:true,checks,errors}));
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
