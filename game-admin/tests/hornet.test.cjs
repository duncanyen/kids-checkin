const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const E=require('../functions/encounters.cjs'),D=require('../functions/domain.cjs'),{MemoryDB}=require('./memory-db.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs');
function setup(){
 const db=new MemoryDB();let stamp=Date.now(),roll=.99;
 const actor={uid:'profile',accountId:'alice',groupId:'A'},farm={coins:1000,hens:1,hensState:[{id:'h',breed:'hen',laidAt:stamp}],poultryVersion:2,readyEggs:{hen:3,silkie:0,bresse:0,onagadori:0},eggsReady:3,warehouseLimit:100,coopLevel:2,cleanliness:0};
 db.data.set('groups/A',{members:['alice','bob'],farmVillageVisibility:'public'});for(const accountId of ['alice','bob'])db.data.set('groups/A/users/'+accountId,{farm:structuredClone(farm)});
 const api=createFarmTransactions({db,player:async()=>actor,now:()=>stamp,random:()=>roll,enabled:()=>true}),req=(action,p={})=>({auth:{uid:'profile'},data:{action,groupId:'A',requestId:crypto.randomUUID(),...(action==='battleAttack'&&db.data.get('ops_farm_active/'+D.hash('profile:A'))?.combatVersion===2?{combatVersion:2,firstHit:db.data.get('ops_farm_active/'+D.hash('profile:A')).attacks[p.mode]||0}:{}),...p}}),own=()=>db.data.get('groups/A/users/alice').farm;
 const force=()=>{const m=structuredClone(E.DEFAULTS);for(const v of Object.values(m))v.enabled=false;m.hornet.enabled=true;m.hornet.home.rate=m.hornet.visit.rate=100;db.data.set('ops_game_config/encounters',{monsters:m,revision:1});};
 return{db,api,req,own,force,advance:n=>stamp+=n,clear:()=>db.data.delete('ops_farm_active/'+D.hash('profile:A'))};
}
test('hornet defaults are 1/30 from level2 for home/visits, pool retains existing weights and old full allocations remain valid',async()=>{
 for(const place of ['home','visit']){assert.deepEqual(E.DEFAULTS.hornet[place],{enabled:true,minLevel:2,rate:100/30});const policy={monsters:structuredClone(E.DEFAULTS)};for(const v of Object.values(policy.monsters))v.enabled=false;policy.monsters.hornet.enabled=true;assert.equal(E.rollRandom(policy,place,1,()=>0),null);assert.equal(E.rollRandom(policy,place,2,()=>0),'hornet');assert.equal(E.rollRandom(policy,place,2,()=>1/30),null);let count=0;for(let i=0;i<30000;i++)count+=E.rollRandom(policy,place,2,()=>(i+.5)/30000)==='hornet';assert.equal(count,1000);}
 const saved=structuredClone(E.DEFAULTS);delete saved.hornet;for(const v of Object.values(saved))v.enabled=false;saved.eagle.enabled=true;saved.eagle.home.rate=100;saved.eagle.visit.rate=100;
 const merged=E.mergeSaved(saved);assert.equal(merged.monsters.eagle.home.rate,100);assert.equal(merged.monsters.hornet.home.enabled,false);assert.equal(merged.notes.length,2);assert.doesNotThrow(()=>E.validateAll(merged.monsters));
 const f=setup();f.force();const first=(await f.api.handle(f.req('homeEncounter'))).result;assert.equal(first.kind,'hornet');assert.equal(first.challenge.deadline-first.challenge.startedAt,50000);assert.equal(first.challenge.approachEndsAt-first.challenge.startedAt,10000);assert.equal((await f.api.handle(f.req('homeEncounter'))).result.challenge.id,first.challenge.id);
});
test('real farm transactions apply bow-specific hornet damage, grant one honey, price sale at300 and keep victory idempotent',async()=>{
 for(const bow of ['shortbow','huntingbow','paladinbow']){
  const f=setup();f.force();Object.assign(f.own(),{[bow]:1,equippedBow:bow,battleaxe:1,equippedWeapon:'battleaxe'});const battle=(await f.api.handle(f.req('homeEncounter'))).result.challenge;f.advance(4000);
  const M=await import('../../js/farm/combat-damage.js');let hits=0,total=0;while(total<battle.health)total+=M.hitDamage(battle,'ranged',hits++);
  await assert.rejects(f.api.handle(f.req('battleAttack',{battleId:battle.id,mode:'melee',count:1})),/無法攻擊/);
  const partial=(await f.api.handle(f.req('battleAttack',{battleId:battle.id,mode:'ranged',count:hits-1}))).result;assert.ok(partial.health>0);
  const hit=f.req('battleAttack',{battleId:battle.id,mode:'ranged',count:1});assert.equal((await f.api.handle(hit)).result.health,0);await f.api.handle(hit);
  const win=f.req('battleSettle',{battleId:battle.id}),settled=(await f.api.handle(win)).result;assert.equal(settled.outcome,'win');assert.deepEqual(settled.rewards,[{itemId:'honey',quantity:1}]);assert.equal(f.own().honey,1);assert.equal(f.own().coins,1000);await f.api.handle(win);await f.api.handle(f.req('battleSettle',{battleId:battle.id}));assert.equal(f.own().honey,1);
  const events=[...f.db.data.entries()].filter(([path])=>path.startsWith('ops_verified_farm_events/'));assert.equal(events.filter(([,v])=>v.type==='DEFEAT_MONSTER'&&v.monster==='hornet').length,1);
  const sale=f.req('sellItem',{item:'honey',quantity:1,price:999999});await f.api.handle(sale);assert.equal(f.own().coins,1300);assert.equal(f.own().honey,0);await f.api.handle(sale);assert.equal(f.own().coins,1300);
 }
});
test('hornet timeout deducts only actor coins capped at100, never eggs/honey or target coins; no victory event on defeat',async()=>{
 for(const coins of [1000,50,0]){const f=setup();f.force();f.own().coins=coins;const targetBefore=structuredClone(f.db.data.get('groups/A/users/bob').farm),battle=(await f.api.handle(f.req('visitEncounter',{targetGroupId:'A',targetAccountId:'bob'}))).result.challenge;
  await assert.rejects(f.api.handle(f.req('battleSettle',{battleId:battle.id})),/尚未結束/);f.advance(50000);
  const req=f.req('battleSettle',{battleId:battle.id,outcome:'win'}),result=(await f.api.handle(req)).result;assert.equal(result.outcome,'loss');assert.equal(result.coinsLost,Math.min(coins,100));assert.equal(f.own().coins,Math.max(0,coins-100));assert.equal(f.own().honey,undefined);assert.equal(f.own().eggsReady,3);assert.deepEqual(f.db.data.get('groups/A/users/bob').farm,targetBefore);await f.api.handle(req);assert.equal(f.own().coins,Math.max(0,coins-100));assert.equal([...f.db.data.keys()].filter(k=>k.startsWith('ops_verified_farm_events/')).length,0);
 }
});
