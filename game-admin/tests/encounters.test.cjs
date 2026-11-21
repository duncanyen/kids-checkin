const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const E=require('../functions/encounters.cjs'),D=require('../functions/domain.cjs'),{fixture}=require('./fixture.cjs'),{MemoryDB}=require('./memory-db.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs');
const settings=()=>({monsters:structuredClone(E.DEFAULTS),revision:1});
function setup(){
 const db=new MemoryDB(),actor={uid:'profile',accountId:'alice',groupId:'A'};let roll=.99,stamp=Date.now();
 const farm={coins:100,hens:1,hensState:[{id:'h',breed:'hen',laidAt:stamp}],poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,warehouseLimit:100,coopLevel:3,cleanliness:0};
 db.data.set('groups/A',{members:['alice','bob'],farmVillageVisibility:'public'});for(const who of ['alice','bob'])db.data.set('groups/A/users/'+who,{farm:structuredClone(farm)});
 const api=createFarmTransactions({db,player:async()=>actor,now:()=>stamp,random:()=>roll,enabled:()=>true});
 const request=(action,p={})=>({auth:{uid:'profile'},data:{action,groupId:'A',requestId:crypto.randomUUID(),...p}});
 const own=()=>db.data.get('groups/A/users/alice').farm;
 const clear=()=>db.data.delete('ops_farm_active/'+D.hash('profile:A'));
 return{db,api,request,own,clear,roll:v=>roll=v,time:v=>stamp=v};
}
test('encounter defaults preserve exclusive boss rates, sequential tiger/wolf and level gates',async()=>{
 const G=await import('../functions/game/gorilla-rules.js');
 for(const level of [1,2,3,4,5])for(let i=0;i<6000;i++){
  const value=(i+.5)/6000;
  for(const place of ['home','visit']){
   const values=[value,.99,.99];let next=0;const random=()=>values[next++]??.99;
   const actual=E.rollRandom(settings(),place,level,random);
   let legacyNext=0;const roll=(min,max)=>min+Math.floor((values[legacyNext++]??.99)*(max-min+1));
   let expected=place==='home'?G.rollHomeBossEncounter(level,roll):G.rollVisitBossEncounter(level,roll,30);
   if(place==='visit'){if(!expected&&roll(1,30)===1)expected='tiger';if(!expected&&roll(1,10)===1)expected='wolf';}
   assert.equal(actual,expected,`${place} level=${level}, sample=${i}`);
  }
 }
 assert.equal(E.rollRandom(settings(),'visit',1,()=>0),'tiger');
 const draws=[.99,0];assert.equal(E.rollRandom(settings(),'visit',1,()=>draws.shift()),'wolf');
 const s=settings();s.monsters.wolf.visit.rate=0;s.monsters.tiger.visit.rate=0;assert.equal(E.rollRandom(s,'visit',1,()=>0),null);
});
test('encounter validators reject invalid probabilities, level/counter gates and unsafe pooled totals',()=>{
 for(const v of [-1,101,NaN,Infinity,'50'])assert.throws(()=>E.validate('wolf',{...E.DEFAULTS.wolf,visit:{...E.DEFAULTS.wolf.visit,rate:v}}));
 assert.throws(()=>E.validate('wolf',{...E.DEFAULTS.wolf,enabled:'false'}));
 assert.throws(()=>E.validate('wolf',{...E.DEFAULTS.wolf,home:{...E.DEFAULTS.wolf.home,enabled:true}}));
 for(const interval of [0,1.5,1000001])assert.throws(()=>E.validate('mole',{...E.DEFAULTS.mole,interval}));
 for(const minLevel of [0,6,1.5])assert.throws(()=>E.validate('eagle',{...E.DEFAULTS.eagle,home:{...E.DEFAULTS.eagle.home,minLevel}}));
 for(const killTypes of [[],['dragon'],['wolf','wolf']])assert.throws(()=>E.validate('cobra',{...E.DEFAULTS.cobra,killTypes}));
 const s=settings();s.monsters.eagle.home.rate=100;assert.throws(()=>E.validateAll(s.monsters),/合計機率/);
 s.monsters.dragon.enabled=false;s.monsters.gorilla.enabled=false;assert.equal(E.validateAll(s.monsters).eagle.home.rate,100);
});
test('per-monster configuration is privileged, versioned, audited, idempotent and keeps other saved monsters',async()=>{
 const f=await fixture(),config={...structuredClone(E.DEFAULTS.wolf),visit:{enabled:true,minLevel:2,rate:100}};
 await assert.rejects(f.admin('saveEncounterConfig',{monster:'wolf',config,reason:'no',expectedRevision:0},{auth:f.request().auth}),{code:'permission-denied'});
 const requestId=crypto.randomUUID(),payload={monster:'wolf',config,reason:'拜訪狼測試',expectedRevision:0};
 await f.admin('saveEncounterConfig',payload,{data:{action:'saveEncounterConfig',payload,requestId}});
 assert.equal((await f.admin('saveEncounterConfig',payload,{data:{action:'saveEncounterConfig',payload,requestId}})).replayed,true);
 await f.admin('saveEncounterConfig',{monster:'mole',config:{...E.DEFAULTS.mole,interval:7},reason:'地鼠間隔',expectedRevision:1});
 const value=(await f.admin('gameBalance')).encounters;assert.equal(value.monsters.wolf.visit.rate,100);assert.equal(value.monsters.mole.interval,7);assert.deepEqual(value.monsters.tiger,E.DEFAULTS.tiger);
 await assert.rejects(f.admin('saveEncounterConfig',{...payload,expectedRevision:0}),{code:'failed-precondition'});
 const rows=(await f.admin('list',{kind:'audit'})).rows;assert.ok(rows.some(r=>r.action==='saveEncounterConfig'&&r.after?.monster==='wolf'&&r.before.config.visit.rate===10&&r.after.config.visit.rate===100&&r.adminUid&&r.createdAt));
});
test('milestone conditions use configured interval, tracked kill types, player level and per-context switches',()=>{
 const s=settings(),farm={coopLevel:3,combatKills:{wolf:30,tiger:20,eagle:50},gardenCatchCount:30};
 assert.deepEqual(E.rollMilestone(s,farm,'home',()=>.99),{kind:'cobra',milestone:100});
 s.monsters.cobra.enabled=false;assert.deepEqual(E.rollMilestone(s,farm,'home',()=>.99),{kind:'giant',milestone:50});
 s.monsters.giant.enabled=false;assert.deepEqual(E.rollMilestone(s,farm,'home',()=>.99),{kind:'mole',milestone:30});
 s.monsters.mole.interval=7;farm.moleLastMilestone=30;assert.equal(E.milestone('mole',s.monsters.mole,farm,'home'),null);
 farm.gardenCatchCount=35;assert.equal(E.milestone('mole',s.monsters.mole,farm,'home'),35);
 s.monsters.mole.home.rate=50;assert.equal(E.rollMilestone(s,farm,'home',()=>.5),null);assert.equal(E.rollMilestone(s,farm,'home',()=>.4999).milestone,35);
 assert.equal(E.hit(0,()=>0),false);assert.equal(E.hit(100,()=>.999),true);
 s.monsters.mole.home.enabled=false;assert.equal(E.rollMilestone(s,farm,'home',()=>0),null);assert.equal(E.rollMilestone(s,farm,'visit',()=>0).kind,'mole');
 s.monsters.cobra.enabled=true;s.monsters.cobra.killTypes=['eagle'];s.monsters.cobra.interval=10;assert.equal(E.milestone('cobra',s.monsters.cobra,farm,'home'),10);
});
test('fresh entry uses server settings even without legacy thresholds; snapshots/receipts/permits never re-roll',async()=>{
 const f=setup(),s=settings();for(const v of Object.values(s.monsters))v.enabled=false;
 s.monsters.mole={...E.DEFAULTS.mole,interval:2};f.db.data.set('ops_game_config/encounters',s);f.own().gardenCatchCount=2;
 const req=f.request('homeEncounter'),first=(await f.api.handle(req)).result;assert.equal(first.kind,'mole');assert.equal(first.challenge.milestone,2);
 assert.equal((await f.api.handle(req)).result.challenge.id,first.challenge.id);
 s.monsters.mole.enabled=false;f.db.data.set('ops_game_config/encounters',s);
 const active=(await f.api.handle(f.request('homeEncounter'))).result;assert.equal(active.challenge.id,first.challenge.id,'new config must not cancel in-flight battles');
 f.clear();f.own().moleChallenge=null;f.own().moleLastMilestone=0;
 assert.equal((await f.api.handle(f.request('homeEncounter'))).result,null);
 s.monsters.mole.enabled=true;f.db.data.set('ops_game_config/encounters',s);
 assert.equal((await f.api.handle(f.request('homeEncounter',{verifyOnly:true}))).result,null,'harvest verification never introduces a milestone');
 await assert.rejects(f.api.handle(f.request('homeEncounter',{collectWhenClear:true})),/沒有可收取的雞蛋/);
 assert.equal((await f.api.handle(f.request('homeEncounter'))).result.kind,'mole','a new entry sees earned milestones despite an existing clear permit');
});
test('visit scope/min-level/0/100 and legacy claim endpoint are server-validated without new client conditions',async()=>{
 const f=setup(),s=settings();for(const v of Object.values(s.monsters))v.enabled=false;
 s.monsters.wolf={...structuredClone(E.DEFAULTS.wolf),visit:{enabled:true,minLevel:3,rate:100}};f.db.data.set('ops_game_config/encounters',s);
 const target={targetGroupId:'A',targetAccountId:'bob'};
 assert.equal((await f.api.handle(f.request('visitEncounter',target))).result.kind,'wolf');
 f.clear();f.db.data.get('groups/A/users/bob').farm.coopLevel=2;assert.equal((await f.api.handle(f.request('visitEncounter',target))).result,null);
 f.own().gardenCatchCount=300;
 assert.equal((await f.api.handle(f.request('claimEncounter',{...target,monster:'mole'}))).result,null,'disabled milestone cannot be forced with legacy client claims');
 s.monsters.mole.enabled=true;s.monsters.mole.visit.rate=0;f.db.data.set('ops_game_config/encounters',s);
 assert.equal((await f.api.handle(f.request('claimEncounter',{...target,monster:'mole'}))).result,null);
});
test('settings read only for a fresh entry, not active battles, harvest verification or replayed permits',async()=>{
 const f=setup(),s=settings();for(const value of Object.values(s.monsters))value.enabled=false;f.db.data.set('ops_game_config/encounters',s);
 let reads=0;const original=E.config;E.config=async(...args)=>{reads++;return original(...args);};
 try{
  const first=f.request('homeEncounter');await f.api.handle(first);assert.equal(reads,1);
  await f.api.handle(first);await f.api.handle(f.request('homeEncounter',{verifyOnly:true}));await f.api.handle(f.request('ensureWelcome'));assert.equal(reads,1);
  const target={targetGroupId:'A',targetAccountId:'bob'};await f.api.handle(f.request('visitEncounter',target));assert.equal(reads,2);
  await f.api.handle(f.request('visitEncounter',{...target,reusePermit:true}));await f.api.handle(f.request('visitEncounter',{...target,verifyOnly:true}));assert.equal(reads,2);
  f.clear();s.monsters.eagle.enabled=true;s.monsters.eagle.home.rate=100;const battle=(await f.api.handle(f.request('homeEncounter'))).result;assert.equal(battle.kind,'eagle');assert.equal(reads,3);
  await f.api.handle(f.request('homeEncounter'));assert.equal(reads,3,'in-flight battle resumes without reading new conditions');
 }finally{E.config=original;}
});
