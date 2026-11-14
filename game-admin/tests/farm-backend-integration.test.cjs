const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('./memory-db.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs'),{createDailyChallenges}=require('../functions/daily-challenges.cjs');
function setup(){
 const db=new MemoryDB();let stamp=Date.parse('2026-11-14T10:00:00+08:00'),roll=.99;
 const farm={coins:10000,hens:1,hensState:[{id:'h',breed:'hen',laidAt:stamp,isSick:false}],poultryVersion:2,readyEggs:{hen:3,silkie:0,bresse:0,onagadori:0},eggsReady:3,warehouseLimit:100,cleanliness:40,coopLevel:3};
 db.data.set('groups/A',{members:['alice','bob'],farmVillageVisibility:'public'});
 for(const id of ['alice','bob'])db.data.set('groups/A/users/'+id,{farm:structuredClone(farm),other:'keep'});
 const player=async r=>{assert.equal(r.auth.uid,'profile');return{uid:'profile',accountId:'alice',groupId:'A'};};
 const daily=createDailyChallenges({db,now:()=>stamp,player,playerSession:player,throttle:async()=>{},trustedReady:async()=>true});
 const api=createFarmTransactions({db,player,now:()=>stamp,random:()=>roll,enabled:()=>true,prepareProgress:daily.prepareProgress});
 const req=(action,p={})=>({auth:{uid:'profile'},data:{groupId:'A',action,requestId:crypto.randomUUID(),...p}});
 return{db,api,daily,req,clock:ms=>stamp+=ms,roll:n=>roll=n,farm:()=>db.data.get('groups/A/users/alice').farm,status:async()=>(await daily.handle(req('status'))).challenges.mission};
}
test('three real harvests and three effective cleanings update progress atomically and idempotently',async()=>{
 const f=setup();for(let i=0;i<3;i++){
  Object.assign(f.farm(),{readyEggs:{hen:2,silkie:0,bresse:0,onagadori:0},eggsReady:2});await f.api.handle(f.req('homeEncounter'));const req=f.req('collectEggs');await Promise.all([f.api.handle(req),f.api.handle(req)]);
  const ref=f.db.data.get('groups/A/users/bob');ref.farm.cleanliness=30;await f.api.handle(f.req('helpClean',{targetGroupId:'A',targetAccountId:'bob'}));
 }
 const mission=await f.status();assert.equal(mission.tasks.find(t=>t.type==='COLLECT_EGG_ACTION').count,3);assert.equal(mission.tasks.find(t=>t.type==='HELP_CLEAN_OTHER').count,3);assert.equal(mission.canClaim,false);
 f.farm().readyEggs.hen=1;f.farm().eggsReady=1;await f.api.handle(f.req('homeEncounter'));f.db.failAward=true;const req=f.req('collectEggs');await assert.rejects(f.api.handle(req),/simulated/);assert.equal(f.farm().eggsReady,1);
});
test('forged win, unknown battle, excessive attacks, equipped weapon and deadline are server validated',async()=>{
 const f=setup();f.roll(0);const start=(await f.api.handle(f.req('visitEncounter',{targetGroupId:'A',targetAccountId:'bob'}))).result;
 assert.equal(start.kind,'gorilla');const battleId=start.challenge.id;
 await assert.rejects(f.api.handle(f.req('battleSettle',{battleId,outcome:'win'})),{code:'failed-precondition'});
 await assert.rejects(f.api.handle(f.req('battleAttack',{battleId:'fake',mode:'melee',count:1,damage:999999})),{code:'failed-precondition'});
 await assert.rejects(f.api.handle(f.req('battleAttack',{battleId,mode:'ranged',count:1})),{code:'failed-precondition'});
 await assert.rejects(f.api.handle(f.req('battleAttack',{battleId,mode:'melee',count:1000})),{code:'resource-exhausted'});
 f.clock(50000);const result=(await f.api.handle(f.req('battleSettle',{battleId,outcome:'win'}))).result;assert.equal(result.outcome,'loss');assert.equal(f.farm().coins,9900);assert.equal((await f.status()).tasks.find(t=>t.type==='DEFEAT_MONSTER').count,0);
});
test('server-computed victory generates one mission operation even with late settlement and concurrent retries',async()=>{
 const f=setup();f.farm().ironhammer=1;f.farm().equippedWeapon='ironhammer';f.roll(0);
 const start=(await f.api.handle(f.req('visitEncounter',{targetGroupId:'A',targetAccountId:'bob'}))).result;f.clock(1000);
 await f.api.handle(f.req('battleAttack',{battleId:start.challenge.id,mode:'melee',count:20}));f.clock(50000);
 const req=f.req('battleSettle',{battleId:start.challenge.id});const results=await Promise.all([f.api.handle(req),f.api.handle(req)]);
 assert.equal(results[0].result.outcome,'win');assert.equal(f.farm().gorillaFangs,1);assert.equal((await f.status()).tasks.find(t=>t.type==='DEFEAT_MONSTER').count,1);
});
test('private village changes cannot trap an unresolved battle or mutate the closed village',async()=>{
 const f=setup();f.db.data.set('groups/B',{members:['bob'],farmVillageVisibility:'public'});f.db.data.set('groups/B/users/bob',{farm:{...structuredClone(f.farm()),eggsReady:3}});f.roll(0);
 const start=(await f.api.handle(f.req('visitEncounter',{targetGroupId:'B',targetAccountId:'bob'}))).result;
 f.db.data.get('groups/B').farmVillageVisibility='closed';f.clock(50000);
 await f.api.handle(f.req('battleSettle',{battleId:start.challenge.id}));assert.equal(f.db.data.get('groups/B/users/bob').farm.eggsReady,3);
});
test('welcome mail awards once across different request IDs; deletion never resets the claim receipt',async()=>{
 const f=setup();await f.api.handle(f.req('ensureWelcome'));await Promise.all([f.api.handle(f.req('claimWelcome')),f.api.handle(f.req('claimWelcome'))]);
 assert.equal(f.farm().coins,11000);assert.equal(f.farm().worms,8);await f.api.handle(f.req('deleteMail',{ids:['welcome-v1']}));await f.api.handle(f.req('ensureWelcome'));
 await assert.rejects(f.api.handle(f.req('claimWelcome')),{code:'not-found'});assert.equal(f.farm().coins,11000);
});
test('direct collection and stealing cannot bypass the server encounter check',async()=>{
 const f=setup();await assert.rejects(f.api.handle(f.req('collectEggs')),{code:'failed-precondition'});await assert.rejects(f.api.handle(f.req('stealEgg',{targetGroupId:'A',targetAccountId:'bob'})),{code:'failed-precondition'});
 await f.api.handle(f.req('homeEncounter'));await f.api.handle(f.req('collectEggs'));
 await f.api.handle(f.req('visitEncounter',{targetGroupId:'A',targetAccountId:'bob'}));await f.api.handle(f.req('stealEgg',{targetGroupId:'A',targetAccountId:'bob'}));assert.equal(f.farm().inventoryEggs,4);
});
test('all eight monster settlements keep canonical rewards, penalties and one verified victory',async()=>{
 const D=require('../functions/domain.cjs'),{CONFIG}=require('../functions/farm-combat.cjs');
 for(const [kind,config]of Object.entries(CONFIG)){
  const f=setup(),id='server-'+kind,started=Date.parse('2026-11-14T10:00:00+08:00');
  const challenge={id,kind,startedAt:started,deadline:started+config.durationMs,groupId:'A',targetGroupId:'A',targetAccountId:'bob',health:config.health,attacks:{melee:0,ranged:0},milestone:100};
  f.db.data.set('ops_farm_active/'+D.hash('profile:A'),challenge);
  if(['giant','cobra','mole'].includes(kind))f.farm()[kind+'Challenge']=challenge;
  Object.assign(f.farm(),{battleaxe:1,equippedWeapon:'battleaxe',shortbow:1,equippedBow:'shortbow'});
  const models=await import('../../js/farm/combat-rules.js'),mode=['eagle','dragon'].includes(kind)?'ranged':'melee',weapon=models.WEAPONS_CONFIG[mode==='ranged'?'shortbow':'battleaxe'],hits=Math.ceil(config.health/models.weaponDamage(weapon,kind));
  f.clock(Math.ceil(hits/(mode==='ranged'?10:20))*1000);
  await f.api.handle(f.req('battleAttack',{battleId:id,mode,count:hits,damage:999999}));
  await f.api.handle(f.req('battleSettle',{battleId:id}));await f.api.handle(f.req('battleSettle',{battleId:id}));
  assert.equal(f.farm()[config.item],1,kind);assert.equal((await f.status()).tasks[2].count,1,kind);
 }
});
test('prototype names and invalid stock cannot corrupt the wallet',async()=>{
 const f=setup(),before=f.farm().coins;
 for(const item of ['constructor','toString','__proto__'])await assert.rejects(f.api.handle(f.req('sellItem',{item,quantity:1})),{code:'invalid-argument'});
 assert.equal(f.farm().coins,before);
});
test('all monster deadlines preserve original coin and egg loss rules and never count a defeat',async()=>{
 const D=require('../functions/domain.cjs'),{CONFIG}=require('../functions/farm-combat.cjs');
 for(const [kind,config]of Object.entries(CONFIG)){
  const f=setup(),id='expired-'+kind,started=Date.parse('2026-11-14T10:00:00+08:00'),challenge={id,kind,startedAt:started,deadline:started+config.durationMs,groupId:'A',targetGroupId:'A',targetAccountId:'bob',health:config.health,attacks:{melee:0,ranged:0},milestone:100};
  f.db.data.set('ops_farm_active/'+D.hash('profile:A'),challenge);if(['giant','cobra','mole'].includes(kind))f.farm()[kind+'Challenge']=challenge;
  f.clock(config.durationMs);const result=(await f.api.handle(f.req('battleSettle',{battleId:id,outcome:'win'}))).result;
  assert.equal(result.outcome,'loss',kind);assert.equal(f.farm().coins,10000-(config.penalty||0),kind);
  assert.equal(f.db.data.get('groups/A/users/bob').farm.eggsReady,kind==='wolf'?2:config.clearEggs?0:3,kind);
  assert.equal((await f.status()).tasks[2].count,0,kind);
 }
});
