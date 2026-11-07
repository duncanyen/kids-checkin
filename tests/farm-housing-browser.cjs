// Run with a local static server: FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-housing-browser.cjs
// All Firestore reads, transactions and listeners use an isolated in-memory database.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const base = process.env.FARM_BASE_URL || 'http://127.0.0.1:8012';
const firestore = `
const prefix='groups/dragon-test/users/';
const seed={coins:150,hens:2,coopLevel:3,eggsReady:2,lastLayTime:Date.now(),cleanliness:0,warehouseLimit:10,hensState:[{},{}],equippedWeapon:'club',mace:1};
const docs={'groups/dragon-test':{members:['self','neighbor']},[prefix+'self']:{farm:structuredClone(seed)},[prefix+'neighbor']:{farm:{...structuredClone(seed),eggsReady:5}}};
const listeners=new Map();
const snapshot=ref=>({exists:()=>!!docs[ref.path],data:()=>structuredClone(docs[ref.path])});
function notify(){for(const [path,cbs] of listeners)for(const cb of cbs)cb(snapshot({path}));}
export const doc=(_, ...parts)=>({path:parts.join('/')});
export const collection=doc,query=doc,where=doc;
export function onSnapshot(ref,cb){if(!listeners.has(ref.path))listeners.set(ref.path,new Set());listeners.get(ref.path).add(cb);queueMicrotask(()=>cb(snapshot(ref)));return()=>listeners.get(ref.path).delete(cb);}
export const getDoc=async ref=>snapshot(ref);
export const getDocs=async()=>({forEach:()=>{}});
const deny=()=>{throw Error('Unexpected write outside a mocked transaction');};
export const setDoc=deny,updateDoc=deny,addDoc=deny,serverTimestamp=deny;
let queue=Promise.resolve();
export function runTransaction(_,callback){const run=queue.then(async()=>{
 if(window.__farmTest.failNext){window.__farmTest.failNext=false;throw Error('Simulated offline');}
 if(window.__farmTest.holdNext){window.__farmTest.holdNext=false;await new Promise(resolve=>window.__farmTest.releaseTransaction=resolve);}
 const writes=[];const sets=[];
 const result=await callback({get:async ref=>snapshot(ref),set:(ref,value)=>sets.push([ref,value]),update:(ref,values)=>writes.push([ref,values])});
 for(const [ref,value] of sets)docs[ref.path]=structuredClone(value);
 for(const [ref,values] of writes) for(const [key,value] of Object.entries(values)){
  const bits=key.split('.');let object=docs[ref.path];for(const bit of bits.slice(0,-1))object=object[bit]??={};object[bits.at(-1)]=structuredClone(value);
 }
 if(writes.length||sets.length){window.__farmTest.commits++;notify();}
 return result;
 });queue=run.catch(()=>{});return run;}
window.__farmTest={docs,commits:0,patch:(who,values)=>{Object.assign(docs[prefix+who].farm,values);notify();}};
`;
(async () => {
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const phaser=require('node:fs').existsSync('/tmp/kids-phaser.js')?require('node:fs').readFileSync('/tmp/kids-phaser.js','utf8'):execFileSync('curl',['--fail','--silent','--show-error','--max-time','30','https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:phaser}));
 await page.route('**/js/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const db={};'}));
 await page.route('https://www.gstatic.com/**',r=>r.fulfill({contentType:'text/javascript',body:firestore}));
 // Mailbox subscriptions are covered separately by farm-mail-browser.cjs.
 await page.route('**/js/farm/mail-ui.js',r=>r.fulfill({contentType:'text/javascript',body:'export function mountFarmMail(){}'}));
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','const game = window.__farmGame =')});});
 await page.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',groupId:'dragon-test',name:'測試玩家'})));
 await page.goto(base+'/farmgame.html');
 await page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').hensGroup?.length===2);


 await page.evaluate(()=>{const now=Date.now();__farmTest.patch('self',{hens:10,hensState:Array.from({length:10},(_,i)=>({id:'h'+i,breed:'hen',laidAt:now,isSick:i===0||i===9,sickTimestamp:now})),poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0},eggsReady:0,coopLevel:2,medicines:2,cleanliness:50});__farmGame.scene.getScene('MyFarmScene').scene.start('WarehouseScene');});
 await page.waitForFunction(()=>__farmGame.scene.getScene('WarehouseScene').farmData?.hens===10);
 const openBird=()=>page.evaluate(()=>{const s=__farmGame.scene.getScene('WarehouseScene');if(s.children.list.some(c=>c.text==='雞隻放風設定'))throw Error('Standalone housing button still present');s.selectWarehouseCategory('chickens');s.itemsPanel.list.find(c=>c.type==='Rectangle'&&c.x===100&&c.y===0).emit('pointerdown');});
 const press=key=>page.evaluate(key=>__farmGame.scene.getScene('WarehouseScene').housingDialog[key].emit('pointerdown'),key);
 await openBird();
 assert.equal(await page.locator('[role=dialog][aria-label="母雞放風設定"]').count(),0);
 await press('minus');await press('cancel');
 assert.equal(await page.evaluate(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.outdoorHensByBreed),undefined);
 await openBird();
 for(let i=0;i<5;i++)await press('minus');await press('confirm');
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').housingDialog.message.text),'至少需要 6 隻在外面');
 assert.equal(await page.evaluate(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.outdoorHensByBreed),undefined);
 await press('max');assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').housingDialog.qty.text),'10');
 for(let i=0;i<4;i++)await press('minus');
 await page.screenshot({path:'/tmp/farm-housing-game-panel.png'});
 await press('confirm');await page.waitForFunction(()=>!__farmGame.scene.getScene('WarehouseScene').housingDialog);
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').scene.start('MyFarmScene'));
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').hensGroup?.length===6);
 const clickCoop=async(touch=false)=>{
  const point=await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene'),p=s.cameras.main.matrix.transformPoint(s.coop.x-s.cameras.main.scrollX,s.coop.y-20-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};});
  if(touch)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
 };
 const pressConfirm=async(yes,touch=false)=>{
  const point=await page.evaluate(yes=>{const s=__farmGame.scene.getScene('MyFarmScene'),p=s.cameras.main.matrix.transformPoint((yes?130:260)-s.cameras.main.scrollX,450-s.cameras.main.scrollY),r=s.game.canvas.getBoundingClientRect();return{x:r.x+p.x/s.scale.width*r.width,y:r.y+p.y/s.scale.height*r.height};},yes);
  if(touch)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
 };
 await clickCoop(true);
 assert.equal(await page.locator('[data-coop-sick-count]').innerText(),'生病雞隻：共 2 隻（雞舍內 1 隻、放風中 1 隻）');
 assert.equal(await page.evaluate(()=>__farmGame.input.enabled),true,'the global manager must keep receiving touchend');
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').input.enabled),false,'the DOM menu blocks only its scene');
 await page.getByRole('button',{name:'清理雞舍',exact:true}).tap();
 assert.equal(await page.evaluate(()=>__farmGame.input.enabled),true,'cleaning confirmation must receive canvas input');
 await pressConfirm(false,true);
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').dialogContainer.visible),false,'No closes the cleaning confirmation');
 await clickCoop();
 await page.getByRole('button',{name:'關閉',exact:true}).tap();
 assert.equal(await page.evaluate(()=>__farmGame.input.enabled),true,'closing the coop menu restores input');
 await clickCoop();
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>__farmGame.input.enabled),true,'Escape restores input');
 await clickCoop();
 await page.getByRole('button',{name:'清理雞舍',exact:true}).click();
 await pressConfirm(true);
 await page.waitForFunction(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.cleanliness===0);
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');if(s.hensGroup.some(h=>h.hState.id==='h9'))throw Error('Indoor sick hen still outside');s.askCleanMyFarm();Math.random=()=>.99;});
 await page.getByRole('button',{name:'清理雞舍',exact:true}).waitFor();
 const treatment=()=>page.getByRole('button',{name:'餵食咕咕活力飲',exact:true});
 await page.evaluate(()=>__farmTest.failNext=true);
 await treatment().tap();
 await page.waitForFunction(()=>document.querySelector('[role=dialog][aria-label="雞舍管理"] [role=status]').textContent.includes('Simulated offline'));
 assert.equal(await treatment().isEnabled(),true);
 assert.equal(await page.locator('[data-coop-sick-count]').innerText(),'生病雞隻：共 2 隻（雞舍內 1 隻、放風中 1 隻）');
 assert.equal(await page.evaluate(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.medicines),2);
 await page.evaluate(()=>__farmTest.holdNext=true);
 await treatment().tap();
 await page.waitForFunction(()=>typeof __farmTest.releaseTransaction==='function');
 assert.equal(await treatment().isEnabled(),false);
 await page.getByRole('button',{name:'關閉',exact:true}).tap();
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').input.enabled),true,'closing a pending treatment restores scene input');
 await clickCoop(true);
 await page.evaluate(()=>__farmTest.releaseTransaction());
 await page.waitForFunction(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.medicines===1&&!__farmGame.scene.getScene('MyFarmScene').isTreating);
 assert.equal(await page.evaluate(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.hensState[9].isSick),false);
 assert.equal(await page.locator('[data-coop-sick-count]').innerText(),'生病雞隻：共 1 隻（雞舍內 0 隻、放風中 1 隻）');
 assert.equal(await page.locator('[data-coop-medicine-count]').innerText(),'可用藥品：1 份，每次治療 1 隻');
 await page.screenshot({path:'/tmp/farm-coop-sick-count.png'});
 await treatment().tap();
 await page.waitForFunction(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.medicines===0);
 assert.equal(await page.getByRole('button',{name:'餵食咕咕活力飲',exact:true}).count(),0);
 assert.equal(await page.locator('[data-coop-sick-count]').innerText(),'生病雞隻：共 0 隻（雞舍內 0 隻、放風中 0 隻）');
 await page.getByRole('button',{name:'關閉',exact:true}).tap();
 await page.evaluate(()=>__farmTest.patch('self',{cleanliness:50}));
 await clickCoop(true);
 await pressConfirm(false,true);
 assert.equal(await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').dialogContainer.visible),false,'touch remains responsive after the final cure');
 assert.equal(await page.evaluate(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.hens),10);
 assert.deepEqual(errors,[]);console.log('PASS housing: canvas shop-style quantity panel and MAX, bird item entry, cancel without saving, minimum warning on confirm, valid save, only six rendered, mixed indoor/outdoor illness counts, real touch clean/confirm/cancel, Escape/close recovery, failed treatment retry, close/reopen during pending treatment, live medicine counts, hidden sick hen cured, one medicine each and zero-sick option removal');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
