const test=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./fixture.cjs'),{createService}=require('../functions/service.cjs'),I=require('../../functions/identity-domain.cjs');
test('private identity migration preserves existing daily grant identity and prevents claiming again',async()=>{
 const f=await fixture(),statusRequest={...f.request(),data:{groupId:'A',action:'status'}};
 const initial=await f.service.dailyChallenges(statusRequest),checkin=initial.challenges.checkin;
 const claim={...f.request(),data:{groupId:'A',action:'claim',type:'checkin',dateKey:checkin.dateKey,cycleId:checkin.cycleId,day:checkin.day,requestId:'claim-old-123'}};
 const first=await f.service.dailyChallenges(claim),before=(await f.db.doc('groups/A/users/alice').get()).data().farm.coins;
 f.db.data.set('ops_identity_state/global',{ready:true,farmReady:true});f.db.data.set('ops_identity_credentials/alice',{authUid:I.profileUid('alice'),accountId:'alice',sessionVersion:1,disabled:false});
 const service=createService({db:f.db,auth:{getUser:async()=>({disabled:false})},now:f.now,privateIdentityEnabled:()=>true,farmBackendEnabled:()=>true});
 const request={...claim,auth:{uid:I.profileUid('alice'),token:{photoAccountId:'alice',photoGroupId:'A',nexusProfileId:'alice',nexusAccountId:'alice',nexusSessionVersion:1}}};
 const result=await service.dailyChallenges(request);assert.equal(result.replayed,true);assert.equal(result.transactionId,first.transactionId);assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,before);
});
