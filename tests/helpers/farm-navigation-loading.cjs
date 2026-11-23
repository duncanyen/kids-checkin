const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
exports.setup=async(page,before)=>{
 const requests=[];let hold=false,release,notice;const gate=new Promise(r=>release=r),requested=new Promise(r=>notice=r);
 const {ASSET_MANIFEST}=await import('../../js/farm/asset-manifest.js');const files=new Set(Object.values(ASSET_MANIFEST).flatMap(s=>[s.image,s.json].filter(Boolean)).map(file=>'/assets/farm/'+file));
 page.on('request',request=>{const name=new URL(request.url()).pathname;if(files.has(name))requests.push(name);});
 await page.route('**/assets/farm/**',async route=>{if(hold&&files.has(new URL(route.request().url()).pathname)){notice();await gate;}await route.continue();});
 await page.route('**/js/farm/daily-assets-cache.js',route=>route.fulfill({contentType:'text/javascript',body:'export const prepareDailyAssets=()=>Promise.resolve();'}));
 if(before)for(const file of ['assets.js','hud-ui.js','LobbyScene.js'])await page.route('**/js/farm/'+file,route=>route.fulfill({contentType:'text/javascript',body:execFileSync('git',['show','ae9a68a:js/farm/'+file],{encoding:'utf8'})}));
 return{requests,requested,hold:()=>hold=true,release:()=>{hold=false;release();}};
};
exports.run=async({page,probe,before,calls,db,errors})=>{
 await page.waitForFunction(()=>document.querySelector('[data-farm-loading]').hidden);
 await page.evaluate(()=>{window.__navigationMasks=0;let visible=false;new MutationObserver(()=>{const next=!document.querySelector('[data-farm-loading]').hidden;if(next&&!visible)window.__navigationMasks++;visible=next;}).observe(document.querySelector('[data-farm-loading]'),{attributes:true,attributeFilter:['hidden']});});
 const ready=key=>page.waitForFunction(key=>{const scene=window.__farmGame.scene.getScene(key);return scene?.sys.isActive()&&(key!=='MyFarmScene'||scene.entryChecked)&&(key!=='VisitScene'||scene.entryChecked)&&(key!=='LobbyScene'||scene.farms?.length>0);},key);
 const click=async(key,find)=>{
  if(key==='VisitScene'&&find==='back'){await page.getByRole('button',{name:'離開',exact:true}).click();return;}
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const p=await page.evaluate(({key,find})=>{const s=window.__farmGame.scene.getScene(key);let o=find==='public'?s.publicVillageButton:find==='village'?s.content.list.find(o=>o.getData('villageGroupId')==='B'):find==='farm'?s.content.list.find(o=>o.texture?.key==='coop'):s.children.list.find(o=>o.input?.enabled&&o.x===(key==='LobbyScene'?42:55)&&o.y===(key==='ShopScene'||key==='WarehouseScene'?60:50));if(!o)throw Error('Missing '+find);const w=o.getWorldTransformMatrix().transformPoint(0,0),q=s.cameras.main.matrix.transformPoint(w.x-s.cameras.main.scrollX,w.y-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+q.x/s.scale.width*r.width,y:r.y+q.y/s.scale.height*r.height};},{key,find});await page.mouse.click(p.x,p.y);
 };
 const metrics={label:before?'before':'after',viewport:'390x844',environment:'local Chromium / isolated SDK / real Phaser / SW blocked for request instrumentation',warmRoutes:[],visits:[]};
 const initialArt=probe.requests.length,start=Date.now();probe.hold();await page.locator('.farm-hud-bottom button[aria-label=倉庫]').click();await probe.requested;await page.waitForTimeout(80);
 metrics.sourceRetainedWhileLoading=await page.evaluate(()=>window.__farmGame.scene.isActive('MyFarmScene'));metrics.overlayAt80ms=await page.evaluate(()=>!document.querySelector('[data-farm-loading]').hidden);
 if(!before){assert.equal(metrics.sourceRetainedWhileLoading,true);assert.equal(metrics.overlayAt80ms,false);}
 await page.waitForTimeout(160);assert.equal(await page.locator('[data-farm-loading]').isVisible(),true);probe.release();await ready('WarehouseScene');await page.waitForFunction(()=>document.querySelector('[data-farm-loading]').hidden);
 metrics.firstWarehouseMs=Date.now()-start;metrics.firstWarehouseTextureRequests=probe.requests.length-initialArt;
 metrics.loadedCombatSprites=await page.evaluate(()=>['wolf','tiger','dragon','gorilla','eagle','cobra','mole','giant','hornet'].filter(key=>window.__farmGame.textures.exists(key)));
 if(!before)assert.deepEqual(metrics.loadedCombatSprites,[]);
 let current='WarehouseScene';
 for(let n=0;n<3;n++)for(const [label,key]of [['商店','ShopScene'],['倉庫','WarehouseScene']]){
  await click(current,'back');await ready('MyFarmScene');
  const beforeArt=probe.requests.length,beforeMask=await page.evaluate(()=>window.__navigationMasks),began=Date.now();await page.locator('.farm-hud-bottom button[aria-label="'+label+'"]').click();await ready(key);
  metrics.warmRoutes.push({route:key,ms:Date.now()-began,textureRequests:probe.requests.length-beforeArt,masks:(await page.evaluate(()=>window.__navigationMasks))-beforeMask});assert.equal(probe.requests.length,beforeArt);current=key;
 }
 await click('WarehouseScene','back');await ready('MyFarmScene');await page.locator('.farm-hud-bottom button[aria-label=村落]').click();await ready('LobbyScene');await click('LobbyScene','public');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').mode==='public');await click('LobbyScene','village');await page.waitForFunction(()=>window.__farmGame.scene.getScene('LobbyScene').displayGroup?.id==='B'&&window.__farmGame.scene.getScene('LobbyScene').farms?.length>0);await click('LobbyScene','farm');await ready('VisitScene');await page.waitForFunction(()=>document.querySelector('[data-farm-loading]').hidden);
 const checks=calls.filter(c=>c.action==='visitEncounter').length;
 for(let n=0;n<5;n++){
  await click('VisitScene','back');await ready('LobbyScene');const beforeArt=probe.requests.length,beforeMask=await page.evaluate(()=>window.__navigationMasks),began=Date.now();await click('LobbyScene','farm');await ready('VisitScene');await page.waitForFunction(()=>document.querySelector('[data-farm-loading]').hidden);
  const row={ms:Date.now()-began,textureRequests:probe.requests.length-beforeArt,masks:(await page.evaluate(()=>window.__navigationMasks))-beforeMask};metrics.visits.push(row);assert.equal(row.textureRequests,0);if(!before)assert.equal(row.masks,0);
 }
 assert.equal(calls.filter(c=>c.action==='visitEncounter').length-checks,5,'every visit retains its server entry check');assert.equal(db.data.get('groups/A/users/alice').farm.coins,12345);assert.deepEqual(errors,[]);
 await page.screenshot({path:'/tmp/gugu-navigation-'+metrics.label+'.png'});fs.writeFileSync('/tmp/gugu-navigation-'+metrics.label+'.json',JSON.stringify(metrics,null,2));console.log('PASS navigation loading benchmark '+JSON.stringify(metrics));
};
