const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('./memory-db.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs'),D=require('../functions/domain.cjs'),E=require('../functions/encounters.cjs'),{CONFIG}=require('../functions/farm-combat.cjs');
async function fixture(kind,{melee='ironhammer',bow='paladinbow',protocol=4}={}){
 const C=await import('../../js/farm/combat-rules.js'),M=await import('../../js/farm/combat-damage.js');
 const db=new MemoryDB();let stamp=Date.parse('2026-11-24T12:00:00+08:00');const actor={uid:'combat-test',accountId:'alice',groupId:'A'},pageId=crypto.randomUUID();
 const farm={coins:1000,hens:1,hensState:[{id:'h',breed:'hen',laidAt:stamp}],poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,lastLayTime:stamp,warehouseLimit:100,coopLevel:3,cleanliness:0,combatKills:{wolf:1},gardenCatchCount:1,equippedWeapon:melee,equippedBow:bow,[melee]:1,[bow]:1};
 db.data.set('groups/A',{members:['alice','bob'],farmVillageVisibility:'public'});for(const id of ['alice','bob'])db.data.set('groups/A/users/'+id,{farm:structuredClone(farm)});
 const monsters=structuredClone(E.DEFAULTS);for(const value of Object.values(monsters))value.enabled=false;monsters[kind].enabled=true;monsters[kind].visit={enabled:true,minLevel:1,rate:100};if(['mole','cobra','giant'].includes(kind))monsters[kind].interval=1;
 db.data.set('ops_game_config/encounters',{monsters,revision:1});
 const api=createFarmTransactions({db,player:async()=>actor,now:()=>stamp,random:()=>.99,enabled:()=>true});
 const req=(action,data={})=>({auth:{uid:actor.uid},data:{action,battlePageId:pageId,requestId:crypto.randomUUID(),...(data.combatVersion?{damageVersion:4}:{}),...data}});
 await api.handle(req('beginBattlePage',{combatProtocol:protocol}));
 const key='ops_farm_active/'+D.hash(actor.uid+':A'),own=()=>db.data.get('groups/A/users/alice').farm;
 return{C,M,db,api,req,key,own,advance:ms=>stamp+=ms,start:async()=> (await api.handle(req('visitEncounter',{targetGroupId:'A',targetAccountId:'bob'}))).result.challenge};
}
test('every new monster uses requested HP and original total/arrival durations',async()=>{
 const expected={wolf:[300,60000,0],tiger:[400,50000,0],eagle:[800,60000,10000],dragon:[1600,60000,10000],hornet:[2400,50000,10000],gorilla:[4000,40000,10000],mole:[4000,60000,0],cobra:[6400,50000,8000],giant:[12000,70000,7000]};
 for(const [kind,[hp,duration,arrival]]of Object.entries(expected)){
  const f=await fixture(kind),battle=await f.start();assert.equal(battle.kind,kind);assert.equal(battle.health,hp);assert.equal(battle.maxHealth,hp);assert.equal(battle.combatVersion,2);assert.equal(CONFIG[kind].health,f.C.ENEMY_HEALTH[kind]);assert.equal(battle.deadline-battle.startedAt,duration);assert.equal(battle.approachEndsAt-battle.startedAt,arrival);assert.match(battle.damageSeed,/^[a-f0-9]{32}$/);
 }
});
test('all eight weapon sequences include +/-10 endpoints and match batching/replays without client RNG',async()=>{
 const C=await import('../../js/farm/combat-rules.js'),M=await import('../../js/farm/combat-damage.js');
 for(const [key,base]of Object.entries(C.WEAPON_ATTACK)){
  const ranged=!!C.WEAPONS_CONFIG[key].ranged,kind=ranged?'dragon':'gorilla',mode=ranged?'ranged':'melee',farm={equippedWeapon:key,equippedBow:key,[key]:1},battle=M.makeCombatSnapshot(farm,kind,'range-'+key);battle.criticalRate={melee:0,ranged:0};const values=Array.from({length:2000},(_,index)=>M.hitDamage(battle,mode,index));
  assert.equal(Math.min(...values),base-10,key);assert.equal(Math.max(...values),base+10,key);assert.equal(new Set(values).size,21,key);assert.equal(M.batchDamage(battle,mode,0,31),values.slice(0,31).reduce((a,b)=>a+b));assert.equal(M.batchDamage(battle,mode,0,12)+M.batchDamage(battle,mode,12,19),M.batchDamage(battle,mode,0,31));const copy=structuredClone(battle);assert.deepEqual(values,values.map((_,index)=>M.hitDamage(copy,mode,index)));
 }
});
test('server ignores forged damage/seed, validates hit sequence, caps rate and replays original batch once',async()=>{
 const f=await fixture('gorilla'),battle=await f.start();f.advance(battle.approachEndsAt-battle.startedAt+1000);
 const attack=f.req('battleAttack',{battleId:battle.id,mode:'melee',count:4,firstHit:0,combatVersion:2,damageVersion:4,damage:999999,damageSeed:'forged'}),expected=battle.health-f.M.batchDamage(battle,'melee',0,4);
 const first=await f.api.handle(attack),replay=await f.api.handle(attack);assert.equal(first.result.health,expected);assert.equal(replay.result.health,expected);assert.equal(f.db.data.get(f.key).attacks.melee,4);
 for(const firstHit of [0,3,5,100])await assert.rejects(f.api.handle(f.req('battleAttack',{battleId:battle.id,mode:'melee',count:1,firstHit,combatVersion:2,damageVersion:4})),/戰鬥進度已更新/);
 await assert.rejects(f.api.handle(f.req('battleAttack',{battleId:battle.id,mode:'melee',count:1})),/戰鬥已更新/);
 await assert.rejects(f.api.handle(f.req('battleAttack',{battleId:battle.id,mode:'melee',count:1000,firstHit:4,combatVersion:2,damageVersion:4})),/攻擊過於密集/);
 assert.equal(f.db.data.get(f.key).health,expected);
});
test('melee and bow sequences stay separate; changed equipment cannot apply the wrong weapon damage',async()=>{
 const f=await fixture('giant'),battle=await f.start();f.advance(battle.approachEndsAt-battle.startedAt+2000);
 for(const [mode,count]of [['melee',3],['ranged',2]])await f.api.handle(f.req('battleAttack',{battleId:battle.id,mode,count,combatVersion:2,damageVersion:4,firstHit:0}));
 assert.equal(f.db.data.get(f.key).health,battle.health-f.M.batchDamage(battle,'melee',0,3)-f.M.batchDamage(battle,'ranged',0,2));
 f.own().katana=1;f.own().equippedWeapon='katana';await assert.rejects(f.api.handle(f.req('battleAttack',{battleId:battle.id,mode:'melee',count:1,firstHit:3,combatVersion:2,damageVersion:4})),/裝備已變更/);
});
test('variable-damage final hit grants one original loot/event/ranking result, even after repeated settlement',async()=>{
 for(const kind of Object.keys(CONFIG)){
  const f=await fixture(kind),battle=await f.start(),mode=['dragon','eagle','hornet'].includes(kind)?'ranged':'melee';let count=0,sum=0;while(sum<battle.health)sum+=f.M.hitDamage(battle,mode,count++);f.advance(battle.approachEndsAt-battle.startedAt+6000);
  if(count>1){const partial=await f.api.handle(f.req('battleAttack',{battleId:battle.id,mode,count:count-1,firstHit:0,combatVersion:2,damageVersion:4}));assert.ok(partial.result.health>0);await assert.rejects(f.api.handle(f.req('battleSettle',{battleId:battle.id})),/戰鬥尚未結束/);}
  await f.api.handle(f.req('battleAttack',{battleId:battle.id,mode,count:1,firstHit:count-1,combatVersion:2,damageVersion:4}));
  const request=f.req('battleSettle',{battleId:battle.id}),first=await f.api.handle(request),again=await f.api.handle(request);assert.equal(first.result.outcome,'win');assert.deepEqual(first.result,again.result);assert.equal(f.own()[CONFIG[kind].item],1);assert.equal(f.own().monsterKills20261123,1);assert.equal((await f.db.collection('ops_verified_farm_events').get()).size,1);
 }
});
test('old pages receive a reload instruction before spawning a new incompatible fight',async()=>{
 for(const protocol of [0,2]){const f=await fixture('gorilla',{protocol});await assert.rejects(f.start(),/戰鬥已更新/);assert.equal(f.db.data.get(f.key).kind,null);assert.equal(f.own().coins,1000);}
});
