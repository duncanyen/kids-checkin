const assert=require('node:assert/strict');
const fs=require('node:fs');
module.exports=async function checkRankings(page,{docs,owner,errors,probe}){
 await page.clock.setFixedTime(new Date('2026-11-12T04:00:00Z'));
 const launcher=page.getByRole('button',{name:'開啟排行榜',exact:true});
 const panel=page.locator('.farm-ranking-panel');
 const open=async()=>{await launcher.click();await page.waitForFunction(()=>document.querySelector('.farm-ranking-content').getAttribute('aria-busy')==='false');};
 const close=async()=>{await panel.getByRole('button',{name:'關閉',exact:true}).click();};
 const sceneId=await page.evaluate(()=>{window.__rankingOriginalScene=__farmGame.scene.getScene('MyFarmScene');return true;});assert.equal(sceneId,true);
 await open();assert.equal(await page.locator('.farm-ranking-row').count(),0);assert.equal(await page.locator('.farm-ranking-empty').isVisible(),true);assert.match(await page.locator('.farm-ranking-status').innerText(),/記錄中.*公開村落.*Top 10/);await close();
 docs['users/self']={accountId:'self',name:'單人測試'};docs[owner].farm.stolenEggs20261109=23;
 await open();assert.equal(await page.locator('.farm-ranking-row').count(),1);assert.equal(await page.locator('.farm-ranking-row--gold img').count(),1);await close();
 docs['users/neighbor']={accountId:'neighbor',name:'第二位成員'};docs['groups/A/users/neighbor'].farm.stolenEggs20261109=12;
 await open();assert.equal(await page.locator('.farm-ranking-row').count(),2);await close();
 const groupName='這是非常非常長的村落名稱用來確認不會破版'.repeat(3);
 docs['groups/Rank']={name:groupName,members:Array.from({length:12},(_,i)=>'rank'+i),farmVillageVisibility:'public'};
 for(let i=0;i<12;i++){docs['users/rank'+i]={accountId:'rank'+i,name:i===0?'非常非常長的玩家名稱'.repeat(8):'測試成員'+i};docs['groups/Rank/users/rank'+i]={farm:{stolenEggs20261109:10000-i*100}};}
 docs['groups/B/users/self'].farm.stolenEggs20261109=999999;
 await open();assert.equal(await page.locator('.farm-ranking-row').count(),10);assert.match(await page.locator('.farm-ranking-score').first().textContent(),/10,000 顆/);assert.equal(await page.locator('.farm-ranking-row--normal .farm-ranking-place-number').allTextContents().then(rows=>rows.join(',')),'4,5,6,7,8,9,10');
 assert.equal(await page.locator('.farm-ranking-person strong').first().evaluate(node=>getComputedStyle(node).textOverflow),'ellipsis');
 assert.equal(await page.evaluate(()=>__farmGame.input.enabled),false);
 await page.waitForFunction(()=>[...document.querySelectorAll('.farm-ranking-panel img')].every(img=>img.complete&&img.naturalWidth>0));
 const metrics=[];
 for(const viewport of [{width:320,height:568},{width:375,height:667},{width:390,height:844},{width:430,height:932},{width:412,height:915},{width:768,height:1024},{width:720,height:1280},{width:844,height:390}]){
  await page.setViewportSize(viewport);
  const state=await panel.evaluate(node=>{
   const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
   const list=node.querySelector('.farm-ranking-content');return {panel:rect(node),list:rect(list),footer:rect(node.querySelector('footer')),close:rect(node.querySelector('.farm-ranking-close')),scrollHeight:list.scrollHeight,documentWidth:document.documentElement.scrollWidth};
  });
  assert.ok(state.panel.y>=0&&state.panel.bottom<=viewport.height+1);assert.ok(state.list.height>=30);assert.ok(state.list.bottom<=state.footer.y+1);assert.ok(state.footer.bottom<=state.panel.bottom);assert.ok(state.close.width>=44&&state.close.height>=44);assert.ok(state.documentWidth<=viewport.width);
  await page.locator('.farm-ranking-row').last().scrollIntoViewIfNeeded();const bottom=await page.locator('.farm-ranking-row').last().boundingBox();assert.ok(bottom.y+bottom.height<=state.list.bottom+2,'last row can be reached without footer overlap');
  await page.locator('.farm-ranking-content').evaluate(node=>node.scrollTop=0);await page.screenshot({path:`/tmp/farm-ranking-v2-${viewport.width}x${viewport.height}.png`});metrics.push({viewport,...state});
 }
 fs.writeFileSync('/tmp/farm-ranking-v2-metrics.json',JSON.stringify(metrics,null,2));
 await page.setViewportSize({width:390,height:844});
 const refresh=panel.getByRole('button',{name:'重新整理',exact:true});
 let release,started;const began=new Promise(resolve=>started=resolve),wait=new Promise(resolve=>release=resolve);probe.gate={wait,started};const before=probe.reads;
 await refresh.click();await began;assert.equal(await refresh.isDisabled(),true);
 await refresh.evaluate(button=>{for(let i=0;i<15;i++)button.click();});assert.equal(probe.reads,before+1);release();await page.waitForFunction(()=>document.querySelector('.farm-ranking-refresh').disabled===false);
 assert.equal(await panel.locator('[role=tab][aria-selected=true]').innerText(),'偷蛋王');
 await refresh.click();assert.equal(probe.reads,before+1,'manual refresh has a short cooldown after completion');
 await close();probe.fail=true;await open();assert.match(await page.locator('.farm-ranking-status').textContent(),/無法連線/);assert.equal(await refresh.isEnabled(),true);await close();probe.fail=false;
 // 快速重開，共用進行中的查詢；關閉後完成不會重新打開或重新鎖定場景。
 let releaseAgain,startedAgain;const beganAgain=new Promise(resolve=>startedAgain=resolve),waitAgain=new Promise(resolve=>releaseAgain=resolve);probe.gate={wait:waitAgain,started:startedAgain};const beforeAgain=probe.reads;
 await launcher.click();await beganAgain;await close();for(let i=0;i<4;i++){await launcher.click();await close();}assert.equal(probe.reads,beforeAgain+1);releaseAgain();await page.waitForTimeout(80);assert.equal(await page.locator('.farm-ranking-overlay').isHidden(),true);assert.equal(await page.evaluate(()=>__farmGame.input.enabled),true);
 await page.clock.setFixedTime(new Date('2026-11-16T04:00:00Z'));await open();assert.match(await page.locator('.farm-ranking-status').textContent(),/已截止/);await page.keyboard.press('Escape');assert.equal(await page.locator('.farm-ranking-overlay').isHidden(),true);
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene')===__rankingOriginalScene),true);assert.deepEqual(errors,[]);
 console.log('PASS ranking V2: empty/1/2/Top10, real query fixture, medal ranks 4–10, long names, 10,000 scores, 8 viewport layouts, scrolling, refresh dedupe, Firebase failure, rapid close/reopen, expired period and unchanged scene.');
};
