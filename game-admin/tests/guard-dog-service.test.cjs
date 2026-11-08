const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,uid}=require('./fixture.cjs');
const request=(f,action,payload={},id=uid())=>({...f.request(),data:{groupId:'A',action,...payload,requestId:id}});
test('server rejects closed collie even with forged price/availability and leaves coins/leases/receipts untouched',async()=>{
 const f=await fixture(),before=(await f.db.doc('groups/A/users/alice').get()).data();
 const client=await import('../../js/farm/guard-dog-core.js');
 const original=client.GUARD_DOG_BREEDS.collie.rentable;client.GUARD_DOG_BREEDS.collie.rentable=true;
 try{await assert.rejects(f.service.guardDog(request(f,'rent',{breedId:'collie',days:1,price:0,rentable:true})),{code:'failed-precondition'});}
 finally{client.GUARD_DOG_BREEDS.collie.rentable=original;}
 assert.deepEqual((await f.db.doc('groups/A/users/alice').get()).data(),before);
 assert.equal((await f.db.collection('ops_guard_requests').get()).size,0);
});
test('trusted rental uses canonical price and identity, is atomic/idempotent, and preserves existing activation/release rules',async()=>{
 const f=await fixture(),req=request(f,'rent',{breedId:'pyrenees',days:1,price:0,accountId:'bob'});
 const first=await f.service.guardDog(req);assert.equal(first.paid,80);
 assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,20);
 assert.equal((await f.db.doc('groups/A/users/bob').get()).data().farm.coins,100);
 assert.equal((await f.service.guardDog(req)).replayed,true);
 await assert.rejects(f.service.guardDog(request(f,'rent',{breedId:'pyrenees',days:1})),{code:'failed-precondition'});
 await f.service.guardDog(request(f,'activate',{id:first.dogId,expiresAt:9999999999999}));
 let farm=(await f.db.doc('groups/A/users/alice').get()).data().farm;
 assert.equal(farm.guardDogs[0].startedAt,f.now());assert.equal(farm.guardDogs[0].expiresAt,f.now()+86400000);
 await f.service.guardDog(request(f,'rent',{breedId:'beagle',days:1}));
 const waiting=(await f.db.doc('groups/A/users/alice').get()).data().farm.guardDogs.find(d=>d.breedId==='beagle');
 await assert.rejects(f.service.guardDog(request(f,'activate',{id:waiting.id})),{code:'failed-precondition'});
 await f.service.guardDog(request(f,'release',{id:first.dogId}));
 await f.service.guardDog(request(f,'activate',{id:waiting.id}));
 assert.equal((await f.db.doc('groups/A/users/alice').get()).data().keep,'unchanged');
 await f.service.guardDog(req);assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.guardDogs.length,1,'replayed rent cannot recreate a released dog');
});
test('concurrent rental, insufficient coins, failed writes and unauthenticated/group-mismatched requests cannot create free leases',async()=>{
 const f=await fixture();
 const results=await Promise.allSettled([f.service.guardDog(request(f,'rent',{breedId:'pyrenees',days:1})),f.service.guardDog(request(f,'rent',{breedId:'pyrenees',days:1}))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,20);
 await assert.rejects(f.service.guardDog(request(f,'rent',{breedId:'pyrenees',days:7})),{code:'failed-precondition'});
 const anonymous=request(f,'rent',{breedId:'beagle',days:1});delete anonymous.auth;await assert.rejects(f.service.guardDog(anonymous),{code:'unauthenticated'});
 const wrongGroup=request(f,'rent',{breedId:'beagle',days:1});wrongGroup.data.groupId='B';await assert.rejects(f.service.guardDog(wrongGroup),{code:'permission-denied'});
 const failure=await fixture();failure.db.failAward=true;
 const req=request(failure,'rent',{breedId:'beagle',days:1});await assert.rejects(failure.service.guardDog(req),/simulated storage failure/);
 assert.equal((await failure.db.doc('groups/A/users/alice').get()).data().farm.coins,100);
 assert.equal((await failure.db.collection('ops_guard_requests').get()).size,0);
 await failure.service.guardDog(req);assert.equal((await failure.db.doc('groups/A/users/alice').get()).data().farm.coins,80);
});
test('closing rentals preserves previously rented collies and server-side expiry never refunds or extends them',async()=>{
 const f=await fixture(),ref=f.db.doc('groups/A/users/alice'),data=(await ref.get()).data();
 await ref.update({farm:{...data.farm,guardDogs:[{id:'legacy-collie',breedId:'collie',days:1,paid:200000,rentedAt:f.now()-100,startedAt:null,expiresAt:null}]}});
 await f.service.guardDog(request(f,'activate',{id:'legacy-collie'}));
 const dog=(await ref.get()).data().farm.guardDogs[0];assert.equal(dog.paid,200000);
 f.clock(dog.expiresAt);await f.service.guardDog(request(f,'expire'));
 const after=(await ref.get()).data().farm;assert.deepEqual(after.guardDogs,[]);assert.equal(after.coins,100);
});
