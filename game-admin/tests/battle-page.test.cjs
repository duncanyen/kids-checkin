const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('./memory-db.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs'),D=require('../functions/domain.cjs');
const {changeBattlePage}=require('../functions/battle-page.cjs');
function fixture(){
 const db=new MemoryDB();let stamp=Date.now(),roll=0;
 const farm={lastLayTime:stamp,coins:10000,hens:1,hensState:[{id:'h',breed:'hen',laidAt:stamp}],poultryVersion:2,readyEggs:{hen:3,silkie:0,bresse:0,onagadori:0},eggsReady:3,warehouseLimit:100,coopLevel:3,cleanliness:30,combatKills:{wolf:0,tiger:0},ironhammer:1,equippedWeapon:'ironhammer'};
 db.data.set('groups/A',{members:['alice','bob'],farmVillageVisibility:'public'});
 for(const who of ['alice','bob'])db.data.set('groups/A/users/'+who,{farm:structuredClone(farm)});
 const actor={uid:'p',groupId:'A',accountId:'alice'};
 const service=createFarmTransactions({db,player:async()=>actor,now:()=>stamp,random:()=>roll,enabled:()=>true});
 const req=(action,page,body={},requestId=crypto.randomUUID())=>({data:{action,requestId,battlePageId:page,combatProtocol:4,...(action==='battleAttack'&&db.data.get(key)?.combatVersion===2?{combatVersion:2,damageVersion:4,firstHit:db.data.get(key).attacks[body.mode]||0}:{}),...body}});
 const api=(action,page,body={},id)=>service.handle(req(action,page,body,id));
 const key='ops_farm_active/'+D.hash('p:A');
 return{db,api,req,service,key,farm:()=>db.data.get('groups/A/users/alice').farm,clock:n=>stamp+=n,roll:n=>roll=n};
}
test('new page discards unfinished/zero-health/expired battles without rewards, losses, eggs or task events',async()=>{
 for(const old of [{health:500,deadline:Date.now()+60000},{health:0,lastAttackAt:Date.now(),deadline:Date.now()+60000},{health:500,deadline:1}]){
  const f=fixture();f.db.data.set(f.key,{id:'old-battle',kind:'gorilla',ownerPageId:'old-page-123',targetGroupId:'A',targetAccountId:'bob',...old});
  const own=structuredClone(f.farm()),target=structuredClone(f.db.data.get('groups/A/users/bob'));
  await f.api('beginBattlePage','new-page-123');await assert.rejects(f.api('battleSettle','new-page-123'),{code:'failed-precondition'});assert.equal(f.db.data.get(f.key).kind,null);assert.equal(f.db.data.get(f.key).ownerPageId,'new-page-123');assert.deepEqual(f.farm(),own);assert.deepEqual(f.db.data.get('groups/A/users/bob'),target);
  await assert.rejects(f.api('battleSettle','old-page-123',{battleId:'old-battle'}),{code:'failed-precondition'});
  await assert.rejects(f.api('battleSettle','new-page-123',{battleId:'old-battle'}),{code:'failed-precondition'});
  assert.equal((await f.db.collection('ops_verified_farm_events').get()).size,0);
  const next=(await f.api('homeEncounter','new-page-123')).result;assert.equal(next.kind,'gorilla');assert.notEqual(next.challenge.id,'old-battle');assert.equal(next.challenge.health,4000);
 }
});
test('close request is idempotent; stale close/attack cannot cancel a new page; same-page completed wins remain valid',async()=>{
 const f=fixture();await f.api('beginBattlePage','first-page-123');const battle=(await f.api('homeEncounter','first-page-123')).result.challenge;
 const close=f.req('abandonBattlePage','first-page-123');await f.service.handle(close);await f.service.handle(close);assert.equal(f.db.data.get(f.key).pageClosed,true);
 await assert.rejects(f.api('homeEncounter','first-page-123'),{code:'failed-precondition'});
 await f.api('beginBattlePage','second-page-123');const fresh=(await f.api('homeEncounter','second-page-123')).result.challenge;
 await f.service.handle(close);assert.equal(f.db.data.get(f.key).id,fresh.id);
 await assert.rejects(f.api('abandonBattlePage','first-page-123'),{code:'failed-precondition'});
 await assert.rejects(f.api('battleAttack','first-page-123',{battleId:fresh.id,mode:'melee',count:20}),{code:'failed-precondition'});
 f.clock(1000);await f.api('battleAttack','second-page-123',{battleId:fresh.id,mode:'melee',count:22});const won=(await f.api('battleSettle','second-page-123',{battleId:fresh.id})).result;
 assert.equal(won.outcome,'win');assert.equal(f.farm().gorillaFangs,1);
 await f.api('beginBattlePage','third-page-123');assert.equal(f.farm().gorillaFangs,1);assert.equal((await f.db.collection('ops_verified_farm_events').get()).size,1);
 assert.notEqual(battle.id,fresh.id);
});
test('milestone cancellation restores only the consumed threshold; real kill/garden progress is retained',()=>{
 for(const [kind,milestone,previous]of [['giant',100,50],['cobra',200,100],['mole',60,30]]){
  const farm={combatKills:{wolf:200,tiger:20},gardenCatchCount:75,[kind+'LastMilestone']:milestone,[kind+'Challenge']:{id:'pending',milestone}};
  const result=changeBattlePage({farm,session:{id:'pending',kind,milestone,previousMilestone:previous},pageId:'new-page-123',stamp:10});
  assert.deepEqual(result.patch,{['farm.'+kind+'Challenge']:null,['farm.'+kind+'LastMilestone']:previous});assert.equal(farm.gardenCatchCount,75);assert.equal(farm.combatKills.wolf,200);
 }
});
test('already committed economic receipts replay across pages without duplicating inventory',async()=>{
 const f=fixture();f.roll(.99);await f.api('beginBattlePage','first-page-123');await f.api('homeEncounter','first-page-123');const receipt=crypto.randomUUID();
 const first=await f.api('collectEggs','first-page-123',{},receipt);assert.equal(first.result.total,3);
 await f.api('beginBattlePage','second-page-123');const replay=await f.api('collectEggs','second-page-123',{},receipt);assert.equal(replay.replayed,true);assert.equal(f.farm().inventoryEggs,3);
});
