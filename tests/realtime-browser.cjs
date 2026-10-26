// Run with a local static server: FARM_BASE_URL=http://127.0.0.1:8006 node tests/farm-gorilla.cjs
// All Firestore reads, transactions and listeners use an isolated in-memory database.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const base = process.env.FARM_BASE_URL || 'http://127.0.0.1:8012';
const firestore = `
const prefix='groups/dragon-test/users/';
const seed={coins:150,hens:2,coopLevel:3,eggsReady:2,lastLayTime:Date.now(),cleanliness:0,warehouseLimit:10,hensState:[{},{}],equippedWeapon:'club',mace:1};
const docs={'users/self':{accountId:'self',name:'測試玩家',role:'member'},'users/neighbor':{accountId:'neighbor',name:'鄰居',role:'member'},'rooms/r':{groupId:'dragon-test',name:'RTDB 房間',participants:['測試玩家','鄰居'],lastMessage:'同步測試',lastMessageTime:1},'messages/m':{groupId:'dragon-test',roomId:'r',sender:'鄰居',text:'來自 RTDB 的訊息',timestamp:2},'groups/dragon-test':{members:['self','neighbor']},[prefix+'self']:{farm:structuredClone(seed)},[prefix+'neighbor']:{farm:{...structuredClone(seed),eggsReady:5}}};
const listeners=new Map();
const snapshot=ref=>({exists:()=>!!docs[ref.path],data:()=>structuredClone(docs[ref.path])});
function notify(){window.__liveTest?.emitAll();for(const [path,cbs] of listeners)for(const cb of cbs)cb(snapshot({path}));}
export const doc=(_, ...parts)=>({path:parts.join('/')});
export const collection=(_, ...parts)=>({path:parts.join('/')});export const where=(field,op,value)=>({field,op,value});export const query=(ref,...filters)=>({...ref,filters});export const orderBy=()=>({});export const limit=()=>({});export const increment=value=>value;export const arrayUnion=(...v)=>v;export const arrayRemove=(...v)=>v;
export function onSnapshot(ref,cb){window.__farmTest.firestoreListeners.push(ref.path);if(!listeners.has(ref.path))listeners.set(ref.path,new Set());listeners.get(ref.path).add(cb);queueMicrotask(()=>cb(snapshot(ref)));return()=>listeners.get(ref.path).delete(cb);}
export const getDoc=async ref=>snapshot(ref);
export const getDocs=async ref=>{let rows=Object.entries(docs).filter(([p])=>p.startsWith(ref.path+'/')&&p.split('/').length===2);for(const f of ref.filters||[])if(f.field)rows=rows.filter(([,d])=>f.op==='in'?f.value.includes(d[f.field]):d[f.field]===f.value);const data=rows.map(([path])=>({id:path.split('/').at(-1),...snapshot({path})}));return{docs:data,empty:!data.length,forEach:cb=>data.forEach(cb)};};
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
window.__farmTest={docs,commits:0,firestoreListeners:[],patch:(who,values)=>{Object.assign(docs[prefix+who].farm,values);notify();}};
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
 await page.route('**/js/farm/main.js',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace('const game =','window.__farmGame =')});});
 await page.route('**/js/live-read-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const REALTIME_READS_ENABLED=true;export const REALTIME_REGION="asia-southeast1";'}));
 const {wire}=require('../functions/live-model.cjs');
 const platform=`
 import {liveKey as key} from './live-read-core.js';
 const wire=${wire.toString()};
 const listeners=new Set();
 window.__liveTest={paths:[],emitAll:()=>{for(const l of listeners)l.emit();}};
 function value(path){
  const docs=window.__farmTest.docs,[kind,group,who]=path.split('/');
  const pack=data=>{if(!data)return null;const copy={...data};for(const f of ['timestamp','lastMessageTime'])if(typeof copy[f]==='number')copy[f]={toMillis:()=>data[f]};return{version:1,data:wire(copy),sortTime:data.timestamp||data.lastMessageTime||0};};
  if(kind==='farms')return pack(docs['groups/'+decodeURIComponent(group)+'/users/'+decodeURIComponent(who)]);
  if(kind==='rooms')return pack(docs['rooms/'+decodeURIComponent(who)]);
  return Object.fromEntries(Object.entries(docs).filter(([p,d])=>kind==='inboxes'?p.startsWith('rooms/')&&d.groupId===decodeURIComponent(group):p.startsWith('messages/')&&d.roomId===decodeURIComponent(who)).map(([p,d])=>[key(p.split('/').at(-1)),pack(d)]));
 }
 export async function connect(){return{ready:{chat:true,farms:true},read:async path=>value(path),listen(path,options,next){window.__liveTest.paths.push(path);const l={emit:()=>next(value(path))};listeners.add(l);queueMicrotask(l.emit);return()=>listeners.delete(l);}};}
 `;
 await page.route('**/js/live-read-platform.js',r=>r.fulfill({contentType:'text/javascript',body:platform}));
 await page.addInitScript(()=>sessionStorage.setItem('familyCheckInUser',JSON.stringify({accountId:'self',groupId:'dragon-test',name:'測試玩家'})));
 await page.goto(base+'/farmgame.html');
 await page.waitForFunction(()=>window.__farmGame?.scene.isActive('MyFarmScene')&&window.__farmGame.scene.getScene('MyFarmScene').hensGroup?.length===2);


 await page.evaluate(()=>window.__farmTest.patch('self',{coins:987}));
 await page.waitForFunction(()=>window.__farmGame.scene.getScene('MyFarmScene').farmData.coins===987);
 assert.deepEqual(await page.evaluate(()=>window.__farmTest.firestoreListeners.filter(p=>p.includes('/users/'))),[]);
 assert.ok((await page.evaluate(()=>window.__liveTest.paths)).includes('farms/dragon-test/self'));
 await page.goto(base+'/chat.html');
 await page.waitForSelector('#roomListContainer .room-item');
 await page.locator('#roomListContainer .room-item').first().click();
 await page.waitForFunction(()=>document.getElementById('chatMessages').textContent.includes('來自 RTDB 的訊息'));
 assert.ok((await page.evaluate(()=>window.__liveTest.paths)).includes('messages/dragon-test/r'));
 assert.deepEqual(await page.evaluate(()=>window.__farmTest.firestoreListeners.filter(p=>p==='rooms'||p==='messages'||p.startsWith('rooms/'))),[]);
 assert.deepEqual(errors,[]);
 console.log('PASS: enabled RTDB provider renders real Phaser farm updates and real chat room/message UI, without Firestore listeners for high-frequency farm/chat data');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
