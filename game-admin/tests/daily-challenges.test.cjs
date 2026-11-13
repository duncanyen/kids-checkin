const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixture.cjs');
const {createDailyChallenges,DEFAULT_CONFIG,dateKey}=require('../functions/daily-challenges.cjs');
const config=()=>structuredClone(DEFAULT_CONFIG);
const start=Date.parse('2026-11-12T16:01:00Z'),DAY=86400000;
async function setup(){const f=await fixture();f.clock(start);return f;}
const request=(f,action='status',extra={},user='alice',group='A')=>{const r=f.request(user,undefined,undefined,group);r.data={...r.data,action,...extra};return r;};
async function status(f){return f.service.dailyChallenges(request(f));}
async function claim(f,type='checkin',state,group='A'){
 state||=await status(f);const c=state.challenges[type];
 return f.service.dailyChallenges(request(f,'claim',{type,dateKey:state.dateKey,cycleId:c.cycleId,day:c.day},'alice',group));
}
test('seven-day rewards, server Taiwan midnight, cycle rollover and independent mission state',async()=>{
 const f=await setup();let total=100,cycle;
 for(let day=1;day<=8;day++){
  f.clock(start+(day-1)*DAY);const s=await status(f),c=s.challenges.checkin;
  assert.equal(c.day,(day-1)%7+1);assert.equal(s.timeZone,'Asia/Taipei');assert.equal(s.nextResetAt>Date.parse(s.dateKey+'T00:00:00+08:00'),true);
  assert.equal(s.challenges.mission.day,1);
  if(day===1)cycle=c.cycleId;if(day===8)assert.notEqual(c.cycleId,cycle);
  const result=await claim(f,'checkin',s);total+=DEFAULT_CONFIG.checkin.rewards[(day-1)%7];
  assert.equal(result.amount,DEFAULT_CONFIG.checkin.rewards[(day-1)%7]);
  assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,total);
  assert.equal((await status(f)).challenges.checkin.claimed,true);
 }
 assert.equal((await f.db.collection('ops_daily_grants').get()).size,8);
 assert.equal(dateKey(Date.parse('2026-11-12T15:59:59Z')),'2026-11-12');assert.equal(dateKey(Date.parse('2026-11-12T16:00:00Z')),'2026-11-13');
});
test('same-day concurrent devices, altered request ID and cross-group replay grant once',async()=>{
 const f=await setup(),s=await status(f);
 const results=await Promise.all(Array.from({length:8},()=>claim(f,'checkin',s)));
 assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(new Set(results.map(r=>r.transactionId)).size,1);
 const replay=await claim(f,'checkin',s,'B');assert.equal(replay.replayed,true);assert.equal(replay.groupId,'A');
 assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,300);
 assert.equal((await f.db.doc('groups/B/users/alice').get()).data().farm.coins,100);
});
test('missed default resets, configurable continue retains streak and snapshot reward is stable',async()=>{
 const f=await setup();await claim(f);f.clock(start+DAY);let s=await status(f);assert.equal(s.challenges.checkin.day,2);
 const c=config();c.checkin.rewards[1]=777;await f.db.doc('ops_daily_configs/current').set(c);
 const paid=await claim(f,'checkin',s);assert.equal(paid.amount,400,'same-day configuration changes cannot silently alter the displayed reward');
 f.clock(start+3*DAY);s=await status(f);assert.equal(s.challenges.checkin.day,1);
 // A distinct fixture verifies changing the missed-day rule before next-day creation.
 const g=await setup();const preserve=config();preserve.checkin.missedDayPolicy='continue';await g.db.doc('ops_daily_configs/current').set(preserve);await claim(g);
 g.clock(start+3*DAY);assert.equal((await status(g)).challenges.checkin.day,2);
});
test('failed award is atomic, same request retries, disabled and impossible missions cannot claim',async()=>{
 const f=await setup(),s=await status(f);f.db.failAward=true;
 await assert.rejects(claim(f,'checkin',s),/simulated storage failure/);
 assert.equal((await f.db.collection('ops_daily_grants').get()).size,0);assert.equal((await status(f)).challenges.checkin.claimed,false);
 assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,100);
 await claim(f,'checkin',s);
 assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,300);
 assert.equal(s.challenges.mission.blocked,true);assert.ok(s.challenges.mission.tasks.every(t=>t.count===0&&!t.verified));
 await assert.rejects(claim(f,'mission',s),{code:'failed-precondition'});
 const g=await setup(),c=config();c.checkin.enabled=false;await g.db.doc('ops_daily_configs/current').set(c);
 await assert.rejects(claim(g),{code:'failed-precondition'});
});
test('stale midnight claim, forged time/identity/coins, invalid actions, anonymous, removed and blocked accounts',async()=>{
 const f=await setup(),s=await status(f);f.clock(start+DAY);
 await assert.rejects(claim(f,'checkin',s),{code:'deadline-exceeded'});
 const current=await status(f),c=current.challenges.checkin;
 const forged=request(f,'claim',{type:'checkin',dateKey:current.dateKey,cycleId:c.cycleId,day:c.day,amount:999999,accountId:'bob',serverNow:0});
 const granted=await f.service.dailyChallenges(forged);assert.equal(granted.amount,200);
 assert.equal((await f.db.doc('groups/A/users/bob').get()).data().farm.coins,100);
 await assert.rejects(f.service.dailyChallenges({data:{action:'status',groupId:'A'}}),{code:'unauthenticated'});
 await assert.rejects(f.service.dailyChallenges(request(f,'recordEvent',{progress:{DEFEAT_MONSTER:3}})),{code:'invalid-argument'});
 const mismatch=request(f);mismatch.auth.token.photoGroupId='B';await assert.rejects(f.service.dailyChallenges(mismatch),{code:'permission-denied'});
 await f.db.doc('ops_player_controls/alice').set({blocked:true});await assert.rejects(status(f),{code:'permission-denied'});
 await f.db.doc('ops_player_controls/alice').set({blocked:false});await f.db.doc('users/alice').update({role:'removed'});await assert.rejects(status(f),{code:'permission-denied'});
});
async function eventFixture(){
 const f=await setup(),verifiedProducers=Object.fromEntries(DEFAULT_CONFIG.mission.tasks.map(t=>[t.type,'test-trusted-server']));
 const player=async r=>({uid:r.auth.uid,accountId:r.auth.token.photoAccountId,groupId:r.data.groupId});
 const service=createDailyChallenges({db:f.db,now:()=>f.now(),player,playerSession:player,throttle:async()=>{},verifiedProducers});
 async function event(id,type,extra={}){await f.db.doc('ops_verified_farm_events/'+id).set({uid:'alice',accountId:'alice',groupId:'A',type,success:true,producer:'test-trusted-server',occurredAt:f.now(),collected:50,targetAccountId:'bob',...extra});return service.consumeVerifiedEvent(id);}
 const read=()=>service.handle(request(f));
 return{f,service,event,read};
}
test('future server-only event integration counts operations once, caps progress, rejects invalid sources and completes independent mission cycles',async()=>{
 const {f,service,event,read}=await eventFixture();
 await event('collect-1','COLLECT_EGG_ACTION');await service.consumeVerifiedEvent('collect-1');
 assert.equal((await read()).challenges.mission.tasks[0].count,1,'50 eggs and event replay still count one operation');
 await assert.rejects(event('zero','COLLECT_EGG_ACTION',{collected:0}),{code:'invalid-argument'});
 await assert.rejects(event('self','HELP_CLEAN_OTHER',{targetAccountId:'alice'}),{code:'invalid-argument'});
 await assert.rejects(event('fake','DEFEAT_MONSTER',{producer:'client'}),{code:'failed-precondition'});
 await assert.rejects(event('loss','DEFEAT_MONSTER',{success:false}),{code:'failed-precondition'});
 for(let day=1;day<=8;day++){
  f.clock(start+(day-1)*DAY);
  for(const task of DEFAULT_CONFIG.mission.tasks)for(let i=0;i<4;i++)await event(`${day}-${task.type}-${i}`,task.type);
  const s=await read();assert.equal(s.challenges.mission.day,(day-1)%7+1);assert.equal(s.challenges.mission.canClaim,true);assert.equal(s.challenges.checkin.day,1);
  for(const task of s.challenges.mission.tasks)assert.equal(task.count,3);
  const c=s.challenges.mission;
  const r=request(f,'claim',{type:'mission',dateKey:s.dateKey,cycleId:c.cycleId,day:c.day});
  const [a,b]=await Promise.all([service.handle(r),service.handle(r)]);assert.equal(a.transactionId,b.transactionId);
 }
 assert.equal((await f.db.collection('ops_daily_grants').get()).size,8);
 // Existing production integration intentionally has NO verified producers enabled.
 const actual=await f.service.dailyChallenges(request(f));assert.equal(actual.challenges.mission.blocked,true);
});
test('future trusted events from an earlier Taiwan date cannot retroactively grant progress',async()=>{
 const {f,event}=await eventFixture();await assert.rejects(event('old','DEFEAT_MONSTER',{occurredAt:f.now()-DAY}),{code:'failed-precondition'});
});
test('admin-only config, per-player state and paginated grant lookup use real records',async()=>{
 const f=await setup();await claim(f);
 const c=await f.admin('dailyConfig');assert.deepEqual(c.config.checkin.rewards,[200,400,600,800,1000,1200,2000]);assert.deepEqual(c.verifiedProducers,{});
 const p=await f.admin('dailyPlayer',{uid:'alice'});assert.equal(p.rows.find(r=>r.type==='checkin').day.grantId.length,64);
 const list=await f.admin('dailyGrants',{uid:'alice',pageSize:1});assert.equal(list.rows.length,1);assert.equal(list.rows[0].response.amount,200);
 await assert.rejects(f.service.adminAPI({...f.request(),data:{action:'dailyGrants',payload:{uid:'alice'}}}),{code:'permission-denied'});
});
test('disabling all tasks cannot accidentally turn the mission into a free reward',async()=>{
 const f=await setup(),c=config();for(const task of c.mission.tasks)task.enabled=false;
 await f.db.doc('ops_daily_configs/current').set(c);
 assert.equal((await status(f)).challenges.mission.canClaim,false);
 await assert.rejects(claim(f,'mission'),{code:'failed-precondition'});
});
