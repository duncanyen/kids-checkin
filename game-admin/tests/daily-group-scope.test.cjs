const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture}=require('./fixture.cjs'),{createDailyChallenges,DEFAULT_CONFIG,dateKey}=require('../functions/daily-challenges.cjs'),S=require('../functions/daily-scope.cjs');
const start=Date.parse('2026-11-23T04:00:00+08:00'),DAY=86400000;
async function setup(){const f=await fixture();f.clock(start);const player=async r=>({uid:'alice',accountId:'alice',groupId:r.data.groupId});const api=createDailyChallenges({db:f.db,now:f.now,player,playerSession:player,throttle:async()=>{},trustedReady:async()=>true});
 const req=(group,action='status',data={})=>({auth:{uid:'alice'},data:{groupId:group,action,...data}}),status=g=>api.handle(req(g)),claim=async(g,type='checkin',s)=>{s||=await status(g);const c=s.challenges[type];return api.handle(req(g,'claim',{type,dateKey:s.dateKey,cycleId:c.cycleId,day:c.day,requestId:crypto.randomUUID()}));};
 const event=async(group,type,id=crypto.randomUUID())=>f.db.runTransaction(async t=>{const write=await api.prepareProgress(t,{uid:'alice',accountId:'alice',groupId:group},{id,type,producer:'farm-transactions-v1',occurredAt:f.now(),collected:20,targetAccountId:'bob'},f.now());write();return write.dailyProgress;});
 return{f,api,req,status,claim,event};}
