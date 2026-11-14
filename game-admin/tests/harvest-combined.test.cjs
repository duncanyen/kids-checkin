const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('./memory-db.cjs'),{createService}=require('../functions/service.cjs');
const I=require('../../functions/identity-domain.cjs'),D=require('../functions/domain.cjs');
function fixture(){
 const db=new MemoryDB(),stamp=Date.parse('2026-11-14T10:00:00+08:00');let roll=.99,onAuth=()=>{};
 const profileId='alice-profile',authUid=I.profileUid(profileId);
 db.data.set('users/'+profileId,{accountId:'alice',name:'Alice',role:'member'});
 db.data.set('ops_identity_credentials/'+profileId,{authUid,accountId:'alice',sessionVersion:1,disabled:false});
 db.data.set('ops_identity_state/global',{ready:true,farmReady:true});
 db.data.set('groups/A',{members:['alice'],farmVillageVisibility:'closed'});
 db.data.set('groups/A/users/alice',{farm:{coins:10000,hens:1,hensState:[{id:'h',breed:'hen',laidAt:stamp}],poultryVersion:2,readyEggs:{hen:3,silkie:0,bresse:0,onagadori:0},eggsReady:3,warehouseLimit:100,cleanliness:20,coopLevel:3,equippedWeapon:'club'}});
 const reads=[],snapshot=db.snapshot.bind(db);db.snapshot=path=>{reads.push(path);return snapshot(path);};
 const service=createService({db,auth:{getUser:async()=>{onAuth();return{disabled:false};}},now:()=>stamp,privateIdentityEnabled:()=>true,farmBackendEnabled:()=>true,farmRandom:()=>roll});
 const request=(action,p={})=>({auth:{uid:authUid,token:{nexusProfileId:profileId,nexusAccountId:'alice',nexusSessionVersion:1,photoAccountId:'alice',photoGroupId:'A'}},data:{groupId:'A',action,requestId:crypto.randomUUID(),...p}});
 return{db,reads,service,request,stamp,roll:value=>roll=value,onAuth:callback=>onAuth=callback,farm:()=>db.data.get('groups/A/users/alice').farm,sessionKey:'ops_farm_active/'+D.hash(profileId+':A')};
}
test('combined clear harvest atomically awards eggs and one daily operation; replay never awards twice',async()=>{
 const f=fixture(),request=f.request('homeEncounter',{collectWhenClear:true,coins:999999,targetAccountId:'outsider',targetGroupId:'outside'});
 const response=await f.service.farmTransaction(request);assert.equal(response.result.harvest.total,3);assert.equal(response.result.kind,null);
 const farm=structuredClone(f.farm());assert.equal(farm.inventoryEggs,3);assert.equal(farm.eggsReady,0);assert.equal(farm.coins,10000);assert.equal(farm.reportHarvestedEggs,3);
 const replay=await f.service.farmTransaction(request);assert.equal(replay.replayed,true);assert.deepEqual(f.farm(),farm);
 const events=[...f.db.data].filter(([key])=>key.startsWith('ops_verified_farm_events/')).map(([,row])=>row);
 assert.equal(events.length,1);assert.equal(events[0].type,'COLLECT_EGG_ACTION');assert.equal(events[0].collected,3);
 const progress=[...f.db.data].find(([key])=>key.startsWith('ops_daily_days/'))[1];assert.equal(progress.progress.COLLECT_EGG_ACTION,1);
 assert.equal(f.db.data.get(f.sessionKey).harvested,true);
 await assert.rejects(f.service.farmTransaction(f.request('homeEncounter',{collectWhenClear:true})),{code:'failed-precondition'});
 await assert.rejects(f.service.farmTransaction({...request,data:{...request.data,collectWhenClear:false}}),{code:'already-exists'});
});
test('two-device distinct requests cannot collect the same eggs twice',async()=>{
 const f=fixture(),results=await Promise.allSettled([f.service.farmTransaction(f.request('homeEncounter',{collectWhenClear:true})),f.service.farmTransaction(f.request('homeEncounter',{collectWhenClear:true}))]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(f.farm().inventoryEggs,3);
});
test('monster challenge blocks collection, preserves its session and does not increment harvest progress',async()=>{
 const f=fixture();f.roll(0);const request=f.request('homeEncounter',{collectWhenClear:true});
 const response=await f.service.farmTransaction(request);assert.equal(response.result.kind,'gorilla');assert.ok(response.result.challenge.id);assert.equal(response.result.harvest,undefined);
 const again=await f.service.farmTransaction(f.request('homeEncounter',{collectWhenClear:true}));assert.equal(again.result.challenge.id,response.result.challenge.id);
 assert.equal(f.farm().eggsReady,3);assert.equal(f.farm().inventoryEggs,undefined);assert.equal([...f.db.data.keys()].some(key=>key.startsWith('ops_verified_farm_events/')),false);
});
test('empty, full and partial warehouse handling retain existing collection rules',async()=>{
 for(const empty of [true,false]){
  const f=fixture();if(empty){f.farm().readyEggs.hen=0;f.farm().eggsReady=0;}
  // 既有規則以正整數容量為準，使用已滿的有效倉庫測試。
  if(!empty){f.farm().warehouseLimit=1;f.farm().inventoryEggs=1;}
  const before=structuredClone(f.farm());await assert.rejects(f.service.farmTransaction(f.request('homeEncounter',{collectWhenClear:true})),{code:'failed-precondition'});
  assert.deepEqual(f.farm(),before);assert.equal([...f.db.data.keys()].some(key=>key.startsWith('ops_verified_farm_events/')),false);
 }
 const f=fixture();f.farm().warehouseLimit=2;const response=await f.service.farmTransaction(f.request('homeEncounter',{collectWhenClear:true}));
 assert.equal(response.result.harvest.total,2);assert.equal(response.result.harvest.remaining,1);assert.equal(f.farm().eggsReady,1);
});
test('pending victory is resolved separately so victory and harvest each keep their verified event',async()=>{
 const f=fixture();f.db.data.set(f.sessionKey,{id:'pending-win',kind:'gorilla',health:0,startedAt:f.stamp-5000,deadline:f.stamp+10000,lastAttackAt:f.stamp-1000,targetGroupId:'A',targetAccountId:'alice',attacks:{melee:40,ranged:0}});
 const response=await f.service.farmTransaction(f.request('homeEncounter',{collectWhenClear:true}));assert.equal(response.result.result.outcome,'win');assert.equal(response.result.harvest,undefined);
 await f.service.farmTransaction(f.request('collectEggs'));
 const events=[...f.db.data].filter(([key])=>key.startsWith('ops_verified_farm_events/')).map(([,row])=>row.type).sort();assert.deepEqual(events,['COLLECT_EGG_ACTION','DEFEAT_MONSTER']);assert.equal(f.farm().gorillaFangs,1);assert.equal(f.farm().inventoryEggs,3);
});
test('expired battle keeps its original loss and cannot collect eggs cleared by the monster',async()=>{
 const f=fixture();f.db.data.set(f.sessionKey,{id:'expired-dragon',kind:'dragon',health:600,startedAt:f.stamp-70000,deadline:f.stamp-10000,targetGroupId:'A',targetAccountId:'alice',attacks:{melee:0,ranged:0}});
 const response=await f.service.farmTransaction(f.request('homeEncounter',{collectWhenClear:true}));assert.equal(response.result.result.outcome,'loss');assert.equal(response.result.harvest,undefined);assert.equal(f.farm().coins,9900);assert.equal(f.farm().eggsReady,0);
});
test('failed commit can retry the same receipt without losing eggs or duplicating progress',async()=>{
 const f=fixture(),request=f.request('homeEncounter',{collectWhenClear:true});f.db.failAward=true;
 await assert.rejects(f.service.farmTransaction(request),/simulated/);assert.equal(f.farm().eggsReady,3);assert.equal([...f.db.data.keys()].some(key=>key.startsWith('ops_verified_farm_events/')),false);
 await f.service.farmTransaction(request);await f.service.farmTransaction(request);assert.equal(f.farm().inventoryEggs,3);
});
test('credential revocation after preflight is still detected inside the transaction',async()=>{
 const f=fixture();f.onAuth(()=>f.db.data.get('ops_identity_credentials/alice-profile').sessionVersion++);
 await assert.rejects(f.service.farmTransaction(f.request('homeEncounter',{collectWhenClear:true})),{code:'unauthenticated'});assert.equal(f.farm().eggsReady,3);
});
test('combined harvest uses fewer reads and matches the old two-call farm result',async()=>{
 const old=fixture(),combined=fixture();await old.service.farmTransaction(old.request('homeEncounter'));await old.service.farmTransaction(old.request('collectEggs'));
 await combined.service.farmTransaction(combined.request('homeEncounter',{collectWhenClear:true}));
 assert.deepEqual(combined.farm(),old.farm());assert.ok(combined.reads.length<old.reads.length);
 assert.equal(combined.reads.filter(path=>path==='users/alice-profile').length,2,'前置與交易內各一次，不跨權限階段快取');
 assert.equal(combined.reads.filter(path=>path==='groups/A/users/alice').length,1);
 console.log('isolated harvest document reads:',JSON.stringify({twoCalls:old.reads.length,combinedCall:combined.reads.length}));
});
