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


 await page.evaluate(()=>{const now=Date.now();__farmTest.patch('self',{hens:10,hensState:Array.from({length:10},(_,i)=>({id:'h'+i,breed:'hen',laidAt:now,isSick:i===0||i===9,sickTimestamp:now})),poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0},eggsReady:0,coopLevel:2,medicines:2,cleanliness:50});__farmGame.scene.getScene('MyFarmScene').scene.start('WarehouseScene');});
 await page.waitForFunction(()=>__farmGame.scene.getScene('WarehouseScene').farmData?.hens===10);
 const openBird=()=>page.evaluate(()=>{const s=__farmGame.scene.getScene('WarehouseScene');if(s.children.list.some(c=>c.text==='雞隻放風設定'))throw Error('Standalone housing button still present');s.selectWarehouseCategory('chickens');s.itemsPanel.list.find(c=>c.type==='Rectangle'&&c.x===100&&c.y===0).emit('pointerdown');});
 await openBird();
 await page.getByRole('button',{name:'減少母雞放風',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();
 assert.equal(await page.evaluate(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.outdoorHensByBreed),undefined);
 await openBird();
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'減少母雞放風',exact:true}).click();
 await page.getByRole('button',{name:'確認',exact:true}).click();
 await page.getByText('至少需要 6 隻在外面',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.outdoorHensByBreed),undefined);
 await page.getByRole('button',{name:'增加母雞放風',exact:true}).click();
 await page.getByRole('button',{name:'確認',exact:true}).click();
 await page.getByRole('dialog',{name:'母雞放風設定'}).waitFor({state:'hidden'});
 await page.evaluate(()=>__farmGame.scene.getScene('WarehouseScene').scene.start('MyFarmScene'));
 await page.waitForFunction(()=>__farmGame.scene.getScene('MyFarmScene').hensGroup?.length===6);
 await page.evaluate(()=>{const s=__farmGame.scene.getScene('MyFarmScene');if(s.hensGroup.some(h=>h.hState.id==='h9'))throw Error('Indoor sick hen still outside');s.askCleanMyFarm();Math.random=()=>.99;});
 await page.getByRole('button',{name:'清理雞舍',exact:true}).waitFor();await page.getByRole('button',{name:'餵食咕咕活力飲',exact:true}).click();
 await page.waitForFunction(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.medicines===1);
 assert.equal(await page.evaluate(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.hensState[9].isSick),false);
 await page.getByRole('button',{name:'餵食咕咕活力飲',exact:true}).click();
 await page.waitForFunction(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.medicines===0);
 assert.equal(await page.getByRole('button',{name:'餵食咕咕活力飲',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>__farmTest.docs['groups/dragon-test/users/self'].farm.hens),10);
 assert.deepEqual(errors,[]);console.log('PASS housing: bird item entry, cancel without saving, minimum warning on confirm, valid save, only six rendered, hidden sick hen cured, one medicine each, treatment option disappears');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
