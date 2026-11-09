const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixture.cjs');

test('dashboard counts actual records with inclusive start and exclusive end times',async()=>{
    const f=await fixture(),stamp=f.now();
    const windows=[
        {startAt:stamp-20,endAt:stamp+10},
        {startAt:stamp,endAt:stamp+10},
        {startAt:stamp-20,endAt:stamp},
        {startAt:stamp+1,endAt:stamp+10},
        {startAt:stamp-20,endAt:stamp+10},
        {startAt:stamp-20,endAt:stamp+10}
    ];
    for(let i=0;i<windows.length;i++){
        await f.db.doc('ops_announcements/a'+i).set({...windows[i],status:['published','scheduled','published','scheduled','draft','archived'][i]});
        await f.db.doc('ops_gifts/g'+i).set({...windows[i],status:['active','active','active','active','draft','inactive'][i]});
    }
    for(const [id,result] of [['a','success'],['b','success'],['c','failed']])await f.db.doc('ops_redemptions/'+id).set({result});
    const data=await f.admin('dashboard');
    assert.deepEqual([data.players,data.announcementCount,data.activeAnnouncements,data.giftCount,data.activeGifts,data.redemptionCount],[3,6,2,6,2,2]);
    assert.equal(data.asOf,stamp);assert.deepEqual(data.recent,[]);
});

test('dashboard time queries use the range ordering declared by the deployment indexes',async t=>{
    const f=await fixture(),proto=Object.getPrototypeOf(f.db.collection('ops_announcements')),count=proto.count;
    const seen=[];
    t.mock.method(proto,'count',function(){
        if(this.filters.some(([field])=>field==='startAt')){
            assert.deepEqual(this.sorts.map(([field])=>field),['startAt','endAt']);
            seen.push(this.path);
        }
        return count.call(this);
    });
    await f.admin('dashboard');assert.deepEqual(seen.sort(),['ops_announcements','ops_gifts']);
});

for(const [collection,metric] of [['ops_announcements','有效公告'],['ops_gifts','有效禮包']]){
    test(`missing ${collection} dashboard index has a useful error and safe diagnostics`,async t=>{
        const f=await fixture(),proto=Object.getPrototypeOf(f.db.collection(collection)),count=proto.count;
        const error=Object.assign(Error('The query requires an index. PRIVATE_DIAGNOSTIC_MUST_NOT_BE_LOGGED'),{code:9});
        const logs=t.mock.method(console,'error',()=>{});
        t.mock.method(proto,'count',function(){
            return this.path===collection&&this.filters.some(([field])=>field==='startAt')?{get:async()=>{throw error;}}:count.call(this);
        });
        await assert.rejects(f.admin('dashboard'),e=>e.code==='failed-precondition'&&e.message.includes(metric)&&e.message.includes('READY'));
        assert.deepEqual(logs.mock.calls[0].arguments,['game-ops-dashboard-query-failed',{metric,code:9,indexMissing:true}]);
        assert.ok(!JSON.stringify(logs.mock.calls).includes('PRIVATE_DIAGNOSTIC'));
    });
}

test('other database failures are propagated, never reported as zero or as missing indexes',async t=>{
    const f=await fixture(),proto=Object.getPrototypeOf(f.db.collection('users')),count=proto.count;
    const error=Object.assign(Error('service unavailable'),{code:14}),logs=t.mock.method(console,'error',()=>{});
    t.mock.method(proto,'count',function(){return this.path==='users'?{get:async()=>{throw error;}}:count.call(this);});
    await assert.rejects(f.admin('dashboard'),e=>e===error);
    assert.deepEqual(logs.mock.calls[0].arguments,['game-ops-dashboard-query-failed',{metric:'玩家總數',code:14,indexMissing:false}]);
});
