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


 await page.evaluate(()=>{window.__farmTest.patch('self',{coins:30000,warehouseLimit:99,coopLevel:3});window.__farmGame.scene.getScene('MyFarmScene').scene.start('ShopScene');});
 await page.waitForFunction(()=>{const s=__farmGame.scene.getScene('ShopScene');return s.sys.isActive()&&s.farmData&&s.buyContainer;});
 await page.evaluate(async()=>{
  const s=__farmGame.scene.getScene('ShopScene'),f=()=>__farmTest.docs['groups/dragon-test/users/self'].farm;
  s.selectShopCategory('chickens');
  const entry=s.catalog.buy.find(([key])=>key==='onagadori');
  if(!entry||!entry[2].includes('6000金幣')||!entry[2].includes('尚未開賣'))throw Error('Missing locked display');
  const bg=s.buyContainer.list.find(c=>c.catalogKey==='onagadori'&&c.getData?.('purchaseDisabled'));
  if(!bg?.visible)throw Error('Locked bird not visible');
  bg.emit('pointerdown');if(!s.msgText.text.includes('尚未開賣')||s.dialogContainer.visible)throw Error('Locked card opens trade');
  s.openTradeModal('buy','onagadori','日本長尾雞',6000);if(s.dialogContainer.visible)throw Error('Direct modal bypass');
  const before=JSON.stringify(f());await s.executeBuyHen(1,'onagadori');if(JSON.stringify(f())!==before)throw Error('Direct purchase bypass');
  for(const action of ['idle','walk'])if(s.anims.get('onagadori_'+action).frames.length!==8)throw Error('Missing long tail animation');
 });
 await page.screenshot({path:'/tmp/farm-onagadori-shop.png'});
 await page.evaluate(()=>__farmGame.scene.getScene('ShopScene').poultryGuide.setVisible(true));
 await page.screenshot({path:'/tmp/farm-onagadori-guide.png'});
 // Inject a bird only into the isolated fixture to exercise the future livestock rules.
 await page.evaluate(()=>{
  const now=Date.now();__farmTest.patch('self',{poultryVersion:2,hens:1,hensState:[{id:'long',breed:'onagadori',laidAt:now-24*3600000,isSick:false}],readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,cleanliness:0,worms:0,earthworms:0});
  __farmGame.scene.getScene('ShopScene').scene.start('MyFarmScene');
 });
 await page.waitForFunction(()=>{const s=__farmGame.scene.getScene('MyFarmScene');return s.sys.isActive()&&s.hensGroup?.length===1&&s.hensGroup[0].texture.key==='onagadori'&&s.farmData?.readyEggs.onagadori===4;});
 await page.evaluate(async()=>{const s=__farmGame.scene.getScene('MyFarmScene');s.pendingEncounter=null;Math.random=()=>.99;await s.harvestEgg();});
 await page.waitForFunction(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.onagadoriEggs===4);
 await page.screenshot({path:'/tmp/farm-onagadori-home.png'});
 await page.evaluate(()=>__farmGame.scene.getScene('MyFarmScene').scene.start('WarehouseScene'));
 await page.waitForFunction(()=>{const s=__farmGame.scene.getScene('WarehouseScene');return s.sys.isActive()&&s.farmData&&s.allConfigItems;});
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('WarehouseScene');if(!s.allConfigItems.some(i=>i.key==='onagadoriEggs'))throw Error('Egg inventory missing');s.scene.start('ShopScene');});
 await page.waitForFunction(()=>{const s=__farmGame.scene.getScene('ShopScene');return s.sys.isActive()&&s.farmData&&s.buyContainer;});
 await page.evaluate(async()=>{
  const s=__farmGame.scene.getScene('ShopScene'),f=()=>__farmTest.docs['groups/dragon-test/users/self'].farm,before=f().coins;
  await s.executeSellItem('onagadoriEggs',120,'日本長尾雞蛋',1);if(f().coins!==before+120||f().onagadoriEggs!==3)throw Error('Egg sale incorrect');
  await s.executeTradePoultry('onagadori',1,'sell');if(f().coins!==before+3120||f().hens!==0)throw Error('Bird sale incorrect');
 });
 assert.deepEqual(errors,[]);console.log('PASS onagadori: visible locked shop card, modal and transaction purchase guards, 16 animation frames, 6-hour/24-hour production, collection, warehouse, 120 egg sale and 3000 bird sale');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
