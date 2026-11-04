const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('./memory-db.cjs');
const {createService}=require('../functions/service.cjs');
const D=require('../functions/domain.cjs');
const {fixture,scenarios,uid}=require('./fixture.cjs');
test('admin Auth claims gate every API; MFA is optional, including reads and writes',async()=>{
    const f=await fixture();await assert.rejects(f.admin('dashboard',{}, {auth:null}),{code:'unauthenticated'});
    await assert.rejects(f.admin('dashboard',{}, {auth:{uid:'alice',token:{role:'player',firebase:{sign_in_second_factor:'totp'}}}}),{code:'permission-denied'});
    const withoutMfa={auth:{uid:'admin',token:{role:'admin'}}};
    assert.equal((await f.admin('dashboard',{},withoutMfa)).players,3);
    assert.ok((await f.admin('saveAnnouncement',f.announcement(),withoutMfa)).id);
    assert.equal((await f.admin('dashboard')).players,3);f.revoke();await assert.rejects(f.admin('dashboard'),{code:'permission-denied'});
});
test('announcements draft, edit, scheduled effectiveness, targets, expiry and archive',async()=>{
    const f=await fixture(),made=await f.admin('saveAnnouncement',f.announcement());
    assert.equal((await f.service.announcements(f.request())).rows.length,0);
    const scheduled=f.announcement({id:made.id,title:'更新公告',status:'scheduled',startAt:f.now()+100,endAt:f.now()+200,targetType:'accounts',targetAccountIds:['alice']});
    await f.admin('saveAnnouncement',scheduled);assert.equal((await f.service.announcements(f.request())).rows.length,0);
    f.clock(100000100);assert.equal((await f.service.announcements(f.request())).rows[0].title,'更新公告');assert.equal((await f.service.announcements(f.request('bob'))).rows.length,0);
    f.clock(100000200);assert.equal((await f.service.announcements(f.request())).rows.length,0);
    await f.admin('saveAnnouncement',{...scheduled,status:'archived'});assert.equal((await f.admin('list',{kind:'announcements',status:'archived',search:'更新'})).rows.length,1);
});
test('atomic awards, idempotent replay, cross-group per-user limit and audit redaction',async()=>{await scenarios(await fixture());});
test('limited and single gift concurrency cannot overspend a global quota',async()=>{
    const f=await fixture(),made=await f.admin('saveGift',f.gift({type:'single'}));
    const results=await Promise.allSettled(['alice','bob','charlie'].map(name=>f.service.redeem(f.request(name))));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.db.doc('ops_gifts/'+made.id).get()).data().redeemedCount,1);
});
test('expired, targeted, inactive and malformed rewards never mutate farm',async()=>{
    const f=await fixture();await f.admin('saveGift',f.gift({type:'targeted',targetAccountIds:['bob']}));
    await assert.rejects(f.service.redeem(f.request()),{code:'permission-denied'});
    f.clock(200000000);await assert.rejects(f.service.redeem(f.request('bob')),{code:'deadline-exceeded'});
    await assert.rejects(f.admin('saveGift',f.gift({code:'OTHER2026',rewards:[{kind:'item',itemKey:'coins',amount:100}]})),{code:'invalid-argument'});
    assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,100);
});
test('award failure and full storage leave quota unused; same request can safely retry',async()=>{
    const f=await fixture(),made=await f.admin('saveGift',f.gift());
    const ref=f.db.doc('groups/A/users/alice'),original=(await ref.get()).data();
    await ref.update({farm:{...original.farm,warehouseLimit:1}});
    const request=f.request();await assert.rejects(f.service.redeem(request),{code:'resource-exhausted'});
    assert.equal((await f.db.doc('ops_gifts/'+made.id).get()).data().redeemedCount,0);
    await ref.update({farm:original.farm});f.db.failAward=true;
    await assert.rejects(f.service.redeem(request),/simulated storage failure/);
    assert.equal((await ref.get()).data().farm.coins,100);assert.equal((await f.db.doc('ops_gifts/'+made.id).get()).data().redeemedCount,0);
    await f.service.redeem(request);assert.equal((await ref.get()).data().farm.coins,600);
});
test('gift create request replay, duplicate codes, disable, input validation and audits',async()=>{
    const f=await fixture(),request={auth:f.adminAuth,data:{action:'saveGift',payload:f.gift(),requestId:uid()}};
    const made=await f.service.adminAPI(request),replay=await f.service.adminAPI(request);assert.equal(made.id,replay.id);assert.equal(replay.code,undefined);
    await assert.rejects(f.admin('saveGift',f.gift()),{code:'already-exists'});
    await f.admin('saveGift',{...made.record,id:made.id,status:'inactive'});await assert.rejects(f.service.redeem(f.request()),{code:'failed-precondition'});
    const audits=(await f.admin('list',{kind:'audit'})).rows;assert.ok(audits.some(a=>a.result==='failed'));assert.ok(audits.some(a=>a.before?.status==='active'&&a.after.status==='inactive'));
});
test('invalid codes are throttled before lookup and no client-supplied rewards are used',async()=>{
    const f=await fixture();for(let i=0;i<10;i++)await assert.rejects(f.service.redeem(f.request('alice','bad')),{code:'invalid-argument'});
    await assert.rejects(f.service.redeem(f.request('alice','bad')),{code:'resource-exhausted'});
});
test('reward catalog disables unsupported chicken rewards and uses existing item schema',async()=>{
    const f=await fixture(),c=await f.admin('catalog');assert.ok(c.chickens.find(b=>b.key==='onagadori'&&!b.enabled));assert.ok(c.items.find(i=>i.key==='sweetPotatoes'));
    assert.throws(()=>D.rewards([{kind:'chicken',breed:'onagadori',amount:1}]),{code:'invalid-argument'});
    assert.equal(D.normalizeCode(' summer-２０２６ '),'SUMMER2026');
});

test('anonymous redemption is denied and forged payload identity/rewards cannot change the award',async()=>{
    const f=await fixture();await f.admin('saveGift',f.gift());
    await assert.rejects(f.service.redeem({data:{groupId:'A',code:'SUMMER2026',requestId:uid()}}),{code:'unauthenticated'});
    const request=f.request();request.data.accountId='bob';request.data.rewards=[{kind:'coins',amount:999999}];await f.service.redeem(request);
    assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,600);assert.equal((await f.db.doc('groups/A/users/bob').get()).data().farm.coins,100);
});
