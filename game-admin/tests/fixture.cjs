const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('./memory-db.cjs');
const {createService}=require('../functions/service.cjs');
const uid=()=>crypto.randomUUID();
const farm=()=>({coins:100,hens:1,hensState:[{id:'h',breed:'hen',laidAt:100000000}],poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0},eggsReady:0,warehouseLimit:100,inventoryEggs:0,worms:0,coopLevel:2,cleanliness:0});
async function fixture(db=new MemoryDB()){
    let stamp=100000000,revoked=false;
    const auth={getUser:async user=>({uid:user,disabled:false,customClaims:{role:revoked?'player':'admin'}})};
    for(const name of ['alice','bob','charlie'])await db.doc(`users/${name}`).set({accountId:name,name,role:'child'});
    await db.doc('groups/A').set({members:['alice','bob','charlie']});
    await db.doc('groups/B').set({members:['alice']});
    for(const name of ['alice','bob','charlie'])await db.doc(`groups/A/users/${name}`).set({farm:farm(),keep:'unchanged'});
    await db.doc('groups/B/users/alice').set({farm:farm()});
    const service=createService({db,auth,now:()=>stamp});
    const adminAuth={uid:'admin',token:{role:'admin',firebase:{sign_in_second_factor:'totp'}}};
    const admin=(action,payload={},extra={})=>service.adminAPI({auth:adminAuth,data:{action,payload,requestId:uid()},...extra});
    const request=(name='alice',code='SUMMER2026',requestId=uid(),groupId='A')=>({auth:{uid:name,token:{photoAccountId:name,photoGroupId:groupId}},data:{groupId,code,requestId}});
    const gift=(patch={})=>({name:'農場禮包',description:'測試',type:'universal',code:'SUMMER2026',rewards:[{kind:'coins',amount:500},{kind:'eggs',breed:'hen',amount:2},{kind:'item',itemKey:'worms',amount:3},{kind:'chicken',breed:'hen',amount:1}],maxRedemptions:null,maxRedemptionsPerUser:1,targetAccountIds:[],startAt:stamp-1000,endAt:stamp+100000,status:'active',...patch});
    const announcement=(patch={})=>({title:'村落公告',content:'安全純文字 <img src=x onerror=alert(1)>',type:'general',priority:10,targetType:'all',targetAccountIds:[],startAt:stamp-100,endAt:stamp+10000,showPopup:true,status:'draft',...patch});
    return{db,service,admin,adminAuth,request,gift,announcement,clock:value=>stamp=value,revoke:()=>revoked=true,now:()=>stamp};
}
// Exposed for the Emulator suite; these exact checks run against the Admin SDK too.
async function scenarios(f){
    const made=await f.admin('saveGift',f.gift());assert.equal(made.code,'SUMMER2026');assert.equal(made.record.codeHash,undefined);
    const request=f.request(),success=await f.service.redeem(request);
    assert.equal(success.rewards.length,4);assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,600);
    assert.equal((await f.db.doc('groups/A/users/alice').get()).data().keep,'unchanged');
    const replay=await f.service.redeem(request);assert.equal(replay.replayed,true);assert.equal((await f.db.doc('groups/A/users/alice').get()).data().farm.coins,600);
    await assert.rejects(f.service.redeem(f.request()),{code:'already-exists'});
    await assert.rejects(f.service.redeem(f.request('alice','SUMMER2026',uid(),'B')),{code:'already-exists'});
    await assert.rejects(f.service.redeem({...f.request('bob'),auth:{uid:'bob',token:{photoAccountId:'alice',photoGroupId:'A'}}}),{code:'permission-denied'});
    const logs=await f.admin('list',{kind:'redemptions'});assert.ok(logs.rows.some(r=>r.result==='failed'));assert.equal(logs.rows.filter(r=>r.result==='success').length,1);
    const raw=JSON.stringify((await f.db.collection('ops_audit').get()).docs.map(d=>d.data()));assert.ok(!raw.includes('SUMMER2026'));assert.ok(!raw.includes('codeHash'));
    return made;
}

module.exports={fixture,scenarios,uid};
