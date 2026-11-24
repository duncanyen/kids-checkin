const assert=require('node:assert/strict');
const I=require('../../functions/identity-domain.cjs');
const E=require('../../game-admin/functions/encounters.cjs');
exports.run=async({page,calls,db,errors,advance})=>{
 const {ENEMY_HEALTH,WEAPONS_CONFIG}=await import('../../js/farm/combat-rules.js');
 const {hitDamage}=await import('../../js/farm/combat-damage.js');
 const key='ops_farm_active/'+I.hash('alice:A'),own=()=>db.data.get('groups/A/users/alice').farm;
 const click=async find=>{
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const p=await page.evaluate(find=>{const s=window.__farmGame.scene.getScene('LobbyScene'),o=find==='public'?s.publicVillageButton:find==='village'?s.content.list.find(o=>o.getData('villageGroupId')==='B'):s.content.list.find(o=>o.texture?.key==='coop');const w=o.getWorldTransformMatrix().transformPoint(0,0),p=s.cameras.main.matrix.transformPoint(w.x-s.cameras.main.scrollX,w.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},find);await page.mouse.click(p.x,p.y);
 };
 const state=kind=>page.evaluate(async kind=>{const s=window.__farmGame.scene.getScene('VisitScene'),b=s[kind+'Encounter'],h=b?.healthHUD||s[kind+'HUD'],{monsterHead,screenUnits}=await import('/js/farm/monster-head.js'),head=monsterHead(h.sprite);return {bar:h.bar.width,trail:h.trail.width,health:b?.health??h.health,track:h.track.width,gap:(head.y-h.root.y-h.height/2)/screenUnits(s,1),headX:head.x,barX:h.root.x,textObjects:h.root.list.filter(o=>o.type==='Text').length,statusVisible:(b?.warning||s[kind]?.warning)?.visible,pool:h.pool.filter(t=>t.visible).map(t=>({damage:t.getData('combatDamage'),text:t.text,size:t.style.fontSize,distance:monsterHead(t.anchorSprite).y-t.y}))};},kind);
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
  await page.waitForFunction(kind=>{const s=window.__farmGame.scene.getScene('VisitScene');return s?.entryChecked&&s.backendChallenge?.kind===kind&&!!(s[kind+'Encounter']?.healthHUD||s[kind+'HUD']);},kind);
  const battle=structuredClone(db.data.get(key));assert.equal(battle.combatVersion,2);assert.equal(battle.health,ENEMY_HEALTH[kind]);advance(6000);
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
  assert.equal(first.pool.at(-1).damage,damage);assert.match(first.pool.at(-1).text,/^−\d+$/);assert.ok(first.pool.at(-1).distance<40,'damage starts at visible head');
  assert.ok(first.bar<250/3);assert.ok(first.trail>=first.bar);
  await page.waitForTimeout(650);assert.equal(db.data.get(key).health,first.health);
  const settled=await state(kind);assert.equal(settled.trail,settled.bar);assert.ok(Math.abs(settled.barX-settled.headX)<.1,'bar follows moving/animated sprite');
  if(kind==='gorilla'){
   await page.screenshot({path:'/tmp/gugu-combat-hp-mobile.png'});
   await strike(kind);await page.screenshot({path:'/tmp/gugu-combat-damage-mobile.png'});
  }
  if(kind==='giant'){
   await page.setViewportSize({width:320,height:568});await page.emulateMedia({reducedMotion:'reduce'});
   await strike(kind);const small=await state(kind);assert.equal(small.trail,small.bar);
   await page.screenshot({path:'/tmp/gugu-combat-hp-small.png'});
  }
  // No network await per hit. Several clicks share the existing 500ms batch.
  let safety=0;
  while((await state(kind)).health>0&&safety++<100)await strike(kind);
  await page.locator('[data-result-kind=battle]').waitFor();
  assert.equal(db.data.get(key).result.outcome,'win');
  const attacks=calls.filter(c=>c.action==='battleAttack'&&c.requestId&&c.combatVersion===2);
  assert.ok(attacks.some(c=>c.count>1)||ENEMY_HEALTH[kind]<=400);
  assert.equal(calls.filter(c=>c.action==='battleSettle').length,results.length+1);
  const reward=page.locator('[data-result-kind=battle]');assert.equal(await reward.locator('button[aria-label=確定]').isEnabled(),true);
  await reward.locator('button[aria-label=確定]').click();
  results.push({kind,maxHealth:ENEMY_HEALTH[kind],mode,attacks:structuredClone(db.data.get(key).attacks)});
  await page.locator('.farm-visit-leave').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('LobbyScene'));
 }
 assert.deepEqual(errors,[]);
 require('node:fs').writeFileSync('/tmp/gugu-combat-v2-browser-results.json',JSON.stringify(results,null,2));
 console.log('PASS actual public-village entry all nine monsters: one-third head bar, 0.3cm gap, no combat text, nearby seeded ±10 damage, delayed trail, 500ms attack batching, one settlement/reward, small viewport, reduced motion and exit cleanup');
};
