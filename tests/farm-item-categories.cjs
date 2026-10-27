// Run with a local static server: FARM_BASE_URL=http://127.0.0.1:8006 node tests/farm-gorilla.cjs
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
 const writes=[];
 const result=await callback({get:async ref=>snapshot(ref),update:(ref,values)=>writes.push([ref,values])});
 for(const [ref,values] of writes) for(const [key,value] of Object.entries(values)){
  const bits=key.split('.');let object=docs[ref.path];for(const bit of bits.slice(0,-1))object=object[bit]??={};object[bits.at(-1)]=structuredClone(value);
 }
 if(writes.length){window.__farmTest.commits++;notify();}
 return result;
 });queue=run.catch(()=>{});return run;}
window.__farmTest={docs,commits:0,patch:(who,values)=>{Object.assign(docs[prefix+who].farm,values);notify();}};
`;
(async () => {
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
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


 const checks=[];
 await page.evaluate(()=>{
  const now=Date.now();window.__farmTest.patch('self',{coins:20000,coopLevel:1,hens:3,poultryVersion:2,hensState:['hen','silkie','bresse'].map((breed,i)=>({id:'h'+i,breed,laidAt:now})),readyEggs:{hen:0,silkie:0,bresse:0},eggsReady:0,inventoryEggs:1,silkieEggs:2,bresseEggs:3,mace:1,battleaxe:1,worms:1,earthworms:1,wolfFangs:1,tigerPelts:1,dragonScales:1,gorillaFangs:1,medicines:1,warehouseLimit:99});
  window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene');
 });
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('ShopScene'));
 await page.evaluate(async()=>{
  const s=window.__farmGame.scene.getScene('ShopScene');
  const keys=()=>[...new Set((s.shopMode==='buy'?s.buyContainer:s.sellContainer).list.filter(o=>o.visible).map(o=>o.catalogKey))];
  const same=(actual,expected)=>{if(actual.sort().join(',')!==expected.sort().join(','))throw Error('Wrong category '+actual);};
  same(keys(),['hen','silkie','bresse']);if(s.pageText.visible)throw Error('Single page controls should hide');
  s.categoryTabs.tabs.get('weapons').background.emit('pointerdown');same(keys(),['mace','battleaxe']);
  s.buyContainer.list.find(o=>o.catalogKey==='mace'&&o.type==='Rectangle').emit('pointerdown');if(!s.dialogContainer.visible||!s.dialogTitle.text.includes('狼牙棒'))throw Error('Weapon purchase click broken');s.dialogContainer.setVisible(false);
  s.children.list.find(o=>o.type==='Rectangle'&&o.x===290&&o.y===180).emit('pointerdown');same(keys(),['mace']);
  s.selectShopCategory('chickens');same(keys(),['bird:hen','inventoryEggs','bird:silkie','silkieEggs','bird:bresse','bresseEggs']);
  s.selectShopCategory('coops');if(!s.emptyCategoryText.visible||!s.emptyCategoryText.text.includes('無法賣出'))throw Error('Coop sale empty explanation missing');same(keys(),[]);
  s.children.list.find(o=>o.type==='Rectangle'&&o.x===100&&o.y===180).emit('pointerdown');same(keys(),['coop2','coop3','coop4','coop5']);
  if(!s.buyContainer.list.some(o=>o.text==='中級雞舍\n3000金幣')||!s.buyContainer.list.some(o=>o.text==='高級雞舍\n10000金幣'))throw Error('Coop names not updated');
  const before=window.__farmTest.commits;
  for(const key of ['coop4','coop5'])s.buyContainer.list.find(o=>o.catalogKey===key&&o.type==='Rectangle').emit('pointerdown');
  s.openTradeModal('buy','coop4','特級雞舍',0,true);await s.executeUpgradeCoop(5,0);
  if(window.__farmTest.commits!==before||s.dialogContainer.visible)throw Error('Upcoming coop was purchasable');
  s.selectShopCategory('other');same(keys(),['expand','medicine']);
  s.selectShopCategory('coops');
 });
 await page.screenshot({path:'/tmp/farm-shop-categories.png'});
 checks.push('shop chicken/weapon/coop/other categories, buy/sell filtering, new coop names, future coop nonpurchasable, hidden single-page controls');
 // Simulate additional configured weapons to exercise real category pagination.
 await page.evaluate(async()=>{
  const {WEAPONS_CONFIG}=await import('/js/farm/combat-rules.js');
  for(let i=0;i<7;i++)WEAPONS_CONFIG['future'+i]={name:'測試武器'+i,icon:'mace',damage:10,buyPrice:100,sellPrice:50};
  window.__farmGame.scene.getScene('ShopScene').scene.restart();
 });
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('ShopScene').catalog.buy.length>15);
 await page.evaluate(()=>{
  const s=window.__farmGame.scene.getScene('ShopScene');s.selectShopCategory('weapons');
  if(s.pageText.text!=='1 / 2'||!s.pageText.visible)throw Error('Category pagination missing');
  s.nextPage.emit('pointerdown');if(s.pageText.text!=='2 / 2')throw Error('Next category page failed');
  const visible=s.buyContainer.list.filter(o=>o.visible);if(new Set(visible.map(o=>o.catalogKey)).size!==3||visible.some(o=>o.catalogCategory!=='weapons'||o.catalogPage!==1))throw Error('Mixed/duplicated page items');
  s.selectShopCategory('other');if(s.pageText.visible)throw Error('Other category inherited weapon pages');
  s.selectShopCategory('weapons');if(s.pageText.text!=='2 / 2')throw Error('Category page not remembered');
  s.children.list.find(o=>o.type==='Rectangle'&&o.x===290&&o.y===180).emit('pointerdown');if(s.pageText.text!=='1 / 2')throw Error('Sale page must be independent');
  s.nextPage.emit('pointerdown');if(s.pageText.text!=='2 / 2')throw Error('Sale page failed');
  const values={};for(let i=0;i<7;i++)values['future'+i]=1;window.__farmTest.patch('self',values);
  s.scene.start('WarehouseScene');
 });
 checks.push('configured extra items paginate inside category, independent buy/sell/category page memory, no cross-category leakage');
 await page.waitForFunction(()=>window.__farmGame.scene.isActive('WarehouseScene')&&window.__farmGame.scene.getScene('WarehouseScene').farmData);
 await page.evaluate(()=>{
  const s=window.__farmGame.scene.getScene('WarehouseScene'),keys=()=>s.visibleWarehouseItems.map(i=>i.key).sort().join(',');
  if(keys()!==['bird:hen','bird:silkie','bird:bresse','inventoryEggs','silkieEggs','bresseEggs'].sort().join(','))throw Error('Warehouse chicken/egg category wrong');
  const {capacityText}=s;if(!capacityText.text.includes('/99'))throw Error('Capacity changed');
  s.handleItemClick('bird:silkie','烏骨雞');if(s.actionPanel.visible||!s.msgText.text.includes('住在雞舍'))throw Error('Live chickens treated as inventory/feed');
  s.categoryTabs.tabs.get('coops').background.emit('pointerdown');if(keys()!=='ownedCoop'||!s.itemsPanel.list.some(o=>o.text==='基礎雞舍\n飼養 3/3'))throw Error('Coop status absent');
  s.selectWarehouseCategory('other');if(s.visibleWarehouseItems.some(i=>!['warehouseCapacity','coins','worms','earthworms','wolfFangs','tigerPelts','dragonScales','gorillaFangs','medicines'].includes(i.key)))throw Error('Other category mixed');
  if(!s.warehousePageText.visible||s.warehousePageText.text!=='1 / 2')throw Error('Existing supplies should paginate');
  s.nextPage.emit('pointerdown');if(s.visibleWarehouseItems.length!==1)throw Error('Supplies second page missing');
  s.selectWarehouseCategory('weapons');if(s.warehousePageText.text!=='1 / 2'||!s.warehousePageText.visible)throw Error('Warehouse category pagination missing');
  s.nextPage.emit('pointerdown');if(s.warehousePageText.text!=='2 / 2'||s.visibleWarehouseItems.length!==1)throw Error('Warehouse page wrong');
  s.selectWarehouseCategory('chickens');if(s.warehousePageText.visible)throw Error('Chicken page count wrong');
  s.selectWarehouseCategory('weapons');if(s.warehousePageText.text!=='2 / 2')throw Error('Warehouse page memory missing');
  const patch={};for(let i=0;i<7;i++)patch['future'+i]=0;window.__farmTest.patch('self',patch);
  if(s.warehousePage!==0||s.visibleWarehouseItems.length!==2||s.warehousePageText.visible)throw Error('Removed items left stale empty page');
  s.handleItemClick('mace','狼牙棒');if(!s.actionPanel.visible)throw Error('Equipment action missing');
  s.selectWarehouseCategory('other');if(s.actionPanel.visible)throw Error('Old category action remained open');
  s.selectWarehouseCategory('weapons');window.__farmTest.patch('self',{mace:0,battleaxe:0});if(!s.emptyText.visible||s.visibleWarehouseItems.length||s.warehousePageText.visible)throw Error('Empty category wrong');
  s.selectWarehouseCategory('chickens');
 });
 await page.screenshot({path:'/tmp/farm-warehouse-categories.png'});
 checks.push('warehouse living chickens and eggs grouped, coop status, equipment and supplies categories, pagination/clamping/empty state and stale-action cleanup');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
