const assert=require('node:assert/strict');
exports.run=async({page,calls,db,errors})=>{
 const own=()=>db.data.get('groups/A/users/alice').farm;
 Object.assign(own(),{warehouseLimit:5000,inventoryEggs:1234,silkieEggs:7,bresseEggs:0,onagadoriEggs:0,hens:3,hensState:[{id:'h1',breed:'hen',laidAt:Date.now()},{id:'h2',breed:'hen',laidAt:Date.now(),isSick:true},{id:'s',breed:'silkie',laidAt:Date.now()}],mace:2,ironhammer:1,equippedWeapon:'club',honey:2,ancientStones:1,sweetPotatoes:3,cobraFangs:4,eagleFeathers:5,worms:6,earthworms:7,wolfFangs:8,tigerPelts:0,dragonScales:0,gorillaFangs:0});
 const emit=()=>page.evaluate(()=>window.__privateEmitAll());await emit();
 const click=async(type,key)=>{
  if(type==='item')await page.waitForFunction(()=>!window.__farmGame.scene.getScene('ShopScene').isProcessing);
  if(['max','confirm','cancel'].includes(type))await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').dialogContainer.visible);
  const point=await page.evaluate(({type,key})=>{const s=window.__farmGame.scene.getScene('ShopScene');let o;
   if(type==='tab')o=s.categoryTabs.tabs.get(key).background;
   else if(type==='item')o=s[key.mode+'Container'].list.find(o=>o.catalogKey===key.key&&o.input?.enabled&&o.visible);
   else if(type==='mode')o=s.children.list.find(o=>o.input?.enabled&&o.x===(key==='sell'?290:100)&&o.y===180);
   else if(type==='page')o=s.nextPage;
   else o=s.dialogContainer.list.find(o=>o.input?.enabled&&o.x===(type==='max'?280:type==='confirm'?130:260)&&o.y===(type==='max'?410:505));
   if(!o)throw Error('Missing shop target '+type+':'+JSON.stringify(key));
   const w=o.getWorldTransformMatrix().transformPoint(0,0),q=s.cameras.main.matrix.transformPoint(w.x-s.cameras.main.scrollX,w.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+q.x/s.scale.width*r.width,y:r.y+q.y/s.scale.height*r.height};},{type,key});await page.mouse.click(point.x,point.y);
 };
 const rows=()=>page.evaluate(()=>{const s=window.__farmGame.scene.getScene('ShopScene');return [...s.shopItems.sell].filter(([,v])=>v.objects[0].visible).map(([key,v])=>({key,x:v.objects[0].x,y:v.objects[0].y,quantity:v.objects[3].getData('stockQuantity'),label:v.objects[3].text,width:v.objects[3].displayWidth}));});
 const sellCalls=()=>calls.filter(c=>c.action==='sellItem'||c.action==='tradePoultry');
 await page.locator('.farm-hud-bottom button[aria-label="商店"]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene')&&window.__farmGame.scene.getScene('ShopScene').farmData?.inventoryEggs===1234);
 await click('mode','sell');let items=await rows();assert.deepEqual(items.map(r=>r.key),['bird:hen','inventoryEggs','bird:silkie','silkieEggs']);assert.deepEqual(items.map(r=>r.quantity),[2,1234,1,7]);assert.ok(items.find(r=>r.key==='inventoryEggs').label.includes('1,234'));
 await page.screenshot({path:'/tmp/gugu-shop-stock-chickens.png'});
 await click('item',{mode:'sell',key:'bird:hen'});await click('confirm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData.hens===2);assert.equal((await rows()).find(r=>r.key==='bird:hen').quantity,1);
 await click('item',{mode:'sell',key:'inventoryEggs'});await click('max');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').textQty.text),'1000');await click('confirm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData.inventoryEggs===234);assert.equal((await rows()).find(r=>r.key==='inventoryEggs').quantity,234);
 await click('mode','buy');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').buyContainer.list.some(o=>o.catalogKey==='bresse'&&o.visible)),true,'unowned products remain available in buy mode');
 await click('mode','sell');await click('tab','other');items=await rows();assert.equal(items.length,6);assert.deepEqual(items.map(r=>r.key),['honey','ancientStones','sweetPotatoes','cobraFangs','eagleFeathers','worms']);
 assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').pageText.text),'1 / 2');await click('page');items=await rows();assert.deepEqual(items.map(r=>r.key),['earthworms','wolfFangs']);assert.deepEqual(items.map(r=>r.x),[95,295]);assert.ok(items.every(r=>r.y===40));
 await click('item',{mode:'sell',key:'earthworms'});await click('max');assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').textQty.text),'7');const price=await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').tradeUnitPrice),coins=own().coins,before=sellCalls().length;
 await click('confirm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData.earthworms===0);assert.equal(own().coins,coins+price*7);assert.equal(sellCalls().length,before+1);items=await rows();assert.deepEqual(items.map(r=>r.key),['wolfFangs']);assert.equal(items[0].x,95,'last page compacts after a sale');
 await click('item',{mode:'sell',key:'wolfFangs'});await click('max');await click('confirm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData.wolfFangs===0);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').pageText.text),'1 / 1');assert.equal((await rows()).length,6);
 // The same existing snapshot stream also updates stock modified elsewhere.
 for(const k of ['honey','ancientStones','sweetPotatoes','cobraFangs','eagleFeathers','worms'])own()[k]=0;const countBefore=sellCalls().length;await emit();await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').emptyCategoryText.visible);assert.deepEqual(await rows(),[]);assert.equal(sellCalls().length,countBefore);
 own().honey=9;await emit();await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').sellQuantities.get('honey')===9);await click('item',{mode:'sell',key:'honey'});await click('max');own().honey=1;await emit();await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').currentMaxQty===1);assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').textQty.text),'1');
 own().honey=0;await emit();await page.waitForFunction(()=>!window.__farmGame.scene.getScene('ShopScene').dialogContainer.visible);assert.equal(sellCalls().length,countBefore,'stock updates close stale dialogs without selling');
 own().honey=3;await emit();await click('item',{mode:'sell',key:'honey'});await click('confirm');await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData.honey===2);assert.match((await rows())[0].label,/2/);
 await click('tab','weapons');items=await rows();assert.deepEqual(items.map(r=>r.key),['mace','ironhammer']);assert.deepEqual(items.map(r=>r.quantity),[2,1]);own().equippedWeapon='mace';await emit();await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').farmData.equippedWeapon==='mace');assert.match((await rows())[0].label,/已裝備/);await click('item',{mode:'sell',key:'mace'});assert.equal(await page.evaluate(()=>window.__farmGame.scene.getScene('ShopScene').dialogContainer.visible),false);
 for(const size of [{width:320,height:568},{width:390,height:844}]){await page.setViewportSize(size);await page.waitForTimeout(100);assert.ok((await rows()).every(r=>r.width<=156));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`/tmp/gugu-shop-stock-weapons-${size.width}.png`});}
 assert.deepEqual(errors,[]);console.log('PASS real shop entry: owned-only sales, live inventory quantities and breed counts, compact pagination, MAX/partial/last-item sale, snapshot changes, stale dialog clamp/close, equipped guard, buy mode preserved and mobile layouts');
};
