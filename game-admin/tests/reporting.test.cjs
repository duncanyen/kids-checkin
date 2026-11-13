const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixture.cjs');
const {createReporting,MONSTERS}=require('../functions/reporting.cjs');
const {MemoryDB}=require('./memory-db.cjs');
const baseline=()=>({coins:100,hens:3,combatKills:{wolf:0,tiger:0}});
async function setup(){const f=await fixture(),capture=createReporting({db:f.db,now:f.now}).capture,base=f.now();f.clock(base+1000);return{...f,capture,base,event:(patch={})=>({id:'event-1',groupId:'A',accountId:'alice',before:baseline(),after:{...baseline(),coins:150,reportHarvestedEggs:5,reportStolenEggs:1,combatKills:{wolf:2,tiger:1},...Object.fromEntries(['eagle','dragon','gorilla','cobra','mole','giant'].map(key=>[key+'Results',[{id:key+'-win',outcome:'win'},{id:key+'-loss',outcome:'loss'}]]))},occurredAt:base,...patch})};}
test('reports require current server admin claims; absent history is explicit and no secrets escape',async()=>{
 const f=await setup();await assert.rejects(f.service.adminAPI({data:{action:'farmReport',payload:{}}}),{code:'unauthenticated'});
 await assert.rejects(f.service.adminAPI({auth:{uid:'alice',token:{}},data:{action:'farmReport',payload:{}}}),{code:'permission-denied'});
 await f.db.doc('users/alice').set({accountId:'alice',name:'最新名稱',password:'DO-NOT-RETURN',pin:'SECRET'});
 const r=await f.admin('farmReport',{startAt:f.base-100,endAt:f.base+500});assert.equal(r.coverage,'not-started');assert.equal(r.rows.length,4);assert.equal(r.rows.find(row=>row.accountId==='alice').name,'最新名稱');assert.ok(!JSON.stringify(r).includes('DO-NOT-RETURN'));f.revoke();await assert.rejects(f.admin('farmReport',{startAt:1,endAt:2}),{code:'permission-denied'});
});
test('capture is idempotent, counts egg quantities, every monster type, positive/negative coins and isolates groups',async()=>{
 const f=await setup(),event=f.event();assert.equal((await f.capture(event)).recorded,true);assert.equal((await f.capture(event)).replayed,true);
 await f.capture(f.event({id:'spend',before:{...baseline(),coins:150},after:{...baseline(),coins:120},occurredAt:f.base+100}));
 const r=await f.admin('farmReport',{startAt:f.base,endAt:f.base+500}),a=r.rows.find(row=>row.groupId==='A'&&row.accountId==='alice'),b=r.rows.find(row=>row.groupId==='B');assert.equal(a.metrics.collectedEggs,5);assert.equal(a.metrics.stolenEggs,1);assert.equal(a.metrics.coinsAdded,50);assert.equal(a.metrics.coinsSpent,30);assert.equal(a.metrics.coinsNet,20);assert.equal(a.metrics.monsters.wolf,2);for(const kind of Object.keys(MONSTERS).filter(key=>key!=='wolf'))assert.equal(a.metrics.monsters[kind],1);assert.equal(b.metrics.collectedEggs,0);assert.equal(r.eventCount,2);assert.equal(r.coverage,'observed');
});
test('server commit time uses half-open bounds; late delivery adjusts first observation without creating historical totals',async()=>{
 const f=await setup();await f.capture(f.event({id:'later',occurredAt:f.base+100}));await f.capture(f.event({id:'earlier',occurredAt:f.base}));
 const r=await f.admin('farmReport',{startAt:f.base,endAt:f.base+100});assert.equal(r.firstObservedAt,f.base);assert.equal(r.eventCount,1);assert.equal((await f.admin('farmReport',{startAt:f.base-100,endAt:f.base})).coverage,'unavailable');assert.equal((await f.admin('farmReport',{startAt:f.base-100,endAt:f.base+100})).coverage,'partial');
});
test('new farms, production-only writes, old receipts and failed battles do not manufacture activity',async()=>{
 const f=await setup();assert.equal((await f.capture(f.event({before:undefined}))).ignored,true);
 const same={...baseline(),dragonResults:[{id:'old',outcome:'win'}]};assert.equal((await f.capture(f.event({before:same,after:{...same,cleanliness:20}}))).ignored,true);
 assert.equal((await f.capture(f.event({before:baseline(),after:{...baseline(),dragonResults:[{id:'loss',outcome:'loss'}]}}))).ignored,true);
 const r=await f.admin('farmReport',{startAt:f.base,endAt:f.base+500});assert.equal(r.coverage,'not-started');assert.equal(r.eventCount,0);
});
test('read-only report uses current hens/balance, handles no farm/missing profile and refuses unsafe ranges',async()=>{
 const f=await setup();await f.db.doc('groups/B/users/alice').set({farm:{hens:14,coins:678}});await f.db.doc('groups/C').set({name:'空村落',members:['no-profile','no-profile']});
 const r=await f.admin('farmReport',{startAt:f.base,endAt:f.base+500});assert.equal(r.rows.length,5);const b=r.rows.find(row=>row.groupId==='B');assert.equal(b.currentHens,14);assert.equal(b.currentCoins,678);assert.equal(r.rows.find(row=>row.accountId==='no-profile').hasFarm,false);
 for(const payload of [{startAt:10,endAt:9},{startAt:f.base,endAt:f.base+9999},{startAt:0,endAt:367*86400000},{startAt:'x',endAt:1}])await assert.rejects(f.admin('farmReport',payload),{code:'invalid-argument'});
});
test('failed capture rolls back event and coverage together, retry remains possible; data anomalies are marked',async()=>{
 const f=await setup(),run=f.db.runTransaction.bind(f.db);f.db.runTransaction=cb=>run(async t=>{await cb(t);throw Error('storage failure');});await assert.rejects(f.capture(f.event()),/storage failure/);assert.equal((await f.db.collection('ops_farm_report_events').get()).size,0);assert.equal((await f.db.doc('ops_report_meta/farm').get()).exists,false);f.db.runTransaction=run;await f.capture(f.event());
 await f.capture(f.event({id:'reset',before:{coins:100,reportHarvestedEggs:20},after:{coins:90,reportHarvestedEggs:0,dragonResults:{}},occurredAt:f.base+50}));const r=await f.admin('farmReport',{startAt:f.base,endAt:f.base+500});assert.ok(r.rows.find(row=>row.groupId==='A'&&row.accountId==='alice').warnings.length);
});
test('safety limits fail explicitly rather than silently returning only the first groups',async()=>{
 const f=await setup();for(let i=0;i<500;i++)await f.db.doc('groups/extra'+i).set({members:[]});await assert.rejects(f.admin('farmReport',{startAt:f.base,endAt:f.base+500}),{code:'resource-exhausted'});
});
