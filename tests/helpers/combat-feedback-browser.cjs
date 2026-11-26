const assert=require('node:assert/strict');
const I=require('../../functions/identity-domain.cjs');
const E=require('../../game-admin/functions/encounters.cjs');
exports.run=async({page,calls,db,errors,advance,countdownTests=false,releaseSettlement,criticalMode=false,zeroMode=false})=>{
 const {ENEMY_HEALTH,WEAPONS_CONFIG}=await import('../../js/farm/combat-rules.js');
 const {hitDamage}=await import('../../js/farm/combat-damage.js');
 const key='ops_farm_active/'+I.hash('alice:A'),own=()=>db.data.get('groups/A/users/alice').farm;
 const click=async find=>{
  if(find==='farm')await page.waitForFunction(()=>{const s=window.__farmGame.scene.getScene('LobbyScene');return s?.sys.isActive()&&s.content?.list.some(o=>o.texture?.key==='coop'&&o.input?.enabled);});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const p=await page.evaluate(find=>{const s=window.__farmGame.scene.getScene('LobbyScene'),o=find==='back'?s.children.list.find(o=>o.input?.enabled&&o.x===42&&o.y===50):find==='public'?s.publicVillageButton:find==='village'?s.content.list.find(o=>o.getData('villageGroupId')==='B'):s.content.list.find(o=>o.texture?.key==='coop');const w=o.getWorldTransformMatrix().transformPoint(0,0),p=s.cameras.main.matrix.transformPoint(w.x-s.cameras.main.scrollX,w.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},find);await page.mouse.click(p.x,p.y);
 };
 const state=kind=>page.evaluate(async kind=>{const s=window.__farmGame.scene.getScene('VisitScene'),b=s[kind+'Encounter'],h=b?.healthHUD||s[kind+'HUD'],{monsterHead,screenUnits}=await import('/js/farm/monster-head.js'),head=monsterHead(h.sprite);return {bar:h.bar.width,trail:h.trail.width,health:b?.health??h.health,track:h.track.width,gap:(head.y-h.root.y-h.height/2)/screenUnits(s,1),headX:head.x,barX:h.root.x,textObjects:h.root.list.filter(o=>o.type==='Text').length,statusVisible:(b?.warning||s[kind]?.warning)?.visible,pool:h.pool.filter(t=>t.visible).map(t=>({damage:t.getData('combatDamage'),text:t.text,size:t.style.fontSize,critical:t.getData('combatCritical'),streak:t.getData('combatCriticalStreak'),burst:!!(t.burst?.visible),distance:monsterHead(t.anchorSprite).y-t.y}))};},kind);
 const strike=kind=>page.evaluate(kind=>{const s=window.__farmGame.scene.getScene('VisitScene'),b=s[kind+'Encounter'];if(b){if(['eagle','dragon','hornet'].includes(kind))b.arrowHit(b.archery.getBow());else b.sprite.emit('pointerdown',{x:b.sprite.x,y:b.sprite.y});}else{s[kind].emit('pointerdown',{x:s[kind].x,y:s[kind].y});}},kind);
 await page.locator('.farm-hud-bottom button[aria-label="村落"]').click();
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene')?.farms?.length>0);
 await click('public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');
 await click('village');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B'&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);
 const results=[];
 for(const kind of ['wolf','tiger','eagle','dragon','hornet','gorilla','mole','cobra','giant']){
  const monsters=structuredClone(E.DEFAULTS);for(const m of Object.values(monsters))m.enabled=false;
  monsters[kind].enabled=true;monsters[kind].visit.rate=100;
  if(monsters[kind].interval)monsters[kind].interval=1;
  own().gardenCatchCount=100;own().combatKills={wolf:100,tiger:100,eagle:100};
  db.data.set('ops_game_config/encounters',{monsters,revision:results.length+2});
  await click('farm');
  await page.waitForFunction(kind=>{const s=window.__farmGame.scene.getScene('VisitScene');return s?.entryChecked&&s.backendChallenge?.kind===kind&&!!(s[kind+'Encounter']?.healthHUD||s[kind+'HUD']);},kind).catch(async error=>{console.error('combat-entry-diagnostic',kind,errors,await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');return{active:s.sys.isActive(),entryChecked:s.entryChecked,preparing:s.preparingEncounter,kind:s.backendChallenge?.kind,notice:s.noticeText?.text,timers:document.querySelectorAll('.farm-battle-countdown').length};}));throw error;});
  if(['wolf','tiger'].includes(kind)){
   const motion=await page.evaluate(kind=>{const s=window.__farmGame.scene.getScene('VisitScene');return {approach:s[kind+'Tween'].duration,deadline:s.backendChallenge.deadline-s.backendChallenge.startedAt,walk:s.anims.get(kind+'_walk').frameRate};},kind);
   assert.equal(motion.approach,5000);assert.equal(motion.deadline,kind==='wolf'?60000:50000);assert.equal(motion.walk,12);
  }
  if(['eagle','dragon'].includes(kind)){
   await page.evaluate(kind=>{const b=window.__farmGame.scene.getScene('VisitScene')[kind+'Encounter'];b.arrivalTimer.remove();b.startFire();},kind);
   const motion=await page.evaluate(async kind=>{const b=window.__farmGame.scene.getScene('VisitScene')[kind+'Encounter'],{aerialPatrolPoint}=await import('/js/farm/aerial-patrol.js');const original=b.deadlineTimer.getRemaining;b.deadlineTimer.getRemaining=()=>b.config.durationMs-b.config.flightMs-4500;b.refresh();const expected=aerialPatrolPoint(4.5,b.scene.coop.x,b.scene.coop.getBounds().top);const result={phase:b.phase,x:b.sprite.x,y:b.sprite.y,expected,fireVisible:b.flame.visible,flipX:b.sprite.flipX,animation:b.sprite.anims.currentAnim.key,deadline:b.deadline};b.deadlineTimer.getRemaining=original;return result;},kind);
   assert.equal(motion.phase,'circle');assert.equal(motion.flipX,kind==='dragon'?!motion.expected.flipX:motion.expected.flipX);assert.ok(Math.abs(motion.x-motion.expected.x)<.001);assert.ok(Math.abs(motion.y-motion.expected.y)<.001);
   if(kind==='dragon'){assert.equal(motion.fireVisible,false);assert.equal(motion.animation,'dragon_fly');await page.screenshot({path:'/tmp/gugu-dragon-eagle-route-mobile.png'});}
  }
  if(countdownTests){
   const clock=page.locator('.farm-battle-countdown');await clock.waitFor();assert.equal(await clock.count(),1);assert.equal(await clock.getAttribute('data-monster'),kind);
   const combatCalls=()=>calls.filter(c=>c.name==='gameOpsFarmTransaction'&&['battleAttack','battleSettle','claimEncounter','homeEncounter','visitEncounter'].includes(c.action));const beforeCalls=combatCalls().length,deadline=db.data.get(key).deadline;
   assert.equal(await page.evaluate(kind=>{const s=window.__farmGame.scene.getScene('VisitScene');return(s[kind+'Encounter']?.healthHUD||s[kind+'HUD']).countdown.deadline;},kind),deadline);
   if(kind==='wolf')await page.screenshot({path:'/tmp/gugu-battle-countdown-normal.png'});
   for(const [seconds,phase]of [[10,'urgent'],[5,'danger'],[3,'final'],[0,'expired']]){
    await page.evaluate(({kind,seconds})=>{const s=window.__farmGame.scene.getScene('VisitScene'),c=(s[kind+'Encounter']?.healthHUD||s[kind+'HUD']).countdown;c.originalNow??=c.now;c.now=()=>c.deadline-seconds*1000;c.tick(true);},{kind,seconds});
    assert.equal(await clock.getAttribute('data-phase'),phase);assert.equal(await clock.evaluate(n=>getComputedStyle(n).pointerEvents),'none');
    if(seconds)assert.equal(await clock.locator('.farm-battle-seconds').textContent(),String(seconds));else assert.match(await clock.textContent(),/時間到|確認戰鬥結果/);
    if(kind==='wolf'&&seconds===5){
     await page.setViewportSize({width:320,height:568});await page.screenshot({path:'/tmp/gugu-battle-countdown-urgent-320.png'});
     const bounds=await clock.locator('.farm-battle-clock').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=320);
     await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await clock.locator('img,.farm-battle-vignette,.farm-battle-clock-track,.farm-battle-intro').count(),0);assert.equal(await clock.locator('.farm-battle-seconds').evaluate(n=>getComputedStyle(n).animationName),'none');
     await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:390,height:844});
    }
   }
   assert.equal(combatCalls().length,beforeCalls,'display-only timer adds no combat requests or settlements');
   await page.evaluate(kind=>{const s=window.__farmGame.scene.getScene('VisitScene'),c=(s[kind+'Encounter']?.healthHUD||s[kind+'HUD']).countdown;c.now=c.originalNow;c.tick(true);},kind);
  }
  const battle=structuredClone(db.data.get(key));assert.equal(battle.combatVersion,2);assert.equal(battle.health,db.data.get('ops_game_config/combat')?.monsters?.[kind]?.hp??ENEMY_HEALTH[kind]);advance(6000);
  const mode=['eagle','dragon','hornet'].includes(kind)?'ranged':'melee',weapon=WEAPONS_CONFIG[mode==='ranged'?'paladinbow':'ironhammer'];
  const initial=await state(kind);assert.ok(Math.abs(initial.bar-250/3)<1e-8);assert.equal(initial.textObjects,0);assert.equal(initial.statusVisible,false);assert.ok(Math.abs(initial.gap-96/2.54*.3)<.1);assert.ok(Math.abs(initial.barX-initial.headX)<.1);
  assert.equal(await page.locator('.farm-visit-leave').isDisabled(),true);
  // First ground hit uses the visible monster's real pointer input; subsequent
  // burst dispatches use that same handler to test batching deterministically.
  if(mode==='melee'){
   await page.waitForFunction(kind=>{const s=window.__farmGame.scene.getScene('VisitScene'),o=s[kind+'Encounter']?.sprite||s[kind],b=o.getBounds();return b.centerX>30&&b.centerX<360&&b.centerY>220&&b.centerY<750;},kind);
   const p=await page.evaluate(kind=>{const s=window.__farmGame.scene.getScene('VisitScene'),o=s[kind+'Encounter']?.sprite||s[kind],b=o.getBounds(),q=s.cameras.main.matrix.transformPoint(b.centerX-s.cameras.main.scrollX,b.centerY-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+q.x/s.scale.width*r.width,y:r.y+q.y/s.scale.height*r.height};},kind);await page.mouse.click(p.x,p.y);
  }else await strike(kind);
  const first=await state(kind),damage=hitDamage(battle,mode,0,weapon,kind);
  assert.equal(first.health,Math.max(0,battle.health-damage),kind+' immediate predicted health');
  assert.equal(first.pool.at(-1).damage,damage);if(criticalMode){assert.equal(first.pool.at(-1).critical,true);assert.equal(first.pool.at(-1).burst,true);assert.equal(first.pool.at(-1).streak,1);assert.ok(parseFloat(first.pool.at(-1).size)>=40);}if(zeroMode){assert.equal(first.pool.at(-1).critical,false);assert.equal(first.pool.at(-1).burst,false);}
  assert.match(first.pool.at(-1).text,/^−\d+$/);assert.ok(first.pool.at(-1).distance<40,'damage starts at visible head');
  assert.ok(first.bar<250/3);assert.ok(first.trail>=first.bar);
  await page.waitForTimeout(650);assert.equal(db.data.get(key).health,first.health);
  const settled=await state(kind);assert.equal(settled.trail,settled.bar);assert.ok(Math.abs(settled.barX-settled.headX)<.1,'bar follows moving/animated sprite');
  if(kind==='gorilla'){
   await page.screenshot({path:criticalMode?'/tmp/gugu-critical-hp-mobile.png':'/tmp/gugu-combat-hp-mobile.png'});
   await strike(kind);if(criticalMode)assert.equal((await state(kind)).pool.at(-1).streak,2);await page.screenshot({path:criticalMode?'/tmp/gugu-critical-damage-mobile.png':'/tmp/gugu-combat-damage-mobile.png'});
  }
  if(kind==='giant'){
   await page.setViewportSize({width:320,height:568});await page.emulateMedia({reducedMotion:'reduce'});
   await strike(kind);const small=await state(kind);assert.equal(small.trail,small.bar);
   await page.screenshot({path:criticalMode?'/tmp/gugu-critical-small.png':'/tmp/gugu-combat-hp-small.png'});
  }
  // No network await per hit. Several clicks share the existing 500ms batch.
  let safety=0;
  while((await state(kind)).health>0&&safety++<100)await strike(kind);
  if(countdownTests&&kind==='wolf'){
   await page.locator('.farm-battle-countdown[data-phase=confirming]').waitFor();assert.match(await page.locator('.farm-battle-clock').textContent(),/確認戰鬥結果/);
   await page.screenshot({path:'/tmp/gugu-battle-countdown-confirming.png'});releaseSettlement();
  }
  await page.locator('[data-result-kind=battle]').waitFor();
  assert.equal(db.data.get(key).result.outcome,'win');
  if(countdownTests)assert.equal(await page.locator('.farm-battle-countdown').count(),0);
  const attacks=calls.filter(c=>c.action==='battleAttack'&&c.requestId&&c.combatVersion===2);
  assert.ok(attacks.length>0);
  assert.equal(calls.filter(c=>c.action==='battleSettle').length,results.length+1);
  const reward=page.locator('[data-result-kind=battle]');assert.equal(await reward.locator('button[aria-label=確定]').isEnabled(),true);
  await reward.locator('button[aria-label=確定]').click();
  results.push({kind,maxHealth:battle.maxHealth,mode,attacks:structuredClone(db.data.get(key).attacks)});
  await page.locator('.farm-visit-leave').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('LobbyScene'));
 }
 if(countdownTests){
  assert.equal(await page.locator('.farm-battle-countdown').count(),0);
  const expiryPolicy=structuredClone(E.DEFAULTS);for(const m of Object.values(expiryPolicy))m.enabled=false;expiryPolicy.tiger.enabled=true;expiryPolicy.tiger.visit.rate=100;db.data.set('ops_game_config/encounters',{monsters:expiryPolicy,revision:98});
  await click('farm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').entryChecked&&window.__farmGame.scene.getScene('VisitScene').tigerHUD);
  const expiredBattle=structuredClone(db.data.get(key)),hitsBefore=calls.filter(c=>c.action==='battleAttack').length;
  const clockJump=await page.evaluate(async()=>{const {farmNow}=await import('/js/farm/backend-client.js'),s=window.__farmGame.scene.getScene('VisitScene');return Date.now()+Math.max(0,s.backendChallenge.deadline-farmNow()+1000);});
  advance(expiredBattle.deadline-expiredBattle.startedAt+2000);await page.clock.setSystemTime(new Date(clockJump));
  await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').tigerHUD.countdown.tick(true));await page.screenshot({path:'/tmp/gugu-battle-countdown-expired.png'});
  await strike('tiger');await page.waitForFunction(()=>window.__farmGame.scene.getScene('VisitScene').tigerHUD.countdown.destroyed);
  assert.equal(calls.filter(c=>c.action==='battleAttack').length,hitsBefore,'expired resumed battle must not submit another hit');assert.equal(db.data.get(key).result.outcome,'loss');assert.equal(await page.locator('.farm-battle-countdown').count(),0);
  await page.locator('.farm-visit-leave').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('LobbyScene'));

 }
 assert.ok(calls.some(c=>c.action==='battleAttack'&&c.count>1),'rapid hits still share a batch');
 assert.deepEqual(errors,[]);
 require('node:fs').writeFileSync('/tmp/gugu-combat-v2-browser-results.json',JSON.stringify(results,null,2));
 if(countdownTests)console.log('PASS battle countdown: real public-village entry all nine monsters, normal/10/5/3/0s phases, 320px layout, reduced motion, no added requests, settlement pending, expired-background attack guard/server loss, cleanup and plain seconds-only display');
 console.log('PASS actual public-village entry all nine monsters: one-third head bar, 0.3cm gap, no combat text, nearby seeded ±10 damage, delayed trail, 500ms attack batching, one settlement/reward, small viewport, reduced motion and exit cleanup');
};
