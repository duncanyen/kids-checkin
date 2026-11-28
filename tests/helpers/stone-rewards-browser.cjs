const assert=require('node:assert/strict');
exports.run=async({page,calls,db,errors})=>{
 const own=()=>db.data.get('groups/A/users/alice').farm;
 const tasks=page.locator('[aria-label="每日任務"]');await tasks.click();await page.waitForFunction(()=>document.querySelector('.farm-daily-claim')?.textContent==='立即簽到');
 assert.match(await page.locator('.farm-daily-reward-amount').textContent(),/100 金幣.*1 精煉石/);
 for(const size of [{width:320,height:568},{width:390,height:844}]){await page.setViewportSize(size);await page.waitForTimeout(100);assert.equal(await page.locator('.farm-daily-material-reward').evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('.farm-daily-reward-panel').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom;}),true);await page.screenshot({path:`/tmp/nexus-phase4/material-daily-${size.width}.png`});}
 await page.locator('.farm-daily-claim').click();await page.waitForFunction(()=>document.querySelector('.farm-daily-claim')?.textContent==='今日已領取');assert.equal(own().refinementStones,6);assert.equal(own().coins,12445);assert.equal(calls.filter(c=>c.name==='gameOpsDailyChallenges'&&c.action==='claim').length,1);await page.locator('.farm-daily-close').click();
 await page.locator('.farm-hud-bottom button[aria-label="倉庫"]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene')&&window.__farmGame.scene.getScene('WarehouseScene').categoryTabs);
 const click=async(type)=>{
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const p=await page.evaluate(type=>{const s=window.__farmGame.scene.getScene('WarehouseScene'),o=type==='tab'?s.categoryTabs.tabs.get('other').background:s.itemsPanel.list[s.visibleWarehouseItems.findIndex(i=>i.key==='refinementStones')*3];if(!o)throw Error('warehouse target missing');const q=o.getWorldTransformMatrix().transformPoint(0,0),v=s.cameras.main.matrix.transformPoint(q.x-s.cameras.main.scrollX,q.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+v.x/s.scale.width*r.width,y:r.y+v.y/s.scale.height*r.height};},type);await page.mouse.click(p.x,p.y);
 };
 await click('tab');await page.waitForFunction(()=>window.__farmGame.scene.getScene('WarehouseScene').textures.exists('refinement_stone'));
 for(const size of [{width:320,height:568},{width:390,height:844}]){await page.setViewportSize(size);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>{const s=window.__farmGame.scene.getScene('WarehouseScene');return s.itemsPanel.list.some(o=>typeof o.text==='string'&&o.text.includes('精煉石\nx 6'));}),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`/tmp/nexus-phase4/material-warehouse-${size.width}.png`});}
 // UI interaction is informational; the material has no equip/discard action.
 await click('item');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('WarehouseScene').actionPanel.visible),false);assert.equal(own().refinementStones,6);assert.deepEqual(errors,[]);
 console.log('PASS actual daily and warehouse entrances: original 100 gold + one extra stone, backend-only grant, live stack of six, lazy transparent blue refinement stone art, material no equip/discard, 320×568 and 390×844 no horizontal overflow');
};
