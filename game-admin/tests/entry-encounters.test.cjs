const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('./memory-db.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs');
function fixture(){
 const db=new MemoryDB();let stamp=Date.parse('2026-11-16T10:00:00+08:00'),roll=.99;
 const farm={coins:10000,hens:1,hensState:[{id:'h',breed:'hen',laidAt:stamp}],poultryVersion:2,readyEggs:{hen:3,silkie:0,bresse:0,onagadori:0},eggsReady:3,warehouseLimit:100,cleanliness:40,coopLevel:3};
 db.data.set('groups/A',{members:['alice','bob'],farmVillageVisibility:'public'});
 for(const id of ['alice','bob'])db.data.set('groups/A/users/'+id,{farm:structuredClone(farm)});
 const api=createFarmTransactions({db,player:async()=>({uid:'actor',accountId:'alice',groupId:'A'}),now:()=>stamp,random:()=>roll,enabled:()=>true});
 return{db,farm:()=>db.data.get('groups/A/users/alice').farm,roll:n=>roll=n,clock:n=>stamp+=n,send:(action,p={})=>api.handle({auth:{uid:'actor'},data:{groupId:'A',action,requestId:crypto.randomUUID(),...p}})};
}
test('進場清場後連續收蛋只驗證，不因抽怪亂數或上一次收蛋而生成怪物',async()=>{
 const f=fixture();await f.send('homeEncounter');f.roll(0);
 for(let i=1;i<=3;i++){
  f.farm().readyEggs.hen=1;f.farm().eggsReady=1;
  const r=await f.send('homeEncounter',{verifyOnly:true,collectWhenClear:true});
  assert.equal(r.result.kind,null);assert.equal(r.result.harvest.total,1);assert.equal(f.farm().inventoryEggs,i);
 }
});
test('拜訪進場清場後偷蛋不重新抽怪，失效的其他目標許可只能拒絕不能生怪',async()=>{
 const f=fixture(),target={targetGroupId:'A',targetAccountId:'bob'};
 await f.send('visitEncounter',target);f.roll(0);
 const r=await f.send('visitEncounter',{...target,reusePermit:true,verifyOnly:true,stealWhenClear:true});
 assert.equal(r.result.steal.success,true);assert.equal(r.result.challenge,undefined);assert.equal(f.farm().inventoryEggs,1);
 const before=structuredClone(f.farm());await assert.rejects(f.send('homeEncounter',{verifyOnly:true,collectWhenClear:true}),{code:'failed-precondition'});assert.deepEqual(f.farm(),before);
});
test('沒有進場許可時不能用操作驗證抽怪；進場有怪時清潔及抓蟲由後端拒絕',async()=>{
 const f=fixture();f.roll(0);
 await assert.rejects(f.send('homeEncounter',{verifyOnly:true,collectWhenClear:true}),{code:'failed-precondition'});
 const before=structuredClone(f.farm()),r=await f.send('homeEncounter');assert.equal(r.result.kind,'gorilla');
 for(const action of ['cleanOwn','helpClean','searchGarden'])await assert.rejects(f.send(action,{targetGroupId:'A',targetAccountId:'bob'}),{code:'failed-precondition'});
 assert.deepEqual(f.farm(),before);
});
test('沒有待收蛋仍可在進場出現怪物，verifyOnly 必須是布林值',async()=>{
 const f=fixture();f.roll(0);f.farm().readyEggs.hen=0;f.farm().eggsReady=0;
 const r=await f.send('homeEncounter');assert.equal(r.result.kind,'gorilla');
 await assert.rejects(f.send('homeEncounter',{verifyOnly:'true'}),{code:'invalid-argument'});
});
