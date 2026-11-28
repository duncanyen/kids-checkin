const assert=require('node:assert/strict');
exports.run=async({page,calls,db,errors,setReplyDelay})=>{
 const own=()=>db.data.get('groups/A/users/alice').farm,dialog=page.locator('[data-result-kind=weapons]');
 const tapObject=async(sceneKey,kind,key)=>{
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const pt=await page.evaluate(({sceneKey,kind,key})=>{const s=window.__farmGame.scene.getScene(sceneKey);let o;
   if(kind==='tab')o=s.categoryTabs.tabs.get(key).background;
   else if(kind==='back')o=s.children.list.find(o=>o.type==='Rectangle'&&o.input?.enabled&&o.x===55&&o.y===60);
   else if(kind==='item')o=s.shopItems.buy.get(key).objects[0];
   else if(kind==='sellMode')o=s.children.list.find(o=>o.type==='Text'&&o.text==='賣出');
   else if(kind==='sellItem')o=s.shopItems.sell.get(key).objects[0];
   const w=o.getWorldTransformMatrix().transformPoint(0,0),p=s.cameras.main.matrix.transformPoint(w.x-s.cameras.main.scrollX,w.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},{sceneKey,kind,key});await page.mouse.click(pt.x,pt.y);
 };
 await page.locator('.farm-hud-bottom button[aria-label=倉庫]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));await tapObject('WarehouseScene','tab','weapons');await dialog.locator('[data-weapon-instance-id]').nth(3).waitFor();
 assert.equal(await dialog.locator('[data-weapon-instance-id]').count(),4);const cards=dialog.locator('[data-weapon-instance-id]').filter({hasText:'大鐵槌 +0'});assert.equal(await cards.count(),3);const ids=await cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.weaponInstanceId));assert.equal(new Set(ids).size,3);
 const other=cards.filter({has:page.getByRole('button',{name:'裝備',exact:true})}).first(),id=await other.getAttribute('data-weapon-instance-id');await other.getByRole('button',{name:'裝備',exact:true}).click();const before=calls.filter(c=>c.action==='equipWeapon').length;await dialog.getByRole('button',{name:'確定',exact:true}).dblclick();await dialog.getByText('操作完成',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.action==='equipWeapon').length,before+1);assert.equal(db.data.get('ops_weapon_owners/'+require('../../game-admin/functions/weapon-repository.cjs').scope({uid:'alice',groupId:'A',accountId:'alice'})).equippedMeleeInstanceId,id);
 // Commit succeeds while its response times out. Reload, then recover the same ID.
 const equipped=dialog.locator(`[data-weapon-instance-id="${id}"]`);setReplyDelay(400);await page.evaluate(()=>{window.__fixtureTimeoutMs=100;});
 await equipped.getByRole('button',{name:'卸下',exact:true}).click();await dialog.getByRole('button',{name:'確定',exact:true}).click();await dialog.getByRole('button',{name:'確認原交易結果',exact:true}).waitFor();
 const timedOut=calls.filter(c=>c.action==='equipWeapon').at(-1).requestId;
 await page.reload({waitUntil:'domcontentloaded',timeout:30000});await page.waitForFunction(()=>window.__farmGame?.scene.getScene('MyFarmScene')?.entryChecked);
 await page.locator('.farm-hud-bottom button[aria-label=倉庫]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));await tapObject('WarehouseScene','tab','weapons');
 await dialog.locator('[data-weapon-instance-id]').first().waitFor();assert.equal(await dialog.getByRole('button',{name:'確認原交易結果',exact:true}).count(),0,'共用恢復已查回收據，不保留會另開ID的舊武器操作');assert.equal(calls.filter(c=>c.action==='equipWeapon').length,2,'重新載入只查原交易，不再次執行裝備');assert.equal(calls.filter(c=>c.action==='equipWeapon').at(-1).requestId,timedOut);assert.equal(own().equippedWeapon,'club');
 for(const width of [320,390]){await page.setViewportSize({width,height:width===320?568:844});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok(await dialog.getByRole('button',{name:'關閉',exact:true}).isVisible());await page.screenshot({path:'/tmp/gugu-weapon-instances-'+width+'.png'});}
 await dialog.getByRole('button',{name:'關閉',exact:true}).click();assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').input.enabled),true);
 await tapObject('WarehouseScene','back');await page.waitForFunction(()=>window.__farmGame.scene.isActive('MyFarmScene'));await page.locator('.farm-hud-bottom button[aria-label=商店]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));await tapObject('ShopScene','tab','weapons');await tapObject('ShopScene','item','mace');
 // Quantity controls are the existing shop controls; no new purchasing UI.
 await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').setQuantity(2));
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const confirm=await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('ShopScene'),o=s.dialogContainer.list.find(o=>o.type==='Rectangle'&&o.input&&o.fillColor===0x4CAF50);const w=o.getWorldTransformMatrix().transformPoint(0,0),p=s.cameras.main.matrix.transformPoint(w.x-s.cameras.main.scrollX,w.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};});await page.mouse.click(confirm.x,confirm.y);await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData.mace===2).catch(async error=>{console.error('WEAPON_BUY_DIAGNOSTIC',{calls:calls.map(c=>c.action),farm:own(),ui:await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('ShopScene');return {message:s.msgText.text,dialog:s.dialogContainer.visible,quantity:s.currentQty};})});throw error;});assert.equal(own().mace,2);
 await tapObject('ShopScene','sellMode');await tapObject('ShopScene','sellItem','mace');await dialog.locator('[data-weapon-instance-id]').nth(1).waitFor();assert.equal(await dialog.locator('[data-weapon-instance-id]').count(),2);
 await dialog.getByRole('button',{name:'出售',exact:true}).first().click();const balance=own().coins;await dialog.getByRole('button',{name:'確定',exact:true}).click();await dialog.getByText('操作完成',{exact:true}).waitFor();assert.equal(own().mace,1);assert.equal(own().coins,balance+1000);assert.equal(await dialog.locator('[data-weapon-instance-id]').count(),1);await dialog.getByRole('button',{name:'關閉',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('PASS real warehouse/shop entry: distinct +0 cards, exact equip once on double click, timeout/reload recovery same receipt, input restored, 320/390px, existing buy-two and sell-one, server-only transactions');
};
