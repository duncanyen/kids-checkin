const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,uid}=require('./fixture.cjs');
const {DEFAULT_SETTINGS}=require('../functions/management.cjs');
const event=(f,patch={})=>({title:'村落活動',description:'活動內容 <script>unsafe()</script>',type:'community',status:'draft',priority:10,targetType:'all',targetAccountIds:[],showPopup:false,activityCode:'',startAt:f.now()-10,endAt:f.now()+10000,reason:'活動測試',expectedRevision:0,...patch});
const guard=(f,action,payload={})=>f.service.guardDog({...f.request(),data:{action,groupId:'A',requestId:uid(),...payload}});

test('all new management reads/writes require current server admin claims',async()=>{
 const f=await fixture();
 for(const action of ['listPlayers','playerDetail','gameBalance','listEvents','getSettings','savePlayerControl','adjustPlayerCoins','saveGuardConfig','saveEvent','saveSettings']){
  await assert.rejects(f.admin(action,{}, {auth:null}),{code:'unauthenticated'});
  await assert.rejects(f.admin(action,{}, {auth:{uid:'alice',token:{role:'player'}}}),{code:'permission-denied'});
 }
 f.revoke();await assert.rejects(f.admin('listPlayers'),{code:'permission-denied'});
});
test('player lists paginate/search by stable accountId and never return credentials or entire farm records',async()=>{
 const f=await fixture(),ref=f.db.doc('users/alice');await ref.update({password:'DO-NOT-RETURN-PASSWORD',pin:'DO-NOT-RETURN-PIN',email:'private@example.test',name:'新名稱'});
 const first=await f.admin('listPlayers',{pageSize:1});assert.equal(first.rows.length,1);assert.equal(first.rows[0].accountId,'alice');assert.equal(first.rows[0].name,'新名稱');
 const next=await f.admin('listPlayers',{pageSize:1,cursor:first.nextCursor});assert.equal(next.rows[0].accountId,'bob');
 assert.equal((await f.admin('listPlayers',{accountId:'alice'})).rows.length,1);
 const detail=await f.admin('playerDetail',{uid:'alice'});assert.equal(detail.farms.length,2);assert.equal(detail.farms[0].coins,100);
 const serialized=JSON.stringify([first,detail]);for(const secret of ['DO-NOT-RETURN','private@example.test','hensState'])assert.ok(!serialized.includes(secret));
});
test('management uses users document UID for identity and accountId for membership/farm ownership',async()=>{
 const f=await fixture();await f.db.doc('users/random-profile-uid').set({accountId:'distinct-account',name:'不同識別碼',role:'member'});
 await f.db.doc('groups/C').set({members:['distinct-account']});await f.db.doc('groups/C/users/distinct-account').set({farm:{coins:50,hens:1,coopLevel:1}});
 const rows=(await f.admin('listPlayers',{accountId:'distinct-account'})).rows;assert.equal(rows[0].uid,'random-profile-uid');
 const detail=await f.admin('playerDetail',{uid:rows[0].uid});assert.equal(detail.farms[0].coins,50);
 await f.admin('adjustPlayerCoins',{uid:rows[0].uid,groupId:'C',delta:5,expectedCoins:50,reason:'固定帳號驗證'});
 assert.equal((await f.db.doc('groups/C/users/distinct-account').get()).data().farm.coins,55);
});
test('player controls live separately from users and block every player operations API without blocking admin access',async()=>{
 const f=await fixture(),before=(await f.db.doc('users/alice').get()).data();
 await f.admin('savePlayerControl',{uid:'alice',blocked:true,notes:'管理備註',reason:'測試限制',expectedRevision:0});
 assert.deepEqual((await f.db.doc('users/alice').get()).data(),before);
 for(const run of [()=>f.service.announcements(f.request()),()=>f.service.redeem(f.request()),()=>guard(f,'catalog')])await assert.rejects(run(),{code:'permission-denied'});
 assert.equal((await f.admin('playerDetail',{uid:'alice'})).control.blocked,true);
 await assert.rejects(f.admin('savePlayerControl',{uid:'alice',blocked:false,notes:'',reason:'舊版本',expectedRevision:0}),{code:'failed-precondition'});
 await f.admin('savePlayerControl',{uid:'alice',blocked:false,notes:'',reason:'解除限制',expectedRevision:1});
 assert.equal((await f.service.announcements(f.request())).rows.length,0);
});
test('coin adjustment is atomic, idempotent, audited, bounded, and refuses a stale balance',async()=>{
 const f=await fixture(),payload={uid:'alice',groupId:'A',delta:25,expectedCoins:100,reason:'補償確認'};
 const request={auth:f.adminAuth,data:{action:'adjustPlayerCoins',payload,requestId:uid()}};
 assert.equal((await f.service.adminAPI(request)).coins,125);assert.equal((await f.service.adminAPI(request)).replayed,true);
 const owner=(await f.db.doc('groups/A/users/alice').get()).data();assert.equal(owner.farm.coins,125);assert.equal(owner.keep,'unchanged');assert.equal(owner.farm.hens,1);
 assert.equal((await f.db.doc('groups/A/users/bob').get()).data().farm.coins,100);
 await assert.rejects(f.admin('adjustPlayerCoins',payload),{code:'failed-precondition'});
 await assert.rejects(f.admin('adjustPlayerCoins',{...payload,expectedCoins:125,delta:-126}),{code:'failed-precondition'});
 await assert.rejects(f.admin('adjustPlayerCoins',{...payload,expectedCoins:125,delta:1000001}),{code:'invalid-argument'});
 const audits=(await f.admin('list',{kind:'audit'})).rows.filter(a=>a.action==='adjustPlayerCoins'&&a.result==='success');
 assert.equal(audits.length,1);assert.equal(audits[0].before.coins,100);assert.equal(audits[0].after.coins,125);assert.equal(audits[0].reason,'補償確認');
 const g=await fixture(),p={...payload,delta:10};const concurrent=await Promise.allSettled([g.admin('adjustPlayerCoins',p),g.admin('adjustPlayerCoins',p)]);
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal((await g.db.doc('groups/A/users/alice').get()).data().farm.coins,110);
});
test('failed coin writes roll back both assets and success audit/receipt, and the same request retries safely',async()=>{
 const f=await fixture();f.db.failAward=true;const req={auth:f.adminAuth,data:{action:'adjustPlayerCoins',payload:{uid:'alice',groupId:'A',delta:5,expectedCoins:100,reason:'重試'},requestId:uid()}};
 await assert.rejects(f.service.adminAPI(req),/simulated/);assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,100);
 assert.equal((await f.db.collection('ops_admin_requests').get()).size,0);assert.equal((await f.service.adminAPI(req)).coins,105);
});
test('editable guard settings affect real player quotes/charges while static model configuration remains unchanged',async()=>{
 const f=await fixture(),balance=await f.admin('gameBalance');assert.equal(balance.chickens.onagadori.buy,6000);assert.equal(balance.guardDogs.breeds.collie.rentable,false);
 const payload={breedId:'collie',dayPrice:300,weekPrice:1500,rentable:true,expectedRevision:0,reason:'開放體驗'};
 await f.admin('saveGuardConfig',payload);const catalog=await guard(f,'catalog');assert.equal(catalog.breeds.collie.dayPrice,300);assert.equal(catalog.breeds.collie.rentable,true);
 const source=await import('../functions/game/guard-dog-core.js');assert.equal(source.GUARD_DOG_BREEDS.collie.rentable,false);assert.equal(source.GUARD_DOG_BREEDS.collie.dayPrice,200);
 const owner=f.db.doc('groups/A/users/alice'),data=(await owner.get()).data();await owner.update({farm:{...data.farm,coins:1000}});
 await assert.rejects(guard(f,'rent',{breedId:'collie',days:1,expectedPrice:200}),{code:'failed-precondition'});
 assert.equal((await owner.get()).data().farm.coins,1000);
 assert.equal((await guard(f,'rent',{breedId:'collie',days:1,expectedPrice:300})).paid,300);assert.equal((await owner.get()).data().farm.coins,700);
 await assert.rejects(f.admin('saveGuardConfig',payload),{code:'failed-precondition'});
 await assert.rejects(f.admin('saveGuardConfig',{...payload,expectedRevision:1,weekPrice:1}),{code:'invalid-argument'});
});
test('settings enforce announcements, redemption and new rentals server-side while paid guards can still activate',async()=>{
 const f=await fixture();await f.admin('saveGift',f.gift());const rented=await guard(f,'rent',{breedId:'beagle',days:1});
 await f.admin('saveSettings',{...DEFAULT_SETTINGS,announcementsEnabled:false,redemptionEnabled:false,guardDogRentalsEnabled:false,pauseMessage:'暫停測試',expectedRevision:0,reason:'系統測試'});
 const feed=await f.service.announcements(f.request());assert.equal(feed.paused,true);assert.deepEqual(feed.rows,[]);
 await assert.rejects(f.service.redeem(f.request()),{code:'failed-precondition'});
 await assert.rejects(guard(f,'rent',{breedId:'pyrenees',days:1}),{code:'failed-precondition'});
 await guard(f,'activate',{id:rented.dogId});assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.guardDogs[0].startedAt,f.now());
 await f.admin('saveSettings',{...DEFAULT_SETTINGS,expectedRevision:1,reason:'恢復服務'});assert.ok((await f.service.redeem(f.request())).redemptionId);
});
test('events atomically publish targeted announcements, protect linked edits and stop delivery when cancelled',async()=>{
 const f=await fixture(),made=await f.admin('saveEvent',event(f,{status:'active',targetType:'accounts',targetAccountIds:['alice'],activityCode:'test-２０２６'}));
 assert.equal((await f.db.collection('ops_events').get()).size,1);
 const alice=await f.service.announcements(f.request()),bob=await f.service.announcements(f.request('bob'));assert.equal(alice.rows.length,1);assert.equal(alice.rows[0].activityCode,'TEST2026');assert.equal(bob.rows.length,0);
 await assert.rejects(f.admin('saveAnnouncement',{...alice.rows[0],id:alice.rows[0].id,title:'不可繞過活動管理'}),{code:'failed-precondition'});
 await f.admin('saveEvent',event(f,{id:made.id,status:'cancelled',expectedRevision:1}));assert.equal((await f.service.announcements(f.request())).rows.length,0);
 const audits=(await f.admin('list',{kind:'audit'})).rows.filter(a=>a.action==='saveEvent');assert.equal(audits.length,2);assert.ok(audits.some(a=>a.after.status==='cancelled'&&a.before.status==='active'));
});
test('event scheduling, expiry, idempotency and stale revisions cannot create duplicate or inconsistent announcements',async()=>{
 const f=await fixture(),payload=event(f,{status:'scheduled',startAt:f.now()+100,endAt:f.now()+200}),req={auth:f.adminAuth,data:{action:'saveEvent',payload,requestId:uid()}};
 const made=await f.service.adminAPI(req);assert.equal((await f.service.adminAPI(req)).replayed,true);assert.equal((await f.db.collection('ops_announcements').get()).size,1);
 assert.equal((await f.service.announcements(f.request())).rows.length,0);f.clock(100000100);assert.equal((await f.service.announcements(f.request())).rows.length,1);
 f.clock(100000200);assert.equal((await f.service.announcements(f.request())).rows.length,0);assert.equal((await f.admin('listEvents')).rows[0].effectiveStatus,'ended');
 await assert.rejects(f.admin('saveEvent',{...payload,id:made.id,expectedRevision:0}),{code:'failed-precondition'});
 assert.equal((await f.db.doc('ops_events/'+made.id).get()).data().revision,1);
});
