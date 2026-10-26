import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fromWire, liveDocument, liveQuery, subscribeLive } from '../js/live-read-core.js';
const require = createRequire(import.meta.url);
const { key, wire, node, newer, epochMicros } = require('../functions/live-model.cjs');
const makeMirror = require('../functions/mirror.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const timestamp = ms => ({ toMillis: () => ms });

test('wire format preserves empty containers, nulls, special-key names and timestamps without invalid RTDB keys', () => {
 const data={empty:[],object:{},nullable:null,list:[null,{},[]],unreadCount:{'A.#$[]/華':2},timestamp:timestamp(1234)};
 const restored=fromWire(wire(data));assert.deepEqual(restored.empty,[]);assert.deepEqual(restored.object,{});assert.deepEqual(restored.list,[null,{},[]]);assert.equal(restored.nullable,null);assert.equal(restored.unreadCount['A.#$[]/華'],2);assert.equal(restored.timestamp.toDate().getTime(),1234);
 const check=value=>{if(value&&typeof value==='object')for(const [name,child]of Object.entries(value)){assert.doesNotMatch(name,/[.#$\[\]/]/);check(child);}};check(wire(data));assert.equal(decodeURIComponent(key('A.#$[]/華')),'A.#$[]/華');
});
test('monotonic updates and tombstones cannot resurrect an older farm/message', () => {
 const first=node({farm:{coins:1}},1),second=node({farm:{coins:2}},2),deleted=node(null,3);
 assert.equal(newer(second,first),undefined);assert.equal(newer(deleted,second),undefined);assert.deepEqual(newer(first,second),second);
 assert.equal(epochMicros('2026-10-26T00:00:00.123456Z')-epochMicros('2026-10-26T00:00:00.123455Z'),1);
 assert.equal(liveDocument('id',deleted).exists(),false);
 const query=liveQuery({a:node({text:'old'},1,10),b:node({text:'new'},2,20),c:deleted});assert.deepEqual(query.docs.map(x=>x.id),['b','a']);
});
test('subscription upgrades a missing farm from verified Firestore fallback to RTDB; cleanup cancels pending work', async () => {
 let send,stopLive=0,stopFallback=0,fallbacks=0;const results=[];
 const runtime={ready:{farms:true},listen(path,options,next){send=next;return()=>stopLive++;}};
 const stop=subscribeLive({enabled:true,connect:async()=>runtime,context:{},channel:'farms',path:'farms/A/self',next:x=>results.push(x.data()),fallback:next=>{fallbacks++;next({data:()=>({farm:{coins:4}})});return()=>stopFallback++;}});
 await tick();send(null);assert.equal(fallbacks,1);send(node({farm:{coins:5}},2));assert.equal(stopFallback,1);assert.deepEqual(results,[{farm:{coins:4}},{farm:{coins:5}}]);stop();send(node({farm:{coins:6}},3));assert.equal(results.length,2);assert.equal(stopLive,1);
 let resolve,subscribed=false;const closed=subscribeLive({enabled:true,connect:()=>new Promise(r=>resolve=r),context:{},channel:'farms',path:'x',fallback:()=>{throw Error('late fallback');},next:()=>{throw Error('late data');}});await tick();closed();resolve({ready:{farms:true},listen(){subscribed=true;}});await tick();assert.equal(subscribed,false);
});
test('unready/unavailable service falls back, but permission denial never falls back', async () => {
 for(const outcome of ['unready','offline','denied']){
  let fallbacks=0,errors=0;const stop=subscribeLive({enabled:true,connect:async()=>{if(outcome!=='unready')throw {code:outcome==='denied'?'functions/permission-denied':'unavailable'};return{ready:{farms:false}};},context:{},channel:'farms',path:'x',next:()=>{},error:()=>errors++,fallback:()=>{fallbacks++;return()=>{};}});
  await tick();assert.equal(fallbacks,outcome==='denied'?0:1);assert.equal(errors,outcome==='denied'?1:0);stop();
 }
});
function fixture() {
 const records={},fs={
  'groups/A':{members:['alice','bob'],farmVillageVisibility:'public'},
  'users/a':{accountId:'alice',name:'Alice'},'users/b':{accountId:'bob',name:'Bob'},
  'rooms/r':{groupId:'A',participants:['Alice','Bob'],lastMessageTime:timestamp(5)}
 };
 let reads=0;
 const snapshot=(data,ms=10)=>({exists:!!data,data:()=>data,updateTime:data?{seconds:ms,nanoseconds:0}:undefined});
 const firestore={doc(path){return{async get(){reads++;return snapshot(fs[path]);}};},collection(name){return{where(field,op,value){return{async get(){reads++;const docs=Object.entries(fs).filter(([path,data])=>path.startsWith(name+'/')&&(op==='in'?value.includes(data[field]):data[field]===value)).map(([path,data])=>({id:path.split('/').at(-1),...snapshot(data)}));return{docs,forEach:cb=>docs.forEach(cb)};}};}};}};
 const database={ref(prefix){return{child(path){const full=prefix+'/'+path;return{get:async()=>({val:()=>records[full]||null}),transaction:async callback=>{const result=callback(records[full]||null);if(result!==undefined)records[full]=result;return{committed:result!==undefined};}};}};}};
 return{mirror:makeMirror(firestore,database),records,fs,snapshot,reads:()=>reads};
}
test('mirror emits only farm data and derives room participants from current group membership; removals revoke indexes', async()=>{
 const f=fixture(),m=f.mirror;
 await m.farm('A','alice',f.snapshot({farm:{coins:4},password:'never mirror',score:9},2));assert.deepEqual(fromWire(f.records['nexus/farms/A/alice'].data),{farm:{coins:4}});
 await m.farm('A','alice',f.snapshot({farm:{coins:1}},1));assert.equal(fromWire(f.records['nexus/farms/A/alice'].data).farm.coins,4);
 await m.account('alice',f.snapshot(f.fs['users/a'],1));assert.equal(f.records['nexus/access/accounts/alice'].active,true);
 await m.group('A',f.snapshot(f.fs['groups/A'],1));await m.room('r',f.snapshot(f.fs['rooms/r'],2),null);
 assert.deepEqual(f.records['nexus/access/rooms/r'].participants,{alice:true,bob:true});
 const readCount=f.reads();await m.room('r',f.snapshot({...f.fs['rooms/r'],lastMessage:'next'},3),f.snapshot(f.fs['rooms/r'],2));assert.equal(f.reads(),readCount,'Unread/message-only room updates reuse participant mapping');
 f.fs['groups/A'].members=['alice'];await m.group('A',f.snapshot(f.fs['groups/A'],4));await m.refreshGroupRooms('A');
 assert.deepEqual(f.records['nexus/access/rooms/r'].participants,{alice:true});assert.equal(f.records['nexus/inboxes/A/bob/r'].deleted,true);
 await m.account('alice',f.snapshot({...f.fs['users/a'],role:'removed'},5));assert.equal(f.records['nexus/access/accounts/alice'].active,false);
});
test('message mirroring resolves legacy room group, handles retraction/deletion and rejects mismatched group', async()=>{
 const f=fixture();await f.mirror.message('m',f.snapshot({roomId:'r',text:'legacy',timestamp:timestamp(10)},1),null);
 assert.equal(fromWire(f.records['nexus/messages/A/r/m'].data).text,'legacy');
 await f.mirror.message('m',f.snapshot({roomId:'r',isRetracted:true,text:'',timestamp:timestamp(10)},2),f.snapshot({roomId:'r'}));assert.equal(fromWire(f.records['nexus/messages/A/r/m'].data).isRetracted,true);
 await f.mirror.message('bad',f.snapshot({groupId:'B',roomId:'r',text:'wrong'},3),null);assert.equal(f.records['nexus/messages/A/r/bad'],undefined);
 await f.mirror.message('m',f.snapshot(null),f.snapshot({roomId:'r'}),'2026-10-26T00:00:00Z');assert.equal(f.records['nexus/messages/A/r/m'].deleted,true);
});

test('revoked permissions stop an existing fallback; missing rooms never use a Firestore bypass', async()=>{
 let send,deny,stopped=0,errors=0;
 const stop=subscribeLive({enabled:true,connect:async()=>({ready:{farms:true},listen(path,options,next,error){send=next;deny=error;return()=>{};}}),context:{},channel:'farms',path:'farms/A/self',fallback:()=>()=>stopped++,next:()=>{},error:()=>errors++});
 await tick();send(null);deny({code:'permission-denied'});assert.equal(stopped,1);assert.equal(errors,1);stop();
 let roomSend,fallbacks=0,result;
 const close=subscribeLive({enabled:true,connect:async()=>({ready:{chat:true},listen(path,options,next){roomSend=next;return()=>{};}}),context:{},channel:'chat',path:'rooms/A/r',fallback:()=>{fallbacks++;return()=>{};},next:doc=>result=doc});
 await tick();roomSend(null);assert.equal(result.exists(),false);assert.equal(fallbacks,0);close();
});
