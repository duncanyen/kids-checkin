const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('../game-admin/tests/fixture.cjs');
const moduleReady=import('data:text/javascript;base64,'+fs.readFileSync('js/farm/daily-preview-cache.js').toString('base64'));
const context={accountId:'alice',groupId:'A'},stamp=Date.parse('2026-11-13T04:00:00Z');
const storage=()=>{const values=new Map();return{values,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
async function snapshot(){const f=await fixture();f.clock(stamp);return f.service.dailyChallenges({...f.request(),data:{groupId:'A',action:'status'}});}
test('read-only preview persists display fields, not credentials, and never grants claim authority',async()=>{
 const {readDailyPreview,writeDailyPreview}=await moduleReady,data=await snapshot(),store=storage();
 data.password='do-not-cache';data.challenges.mission.tasks[0].token='also-not-cached';
 writeDailyPreview(context,data,{storage:store,now:stamp});
 const restored=readDailyPreview(context,{storage:store,now:stamp+1000});
 assert.equal(restored.dateKey,'2026-11-13');assert.equal(restored.serverNow,stamp+1000);
 assert.equal(restored.challenges.checkin.canClaim,false);assert.equal(data.challenges.checkin.canClaim,true);
 assert.equal(JSON.stringify([...store.values.values()]).includes('do-not-cache'),false);
 assert.equal(JSON.stringify([...store.values.values()]).includes('also-not-cached'),false);
 assert.equal(readDailyPreview({accountId:'bob',groupId:'A'},{storage:store,now:stamp}),null);
 assert.equal(readDailyPreview({accountId:'alice',groupId:'B'},{storage:store,now:stamp}),null);
});
test('Taiwan midnight, device clock rollback, old/schema-invalid data and private-mode storage safely discard previews',async()=>{
 const {readDailyPreview,writeDailyPreview}=await moduleReady,data=await snapshot(),store=storage();
 writeDailyPreview(context,data,{storage:store,now:stamp});
 assert.equal(readDailyPreview(context,{storage:store,now:data.nextResetAt}),null);assert.equal(store.values.size,0);
 writeDailyPreview(context,data,{storage:store,now:stamp});assert.equal(readDailyPreview(context,{storage:store,now:stamp-1}),null);
 writeDailyPreview(context,data,{storage:store,now:stamp});const key=[...store.values.keys()][0];store.values.set(key,'broken-json');assert.equal(readDailyPreview(context,{storage:store,now:stamp}),null);
 writeDailyPreview(context,data,{storage:store,now:stamp});const value=JSON.parse(store.values.get(key));value.state.challenges.checkin.day=99;store.values.set(key,JSON.stringify(value));assert.equal(readDailyPreview(context,{storage:store,now:stamp}),null);
 const blocked={getItem(){throw Error('private mode');},setItem(){throw Error('quota');},removeItem(){throw Error('private mode');}};
 assert.equal(readDailyPreview(context,{storage:blocked}),null);assert.doesNotThrow(()=>writeDailyPreview(context,data,{storage:blocked}));
});
test('verified progress merges monotonically; stale dates, changed rules and different cycles never overwrite current state',async()=>{
 const {mergeDailyProgress}=await moduleReady,state=await snapshot();
 const update={serverNow:state.serverNow,dateKey:state.dateKey,mission:structuredClone(state.challenges.mission)};
 update.mission.tasks[0].count=2;
 const merged=mergeDailyProgress(state,update);assert.equal(merged.challenges.mission.tasks[0].count,2);assert.equal(state.challenges.mission.tasks[0].count,0);
 update.mission.tasks[0].count=1;assert.equal(mergeDailyProgress(merged,update).challenges.mission.tasks[0].count,2);
 merged.challenges.mission.claimed=true;merged.challenges.mission.grantId='claimed';
 assert.equal(mergeDailyProgress(merged,update).challenges.mission.claimed,true);
 assert.equal(mergeDailyProgress(merged,{...update,dateKey:'2026-11-12'}),merged);
 assert.equal(mergeDailyProgress(merged,{...update,dateKey:'2026-11-14'}),null);
 for(const mutate of [m=>m.cycleId='other',m=>m.policyVersion='other',m=>m.tasks[0].target++,m=>m.tasks[0].count=-1]){
  const next=structuredClone(update);mutate(next.mission);assert.equal(mergeDailyProgress(state,next),null);
 }
});
