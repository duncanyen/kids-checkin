const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('./memory-db.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs'),{createDailyChallenges}=require('../functions/daily-challenges.cjs');
function setup(){
 const db=new MemoryDB();let stamp=Date.parse('2026-11-14T10:00:00+08:00'),roll=.99;
 const farm={coins:10000,hens:1,hensState:[{id:'h',breed:'hen',laidAt:stamp,isSick:false}],poultryVersion:2,readyEggs:{hen:3,silkie:0,bresse:0,onagadori:0},eggsReady:3,warehouseLimit:100,cleanliness:40,coopLevel:3};
 db.data.set('groups/A',{members:['alice','bob'],farmVillageVisibility:'public'});
 for(const id of ['alice','bob'])db.data.set('groups/A/users/'+id,{farm:structuredClone(farm),other:'keep'});
 const player=async r=>{assert.equal(r.auth.uid,'profile');return{uid:'profile',accountId:'alice',groupId:'A'};};
 const daily=createDailyChallenges({db,now:()=>stamp,player,playerSession:player,throttle:async()=>{},trustedReady:async()=>true});
 const api=createFarmTransactions({db,player,now:()=>stamp,random:()=>typeof roll==='function'?roll():roll,enabled:()=>true,prepareProgress:daily.prepareProgress});
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
test('entry welcome preparation is allowed during a battle without granting rewards or bypassing economic locks',async()=>{
 const f=setup();f.roll(0);
 const battle=(await f.api.handle(f.req('visitEncounter',{targetGroupId:'A',targetAccountId:'bob'}))).result.challenge;
 const before=structuredClone(f.farm()),request=f.req('ensureWelcome');
 const response=await f.api.handle(request);assert.equal(response.result.pendingBattle.id,battle.id);
 assert.deepEqual(f.farm(),before);assert.ok(f.db.data.get('groups/A/users/alice/farm_notifications/welcome-v1'));
 const replay=await f.api.handle(request);assert.equal(replay.replayed,true);assert.equal(replay.result.pendingBattle.id,battle.id);
 for(const action of ['claimWelcome','feedPoultry','collectEggs'])await assert.rejects(f.api.handle(f.req(action,{item:'worms',breed:'hen'})),{code:'failed-precondition'});
 assert.deepEqual(f.farm(),before);
 const D=require('../functions/domain.cjs');f.db.data.get('ops_farm_active/'+D.hash('profile:A')).result={outcome:'loss'};
 const current=await f.api.handle(request);assert.equal(current.result.pendingBattle,null,'重送通知收據不恢復已結束的舊戰鬥');
});
test('direct collection and stealing cannot bypass the server encounter check',async()=>{
 const f=setup();await assert.rejects(f.api.handle(f.req('collectEggs')),{code:'failed-precondition'});await assert.rejects(f.api.handle(f.req('stealEgg',{targetGroupId:'A',targetAccountId:'bob'})),{code:'failed-precondition'});
 await f.api.handle(f.req('homeEncounter'));await f.api.handle(f.req('collectEggs'));
 await f.api.handle(f.req('visitEncounter',{targetGroupId:'A',targetAccountId:'bob'}));await f.api.handle(f.req('stealEgg',{targetGroupId:'A',targetAccountId:'bob'}));assert.equal(f.farm().inventoryEggs,4);
});
test('rechecking a cleared visit reuses its permit without rerolling; a new visit still rolls normally',async()=>{
 const f=setup(),target={targetGroupId:'A',targetAccountId:'bob'};
 await f.api.handle(f.req('visitEncounter',target));f.roll(0);
 const recheck=await f.api.handle(f.req('visitEncounter',{...target,reusePermit:true}));assert.equal(recheck.result,null);
 await f.api.handle(f.req('stealEgg',target));assert.equal(f.farm().inventoryEggs,1);assert.equal(f.farm().stolenEggs20261109,1);
 const fresh=await f.api.handle(f.req('visitEncounter',target));assert.equal(fresh.result.kind,'gorilla');
 await assert.rejects(f.api.handle(f.req('stealEgg',target)),{code:'failed-precondition'});
});
test('combined visit confirmation and theft commits once with the existing scoring, inventory and cooldown rules',async()=>{
 const f=setup(),target={targetGroupId:'A',targetAccountId:'bob'};await f.api.handle(f.req('visitEncounter',target));
 const request=f.req('visitEncounter',{...target,reusePermit:true,stealWhenClear:true,success:true,quantity:999});
 const response=await f.api.handle(request);await f.api.handle(request);
 assert.equal(response.result.steal.success,true);assert.equal(f.farm().inventoryEggs,1);assert.equal(f.farm().stolenEggs20261109,1);assert.equal(f.farm().reportStolenEggs,1);
 assert.equal(f.db.data.get('groups/A/users/bob').farm.eggsReady,2);
 assert.equal(response.result.steal.blockedUntil,Date.parse('2026-11-14T11:00:00+08:00'));
 await assert.rejects(f.api.handle(f.req('visitEncounter',{...target,reusePermit:true,stealWhenClear:true})),{code:'failed-precondition'});
});
test('combined theft never bypasses an active or expired monster battle',async()=>{
 const f=setup(),target={targetGroupId:'A',targetAccountId:'bob'};f.roll(0);
 const request=()=>f.req('visitEncounter',{...target,reusePermit:true,stealWhenClear:true});
 const started=await f.api.handle(request());assert.equal(started.result.kind,'gorilla');assert.equal(started.result.steal,undefined);assert.equal(f.farm().inventoryEggs,undefined);
 const pending=await f.api.handle(request());assert.equal(pending.result.challenge.id,started.result.challenge.id);assert.equal(pending.result.steal,undefined);
 f.clock(50000);const expired=await f.api.handle(request());assert.equal(expired.result.result.outcome,'loss');assert.equal(expired.result.steal,undefined);assert.equal(f.farm().inventoryEggs,undefined);assert.equal(f.db.data.get('groups/A/users/bob').farm.eggsReady,0);
});
test('combined theft keeps guard-dog randomness independent from the preceding monster rolls',async()=>{
 const f=setup(),stamp=Date.parse('2026-11-14T10:00:00+08:00');
 f.db.data.get('groups/A/users/bob').farm.guardDogs=[{id:'guard',breedId:'pyrenees',days:1,startedAt:stamp-1000,expiresAt:stamp+86400000}];
 let index=0;f.roll(()=>index++===18?0:.99);
 const response=await f.api.handle(f.req('visitEncounter',{targetGroupId:'A',targetAccountId:'bob',stealWhenClear:true}));
 assert.equal(response.result.steal.success,false);assert.equal(response.result.steal.blockMs,4*3600000);assert.equal(f.farm().inventoryEggs,undefined);assert.equal(f.farm().reportStolenEggs,undefined);assert.equal(f.db.data.get('groups/A/users/bob').farm.eggsReady,3);
});
test('combined theft preserves private access, warehouse capacity and atomic retry protection',async()=>{
 const target={targetGroupId:'A',targetAccountId:'bob',reusePermit:true,stealWhenClear:true},f=setup();
 await assert.rejects(f.api.handle(f.req('visitEncounter',{...target,stealWhenClear:'true'})),{code:'invalid-argument'});
 await f.api.handle(f.req('visitEncounter',{targetGroupId:'A',targetAccountId:'bob'}));
 f.farm().warehouseLimit=1;f.farm().inventoryEggs=1;
 await assert.rejects(f.api.handle(f.req('visitEncounter',target)),{code:'failed-precondition'});assert.equal(f.db.data.get('groups/A/users/bob').farm.eggsReady,3);
 f.farm().warehouseLimit=100;f.farm().inventoryEggs=0;const request=f.req('visitEncounter',target);f.db.failAward=true;
 await assert.rejects(f.api.handle(request),/simulated/);assert.equal(f.farm().inventoryEggs,0);assert.equal(f.db.data.get('groups/A/users/bob').farm.eggsReady,3);
 await f.api.handle(request);await f.api.handle(request);assert.equal(f.farm().inventoryEggs,1);assert.equal(f.db.data.get('groups/A/users/bob').farm.eggsReady,2);
 f.db.data.set('groups/B',{members:['alice'],farmVillageVisibility:'closed'});f.db.data.set('groups/B/users/alice',{farm:structuredClone(f.farm())});
 await assert.rejects(f.api.handle(f.req('visitEncounter',{...target,targetGroupId:'B',targetAccountId:'alice'})),{code:'permission-denied'});
});
test('visit recheck cannot reuse another target permit and expired battles keep their original losses',async()=>{
 const f=setup();f.db.data.set('groups/B',{members:['alice'],farmVillageVisibility:'public'});f.db.data.set('groups/B/users/alice',{farm:structuredClone(f.farm())});
 f.roll(0);const battle=await f.api.handle(f.req('visitEncounter',{targetGroupId:'A',targetAccountId:'bob'}));assert.equal(battle.result.kind,'gorilla');
 const target={targetGroupId:'B',targetAccountId:'alice',reusePermit:true};
 const active=await f.api.handle(f.req('visitEncounter',target));assert.equal(active.result.challenge.targetAccountId,'bob');
 await assert.rejects(f.api.handle(f.req('stealEgg',target)),{code:'failed-precondition'});
 f.clock(50000);const expired=await f.api.handle(f.req('visitEncounter',target));assert.equal(expired.result.result.outcome,'loss');assert.equal(f.db.data.get('groups/A/users/bob').farm.eggsReady,0);assert.equal(f.db.data.get('groups/B/users/alice').farm.eggsReady,3);
 await assert.rejects(f.api.handle(f.req('stealEgg',target)),{code:'failed-precondition'});
 f.roll(.99);await f.api.handle(f.req('visitEncounter',target));await f.api.handle(f.req('stealEgg',target));assert.equal(f.farm().inventoryEggs,1);
});
test('the extended November 15 window increments the existing leaderboard score atomically and replay adds nothing',async()=>{
 const f=setup();f.clock(24*3600000);f.farm().stolenEggs20261109=7;const target={targetGroupId:'A',targetAccountId:'bob'};
 await f.api.handle(f.req('visitEncounter',target));const req=f.req('stealEgg',target);await f.api.handle(req);await f.api.handle(req);
 assert.equal(f.farm().inventoryEggs,1);assert.equal(f.farm().reportStolenEggs,1);assert.equal(f.farm().stolenEggs20261109,8);
});
test('successful theft after the November 16 deadline still updates inventory and lifetime report, not the closed leaderboard',async()=>{
 const f=setup();f.clock(48*3600000);const target={targetGroupId:'A',targetAccountId:'bob'};
 await f.api.handle(f.req('visitEncounter',target));const req=f.req('stealEgg',target);await f.api.handle(req);await f.api.handle(req);
 assert.equal(f.farm().inventoryEggs,1);assert.equal(f.farm().reportStolenEggs,1);assert.equal(f.farm().stolenEggs20261109,undefined);
});
test('same account in another public village is a distinct farm; theft and replay update only the correct farms',async()=>{
 const f=setup(),targetGroupId='B',targetAccountId='alice';
 f.db.data.set('groups/B',{members:['alice'],farmVillageVisibility:'public'});
 const target={...structuredClone(f.farm()),hensState:[{id:'long',breed:'onagadori',laidAt:Date.parse('2026-11-14T10:00:00+08:00')}],readyEggs:{hen:0,silkie:0,bresse:0,onagadori:2},eggsReady:2};
 f.db.data.set('groups/B/users/alice',{farm:target});
 await f.api.handle(f.req('visitEncounter',{targetGroupId,targetAccountId}));
 const request=f.req('stealEgg',{targetGroupId,targetAccountId});await f.api.handle(request);await f.api.handle(request);
 assert.equal(f.farm().onagadoriEggs,1);assert.equal(f.farm().eggsReady,3);assert.equal(f.farm().stolenEggs20261109,1);
 assert.equal(f.db.data.get('groups/B/users/alice').farm.eggsReady,1);assert.equal(f.db.data.get('groups/B/users/alice').farm.onagadoriEggs,undefined);
 assert.equal([...f.db.data.keys()].filter(path=>path.startsWith('groups/B/users/alice/farm_notifications/')).length,1);
 await assert.rejects(f.api.handle(f.req('stealEgg',{targetGroupId,targetAccountId})),{code:'failed-precondition'});
 assert.equal(f.farm().onagadoriEggs,1);
});
test('same-group self theft stays forbidden and cross-group self theft keeps membership and public-village checks',async()=>{
 const f=setup(),before=structuredClone(f.farm());await f.api.handle(f.req('visitEncounter',{targetGroupId:'A',targetAccountId:'alice'}));
 await assert.rejects(f.api.handle(f.req('stealEgg',{targetGroupId:'A',targetAccountId:'alice'})),{code:'invalid-argument'});assert.deepEqual(f.farm(),before);
 f.db.data.set('groups/B',{members:['alice'],farmVillageVisibility:'public'});f.db.data.set('groups/B/users/alice',{farm:structuredClone(before)});
 await f.api.handle(f.req('visitEncounter',{targetGroupId:'B',targetAccountId:'alice'}));
 for(const [group,patch]of [['B',{farmVillageVisibility:'closed'}],['A',{farmVillageVisibility:'closed'}],['B',{members:[]}]]){
  const original=structuredClone(f.db.data.get('groups/'+group));Object.assign(f.db.data.get('groups/'+group),patch);
  await assert.rejects(f.api.handle(f.req('stealEgg',{targetGroupId:'B',targetAccountId:'alice'})),{code:'permission-denied'});f.db.data.set('groups/'+group,original);
 }
 assert.deepEqual(f.farm(),before);assert.equal(f.db.data.get('groups/B/users/alice').farm.eggsReady,3);
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
