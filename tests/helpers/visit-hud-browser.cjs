const assert=require('node:assert/strict');
exports.run=async({page,calls,db,errors})=>{
 const leave=page.getByRole('button',{name:'離開',exact:true});
 const ready=key=>page.waitForFunction(key=>{const s=window.__farmGame?.scene.getScene(key);return s?.sys.isActive()&&(key!=='MyFarmScene'||s.entryChecked)&&(key!=='VisitScene'||s.entryChecked)&& (key!=='LobbyScene'||s.farms?.length>0);},key);
 const tap=async kind=>{
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const point=await page.evaluate(kind=>{const s=window.__farmGame.scene.getScene('LobbyScene'),o=kind==='public'?s.publicVillageButton:kind==='village'?s.content.list.find(o=>o.getData('villageGroupId')==='B'):kind==='farm'?s.content.list.find(o=>o.texture?.key==='coop'):s.children.list.find(o=>o.input?.enabled&&o.x===42&&o.y===50);if(!o)throw Error(kind);const w=o.getWorldTransformMatrix().transformPoint(0,0),q=s.cameras.main.matrix.transformPoint(w.x-s.cameras.main.scrollX,w.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+q.x/s.scale.width*r.width,y:r.y+q.y/s.scale.height*r.height};},kind);await page.touchscreen.tap(point.x,point.y);
 };
 const ownName=await page.locator('[data-farm-own-label]').textContent();
 const names=['小麥村長','小麥村長與他的超級長名字北極極光森林雞舍測試名稱','<b>小麥村長</b>'];
 const metrics=[];
 for(const name of names){
  db.data.get('users/bob').name=name;
  await page.locator('.farm-hud-bottom button[aria-label=村落]').tap();await ready('LobbyScene');await tap('public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');await tap('village');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B'&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);await tap('farm');await ready('VisitScene');
  assert.equal(await page.locator('.farm-visit-hud').count(),1);assert.equal(await page.locator('[data-farm-visit-label]').textContent(),name+' 的家');assert.equal(await page.locator('[data-farm-visit-label] b').count(),0);assert.equal(await page.locator('[data-farm-own-label]').isHidden(),true);
  assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('VisitScene').children.list.some(o=>typeof o.text==='string'&&(/潛入.*的家|溜走/.test(o.text)))),false);
  for(const size of name===names[2]?[{width:390,height:844}]:[{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:1024,height:768}]){
   await page.setViewportSize(size);await page.waitForTimeout(130);
   const result=await page.evaluate(()=>{const b=document.querySelector('.farm-visit-leave'),r=b.getBoundingClientRect(),h=document.getElementById('game-container').getBoundingClientRect(),label=document.querySelector('[data-farm-visit-label]'),l=label.getBoundingClientRect(),back=document.querySelector('.btn-back').getBoundingClientRect(),style=getComputedStyle(b);return{alpha:Number(style.backgroundColor.match(/[\d.]+/g).at(-1)),opacity:style.opacity,textAlign:getComputedStyle(label.parentElement).textAlign,inside:r.right<=h.right&&r.bottom<=h.bottom&&r.left>=h.left&&r.top>=h.top,minTouch:r.width>=44&&r.height>=44,atBottomRight:h.right-r.right<=30&&h.bottom-r.bottom<=30,labelRight:l.left>=back.right&&l.right<=innerWidth,noOverflow:document.documentElement.scrollWidth<=innerWidth};});
   assert.equal(result.alpha,.5);assert.equal(result.opacity,'1');assert.equal(result.textAlign,'center');for(const key of ['inside','minTouch','atBottomRight','labelRight','noOverflow'])assert.equal(result[key],true,key);metrics.push({name,width:size.width,...result});
   if(name!==names[2])await page.screenshot({path:`/tmp/gugu-visit-hud-${name===names[0]?'normal':'long'}-${size.width}.png`});
  }
  await page.setViewportSize({width:390,height:844});
  // Existing dialog/input locks must also suppress this DOM control.
  await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.input.enabled=false;s.events.emit('update');});assert.equal(await leave.isDisabled(),true);await leave.evaluate(b=>b.click());assert.equal(await page.evaluate(()=>window.__farmGame.scene.isActive('VisitScene')),true);await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('VisitScene');s.input.enabled=true;s.events.emit('update');});
  await leave.tap();await ready('LobbyScene');assert.equal(await page.locator('.farm-visit-hud').count(),0);assert.equal(await page.locator('[data-farm-visit-label]').isHidden(),true);assert.equal(await page.locator('[data-farm-own-label]').textContent(),ownName);assert.equal(await page.locator('.top-nav.is-visiting').count(),0);await tap('back');await ready('MyFarmScene');
 }
 assert.equal(calls.filter(c=>['stealEgg','helpClean','cleanOwn','searchGarden'].includes(c.action)).length,0,'exit cannot trigger an underlying farm action');assert.deepEqual(errors,[]);
 console.log('PASS visit HUD from public-village entry: right-of-back centered owner, safe text, half-transparent card/full-opacity type, bottom-right touch target at 320/390/430/768/1024, modal lock, three enter/leave cycles, owner restored and zero economic actions; '+metrics.length+' layout samples');
};