test('same profile in two groups has independent checkins, all three task counters, mission claims and coin balances',async()=>{
 const x=await setup(),a=await x.status('A'),b=await x.status('B');assert.notEqual(a.challenges.checkin.cycleId,b.challenges.checkin.cycleId);
 const grants=await Promise.all(['A','A','B','B'].map(g=>x.claim(g)));assert.equal(new Set(grants.map(g=>g.transactionId)).size,2);
 for(const task of DEFAULT_CONFIG.mission.tasks)for(let n=0;n<3;n++)await x.event('A',task.type);
 assert.equal((await x.status('A')).challenges.mission.canClaim,true);assert.ok((await x.status('B')).challenges.mission.tasks.every(t=>t.count===0));
 await x.claim('A','mission');await assert.rejects(x.claim('B','mission'),/尚未完成/);
 const id='group-B-egg';await x.event('B','COLLECT_EGG_ACTION',id);await x.event('B','COLLECT_EGG_ACTION',id);
 assert.equal((await x.status('B')).challenges.mission.tasks[0].count,1);assert.equal((await x.status('A')).challenges.mission.claimed,true);
 for(const [g,coins]of [['A',400],['B',200]])assert.equal((await x.f.db.doc(`groups/${g}/users/alice`).get()).data().farm.coins,coins);
});
test('seven-day cycles and missed-day resets remain independent when switching groups',async()=>{
 const x=await setup();for(let n=0;n<8;n++){x.f.clock(start+n*DAY);const a=await x.status('A');assert.equal(a.challenges.checkin.day,n%7+1);await x.claim('A');if(n===0)await x.claim('B');}
 assert.equal((await x.status('B')).challenges.checkin.day,1);assert.equal((await x.status('B')).challenges.mission.day,1);
});
async function seedLegacy(x,{group='A',type='checkin',day=4,date=dateKey(start),progress={}}={}){
 const identity={uid:'alice',accountId:'alice',groupId:group},id=S.legacyRef(x.f.db,'ops_daily_grants','alice',type,date).id,cycleId='legacy-cycle-'+type;
 const snapshot={uid:'alice',accountId:'alice',type,dateKey:date,day,cycleId,rewards:DEFAULT_CONFIG[type].rewards,policyVersion:'legacy',missedDayPolicy:'reset',tasks:type==='mission'?DEFAULT_CONFIG.mission.tasks:[],progress,claimedAt:start,grantId:id,claimedGroupId:group,createdAt:start};
 const response={transactionId:id,type,dateKey:date,cycleId,day,amount:DEFAULT_CONFIG[type].rewards[day-1],groupId:group,createdAt:start};
 await S.legacyRef(x.f.db,'ops_daily_days','alice',type,date).set(snapshot);await S.legacyRef(x.f.db,'ops_daily_states','alice',type).set({uid:'alice',accountId:'alice',day,cycleId,lastClaimDate:date});await S.legacyRef(x.f.db,'ops_daily_grants','alice',type,date).set({...identity,type,dateKey:date,cycleId,createdAt:start,response});return{id,snapshot};
}
test('legacy money already credited to A stays claimed only in A, keeps cycle and original receipt, B may claim independently',async()=>{
 const x=await setup(),old=await seedLegacy(x),archive=structuredClone([...x.f.db.data].filter(([p])=>p.startsWith('ops_daily_')));
 const a=await x.status('A'),b=await x.status('B');assert.equal(a.challenges.checkin.claimed,true);assert.equal(a.challenges.checkin.day,4);assert.equal(b.challenges.checkin.claimed,false);assert.equal(b.challenges.checkin.day,1);
 const paid=await x.claim('A');assert.equal(paid.replayed,true);assert.equal(paid.transactionId,old.id);assert.equal((await x.f.db.doc('groups/A/users/alice').get()).data().farm.coins,100);
 await x.claim('B');assert.equal((await x.f.db.doc('groups/B/users/alice').get()).data().farm.coins,200);
 x.f.clock(start+DAY);assert.equal((await x.status('A')).challenges.checkin.day,5);assert.equal((await x.status('B')).challenges.checkin.day,2);
 for(const [path,value]of archive)assert.deepEqual(x.f.db.data.get(path),value,'legacy records are read-only');
});
test('legacy unclaimed mixed progress is reconstructed from group-tagged receipts, never copied from aggregate totals',async()=>{
 const x=await setup(),today=dateKey(start),ref=S.legacyRef(x.f.db,'ops_daily_days','alice','mission',today);
 await ref.set({tasks:DEFAULT_CONFIG.mission.tasks,rewards:DEFAULT_CONFIG.mission.rewards,policyVersion:'old',missedDayPolicy:'reset',progress:{COLLECT_EGG_ACTION:3,HELP_CLEAN_OTHER:3,DEFEAT_MONSTER:3},grantId:null});
 for(const [id,g,type]of [['a1','A','COLLECT_EGG_ACTION'],['a2','A','COLLECT_EGG_ACTION'],['b1','B','DEFEAT_MONSTER']])await x.f.db.doc('ops_daily_events/'+id).set({uid:'alice',accountId:'alice',groupId:g,type,dateKey:today,result:'counted'});
 assert.deepEqual((await x.status('A')).challenges.mission.tasks.map(t=>t.count),[2,0,0]);assert.deepEqual((await x.status('B')).challenges.mission.tasks.map(t=>t.count),[0,0,1]);
 // Once initialized, new operations extend only the scoped counter; no remigration.
 await x.event('A','COLLECT_EGG_ACTION');assert.deepEqual((await x.status('A')).challenges.mission.tasks.map(t=>t.count),[3,0,0]);assert.deepEqual((await x.status('B')).challenges.mission.tasks.map(t=>t.count),[0,0,1]);
});
test('previous-day legacy grant resumes only its credited group; continue policy can find an older proven group grant',async()=>{
 const x=await setup();await seedLegacy(x,{date:dateKey(start-DAY),group:'B',day:6});assert.equal((await x.status('B')).challenges.checkin.day,7);assert.equal((await x.status('A')).challenges.checkin.day,1);
 const y=await setup();await seedLegacy(y,{date:dateKey(start-10*DAY),group:'B',day:3});const config=structuredClone(DEFAULT_CONFIG);config.checkin.missedDayPolicy='continue';await y.f.db.doc('ops_daily_configs/current').set(config);assert.equal((await y.status('B')).challenges.checkin.day,4);assert.equal((await y.status('A')).challenges.checkin.day,1);
});

test('legacy completed mission stays claimed in its credited farm; another group can earn its own mission reward',async()=>{
 const x=await setup(),progress=Object.fromEntries(DEFAULT_CONFIG.mission.tasks.map(task=>[task.type,3])),old=await seedLegacy(x,{type:'mission',day:1,progress});
 for(const task of DEFAULT_CONFIG.mission.tasks)for(let n=0;n<3;n++)await x.f.db.doc('ops_daily_events/b-'+task.type+'-'+n).set({uid:'alice',accountId:'alice',groupId:'B',type:task.type,dateKey:dateKey(start),result:'counted'});
 const a=await x.status('A'),b=await x.status('B');assert.equal(a.challenges.mission.claimed,true);assert.ok(a.challenges.mission.tasks.every(task=>task.count===3));assert.equal(b.challenges.mission.claimed,false);assert.equal(b.challenges.mission.canClaim,true);
 const replay=await x.claim('A','mission',a),paid=await x.claim('B','mission',b);assert.equal(replay.transactionId,old.id);assert.notEqual(paid.transactionId,old.id);assert.equal(paid.amount,200);assert.equal((await x.f.db.doc('groups/A/users/alice').get()).data().farm.coins,100);assert.equal((await x.f.db.doc('groups/B/users/alice').get()).data().farm.coins,300);
});
