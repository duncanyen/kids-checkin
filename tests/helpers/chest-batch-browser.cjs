const assert=require('node:assert/strict'),C=require('../../game-admin/functions/chests.cjs');
exports.run=async({page,calls,db,errors,auth,service,setDelay})=>{
 const own=()=>db.data.get('groups/A/users/alice').farm,actor={uid:'alice',groupId:'A',accountId:'alice'},base=C.ownerPath(actor);
 let serial=0;
 const seed=(count,{coins=7,items=[]}={})=>{const ids=[];for(let n=0;n<count;n++){const id='batch-box-'+String(++serial).padStart(3,'0');ids.push(id);db.data.set(base+'/'+id,{id,...actor,monster:'eagle',status:'unopened',droppedAt:Date.now(),configRevision:1,snapshot:{dropRate:100,coins:{enabled:coins>0,min:coins,max:coins},items}});}own().chestCount=(own().chestCount||0)+count;return ids;};
 const emit=()=>page.evaluate(()=>window.__privateEmitAll());
 const clickObject=async selector=>{
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const point=await page.evaluate(selector=>{const s=window.__farmGame.scene.getScene('WarehouseScene'),o=selector==='tab'?s.categoryTabs.tabs.get('chests').background:s.itemsPanel.list.find(o=>o.type==='Rectangle'),w=o.getWorldTransformMatrix().transformPoint(0,0),q=s.cameras.main.matrix.transformPoint(w.x-s.cameras.main.scrollX,w.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+q.x/s.scale.width*r.width,y:r.y+q.y/s.scale.height*r.height};},selector);await page.mouse.click(point.x,point.y);
 };
 const root=page.locator('[data-result-kind=chest]'),openCalls=()=>calls.filter(c=>c.action==='openChests'||c.action==='openChest');
 const enter=async()=>{await emit();await clickObject('card');await root.getByRole('heading',{name:'我的寶箱'}).waitFor();};
 const readyResult=()=>page.waitForFunction(()=>{const r=document.querySelector('[data-result-kind=chest]');return r?.querySelector('.farm-chest-rewards')&&!r.querySelector('.farm-chest-rewards').hidden&&['complete','static'].includes(r.dataset.animationState);});
 const close=()=>root.getByRole('button',{name:'關閉',exact:true}).click();
 const ids=seed(3,{coins:7,items:[{itemId:'medicine',quantity:2}]});await emit();
 await page.locator('.farm-hud-bottom button[aria-label="倉庫"]').click();await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene'));await clickObject('tab');await enter();
 await root.getByRole('checkbox').first().waitFor();assert.equal(await root.getByRole('button',{name:/紀錄|查看結果/}).count(),0);assert.equal(await root.getByRole('checkbox').count(),3);
 await root.getByRole('checkbox').nth(0).check();await root.getByRole('checkbox').nth(1).check();assert.equal(await root.getByRole('button',{name:'開啟選取（2）',exact:true}).isEnabled(),true);
 await root.getByRole('button',{name:'全選本頁'}).click();assert.equal(await root.getByRole('checkbox').evaluateAll(ns=>ns.filter(n=>n.checked).length),3);
 await page.setViewportSize({width:320,height:568});await page.screenshot({path:'/tmp/gugu-chest-batch-select-320.png'});
 const before=own().coins,callCount=openCalls().length;await root.getByRole('button',{name:'開啟選取（3）',exact:true}).evaluate(b=>{b.click();b.click();b.click();});await readyResult();
 assert.equal(openCalls().length,callCount+1);assert.equal(own().coins,before+21);assert.equal(own().medicines,6);assert.equal(own().chestCount,0);assert.match(await root.textContent(),/已確認開啟 3 個寶箱/);assert.match(await root.textContent(),/× 6/);assert.equal(await root.getByRole('button',{name:/紀錄/}).count(),0);
 await page.screenshot({path:'/tmp/gugu-chest-batch-result-320.png'});let bounds=await root.getByRole('button',{name:'確定',exact:true}).boundingBox();assert.ok(bounds.y+bounds.height<=568);
 await root.getByRole('button',{name:'返回寶箱'}).click();await root.getByText('目前沒有待開啟寶箱').waitFor();await close();
 // Atomic delivery failure keeps every box; a retry uses the same selected IDs.
 seed(2,{coins:11,items:[{itemId:'medicine',quantity:2}]});own().warehouseLimit=1;await enter();await root.getByRole('button',{name:'全選本頁'}).click();const failureCoins=own().coins;
 await root.getByRole('button',{name:'開啟選取（2）',exact:true}).click();await root.getByText(/倉庫容量不足/).waitFor();assert.equal(own().chestCount,2);assert.equal(own().coins,failureCoins);
 own().warehouseLimit=100;await root.getByRole('button',{name:'確認／重試這批寶箱',exact:true}).click();await readyResult();assert.equal(own().coins,failureCoins+22);assert.equal(own().chestCount,0);await close();
 // Timeout after server commit: close/reopen recovers the same batch/receipt, no history tab.
 const timeoutIds=seed(2,{coins:13});await enter();await root.getByRole('button',{name:'全選本頁'}).click();setDelay(350);await page.evaluate(()=>window.__fixtureTimeoutMs=100);const timeoutCoins=own().coins;
 await root.getByRole('button',{name:'開啟選取（2）',exact:true}).click();await root.getByText(/結果確認中，請重試/).waitFor();const original=openCalls().at(-1);assert.equal(own().coins,timeoutCoins+26);await close();await page.waitForTimeout(400);setDelay(0);await page.evaluate(()=>window.__fixtureTimeoutMs=undefined);await enter();
 assert.equal(await root.getByRole('checkbox').count(),0);await root.getByRole('button',{name:'確認上次開箱結果'}).click();await readyResult();assert.equal(openCalls().at(-1).requestId,original.requestId);assert.deepEqual(openCalls().at(-1).chestIds,original.chestIds);assert.equal(own().coins,timeoutCoins+26);await close();
 const snapshot=structuredClone(own());await service.farmTransaction({auth,data:{groupId:'A',action:'openChests',chestIds:timeoutIds,requestId:require('node:crypto').randomUUID()}});assert.deepEqual(own(),snapshot);
 // 21 boxes paginate into 20 + 1; only the selected page is consumed.
 seed(21,{coins:1});await page.setViewportSize({width:390,height:844});await enter();await root.getByRole('button',{name:'全選本頁'}).click();assert.equal(await root.getByRole('checkbox').count(),20);const maxCoins=own().coins;
 await root.getByRole('button',{name:'開啟選取（20）',exact:true}).click();await readyResult();assert.equal(own().coins,maxCoins+20);assert.equal(own().chestCount,1);await root.getByRole('button',{name:'返回寶箱'}).click();await root.getByRole('button',{name:'開啟',exact:true}).click();await readyResult();assert.equal(own().chestCount,0);assert.equal(own().coins,maxCoins+21);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await root.getByRole('button',{name:'確定',exact:true}).evaluate(b=>{b.click();b.click();});assert.equal(await root.count(),0);assert.deepEqual(errors,[]);
 console.log('PASS actual warehouse entry: select individual/all, 3/20-box aggregate awards, single opening, no history UI, atomic capacity failure/retry, timeout close/reopen same receipt, cross-device replay, pagination, repeated taps and 320px/390px layouts');
};
