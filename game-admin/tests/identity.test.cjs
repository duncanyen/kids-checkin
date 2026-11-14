const {test}=require('node:test');
const assert=require('node:assert/strict');
const I=require('../../functions/identity-domain.cjs');
const {assertIdentity}=require('../../functions/identity-access.cjs');
const {createIdentityService}=require('../../functions/identity-service.cjs');
const {MemoryDB}=require('./memory-db.cjs');
async function fixture(){
 const db=new MemoryDB(),tokens=[];let stamp=1700000000000;
 const auth={getUser:async()=>({disabled:false}),createCustomToken:async(uid,claims)=>{tokens.push({uid,claims});return 'opaque-token';},revokeRefreshTokens:async()=>{}};
 const service=createIdentityService({db,auth,enabled:()=>true,now:()=>stamp});
 db.data.set('ops_identity_state/global',{ready:true});
 const credentials={authUid:I.profileUid('profile-1'),accountId:'alice',sessionVersion:1,disabled:false,secrets:[await I.hashSecret('secret123')]};
 db.data.set('users/profile-1',{accountId:'alice',name:'Alice',role:'member',password:'must-not-leak',pin:'1234'});
 db.data.set('ops_identity_credentials/profile-1',credentials);
 db.data.set('ops_identity_accounts/'+I.hash('alice'),{profileId:'profile-1'});
 const request={auth:{uid:I.profileUid('profile-1'),token:{nexusProfileId:'profile-1',nexusAccountId:'alice',nexusSessionVersion:1}},data:{action:'profile'}};
 return{db,service,request,tokens,advance:()=>stamp+=700000};
}
test('scrypt uses random salt, verifies legacy PIN and rejects malformed records',async()=>{
 const a=await I.hashSecret('1234'),b=await I.hashSecret('1234');
 assert.notEqual(a.salt,b.salt);assert.notEqual(a.hash,b.hash);
 assert.equal(await I.matches('1234',a),true);assert.equal(await I.matches('4321',a),false);
 assert.equal(await I.verify('1234',{secrets:[a,b,a]}),false);
 assert.equal(await I.matches('1234',{...a,hash:'x'}),false);
});
test('login returns whitelisted profile and namespaced identity claims',async()=>{
 const f=await fixture(),result=await f.service.handle({data:{action:'login',identifier:'ALICE',secret:'secret123'}});
 assert.equal(result.profile.docId,'profile-1');assert.equal(result.profile.password,undefined);assert.equal(result.profile.pin,undefined);
 assert.equal(f.tokens[0].uid,I.profileUid('profile-1'));assert.notEqual(f.tokens[0].uid,'profile-1');
 assert.equal(f.tokens[0].claims.nexusSessionVersion,1);
 await assert.rejects(f.service.handle({data:{action:'login',identifier:'alice',secret:'bad'}}),{code:'unauthenticated'});
});
test('private mode fails closed when migration ready is removed',async()=>{
 const f=await fixture();f.db.data.delete('ops_identity_state/global');
 assert.equal(f.service.configured(),true);assert.equal(await f.service.active(),false);
 await assert.rejects(f.service.handle(f.request),{code:'failed-precondition'});
});
test('forged UID, revoked session and removed membership cannot obtain group token',async()=>{
 const f=await fixture();
 await assert.rejects(assertIdentity({...f.request,auth:{...f.request.auth,uid:'profile-1'}},f.db),{code:'permission-denied'});
 await assert.rejects(f.service.handle({...f.request,data:{action:'groupToken',groupId:'other'}}),{code:'permission-denied'});
 f.db.data.get('ops_identity_credentials/profile-1').sessionVersion=2;
 await assert.rejects(assertIdentity(f.request,f.db),{code:'unauthenticated'});
});
test('password change revokes old claims and keeps logical account identity',async()=>{
 const f=await fixture();await f.service.handle({...f.request,data:{action:'changePassword',currentSecret:'secret123',newSecret:'new-secret'}});
 await assert.rejects(assertIdentity(f.request,f.db),{code:'unauthenticated'});
 assert.equal(f.tokens[0].claims.nexusProfileId,'profile-1');assert.equal(f.tokens[0].claims.nexusSessionVersion,2);
 assert.equal(await I.verify('secret123',f.db.data.get('ops_identity_credentials/profile-1')),false);
});
test('parallel registration reserves a single account without public credentials',async()=>{
 const f=await fixture(),req={data:{action:'register',accountId:'bob',name:'Bob',email:'bob@example.test',secret:'new-secret'}};
 const results=await Promise.allSettled([f.service.handle(req),f.service.handle(req)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 const profile=[...f.db.data.entries()].find(([p,v])=>p.startsWith('users/')&&v.accountId==='bob')[1];
 assert.equal(profile.password,undefined);assert.equal(profile.pin,undefined);assert.equal(profile.role,'member');
});
test('rate limit refuses excess attempts and recovers after window',async()=>{
 const f=await fixture();await f.service.limit('test',1,1000);
 await assert.rejects(f.service.limit('test',1,1000),{code:'resource-exhausted'});
 f.advance();await f.service.limit('test',1,1000);
});
test('profile rename and password change commit together and never alter account or role',async()=>{
 const f=await fixture();
 const result=await f.service.handle({...f.request,data:{action:'updateProfile',name:'Renamed',currentSecret:'secret123',newSecret:'new-secret',role:'admin',accountId:'bob'}});
 assert.equal(result.profile.accountId,'alice');assert.equal(result.profile.role,'member');assert.equal(result.profile.name,'Renamed');
 assert.equal(result.profile.password,undefined);
 assert.equal(f.db.data.get('users/profile-1').name,'Renamed');
 assert.equal(f.tokens[0].claims.nexusSessionVersion,2);
 await assert.rejects(assertIdentity(f.request,f.db),{code:'unauthenticated'});
});
test('delete account invalidates credentials and does not allow reauthentication',async()=>{
 const f=await fixture();await f.service.handle({...f.request,data:{action:'deleteAccount'}});
 assert.equal(f.db.data.has('users/profile-1'),false);assert.equal(f.db.data.get('ops_identity_credentials/profile-1').disabled,true);
 await assert.rejects(f.service.handle({data:{action:'login',identifier:'alice',secret:'secret123'}}),{code:'unauthenticated'});
});
test('private profile endpoints reject HTML display names without changing the profile',async()=>{
 const f=await fixture();await assert.rejects(f.service.handle({...f.request,data:{action:'updateProfile',name:'<img src=x onerror=alert(1)>',currentSecret:'secret123'}}),{code:'invalid-argument'});
 assert.equal(f.db.data.get('users/profile-1').name,'Alice');
 assert.equal(I.publicLabel("O'Neil & 家庭"),"O'Neil & 家庭");
});
