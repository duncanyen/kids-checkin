const {test}=require('node:test'),assert=require('node:assert/strict');
const {MemoryDB}=require('./memory-db.cjs');
const D=require('../functions/domain.cjs');
const {createFarmTransactions}=require('../functions/farm-transactions.cjs');
function fixture(){
 const db=new MemoryDB(),stamp=1700000000000;
 db.data.set('groups/A',{members:['alice','bob']});
 db.data.set('groups/A/users/alice',{keep:'same',farm:{coins:10000,hens:0,hensState:[],poultryVersion:2,readyEggs:{hen:3,silkie:0,bresse:0,onagadori:0},eggsReady:3,warehouseLimit:100,cleanliness:0}});
 db.data.set('groups/A/users/bob',{farm:{...structuredClone(db.data.get('groups/A/users/alice').farm),coins:0,cleanliness:40}});
 const player=async request=>{if(!request.auth)throw Object.assign(Error(),{code:'unauthenticated'});return{uid:'profile',accountId:'alice',groupId:'A'};};
 db.data.set('ops_farm_active/'+D.hash('profile:A'),{targetGroupId:'A',targetAccountId:'alice',harvestPermit:true,result:{outcome:'clear'}});
 const service=createFarmTransactions({db,player,now:()=>stamp,random:()=>1,enabled:()=>true});
 const req=(action,more={})=>({auth:{uid:'server-checked'},data:{action,requestId:crypto.randomUUID(),...more}});
 const farm=()=>db.data.get('groups/A/users/alice').farm;
 return{db,service,req,farm,player};
}
test('server prices ignore forged wallet and price; identical request is exactly once',async()=>{
 const f=fixture(),req=f.req('buyMedicine',{quantity:2,price:0,coins:999999,accountId:'bob'});
 await Promise.all([f.service.handle(req),f.service.handle(req)]);
 assert.equal(f.farm().coins,9980);assert.equal(f.farm().medicines,2);
 assert.equal(f.db.data.get('groups/A/users/alice').keep,'same');
 await assert.rejects(f.service.handle({...req,data:{...req.data,quantity:3}}),{code:'already-exists'});
});
test('empty harvest cannot generate mission progress; valid harvest creates one immutable operation',async()=>{
 const f=fixture(),req=f.req('collectEggs');
 const result=await f.service.handle(req);assert.equal(result.result.total,3);
 await f.service.handle(req);
 assert.equal((await f.db.collection('ops_verified_farm_events').get()).size,1);
 await assert.rejects(f.service.handle(f.req('collectEggs')),{code:'failed-precondition'});
 assert.equal(f.farm().inventoryEggs,3);
});
test('help cleaning rejects self/private group/zero dirt and atomically modifies both farms',async()=>{
 const f=fixture();
 await assert.rejects(f.service.handle(f.req('helpClean',{targetGroupId:'A',targetAccountId:'alice'})),{code:'invalid-argument'});
 f.db.data.set('groups/B',{members:['bob'],farmVillageVisibility:'closed'});
 await assert.rejects(f.service.handle(f.req('helpClean',{targetGroupId:'B',targetAccountId:'bob'})),{code:'permission-denied'});
 const req=f.req('helpClean',{targetGroupId:'A',targetAccountId:'bob'});
 f.db.failAward=true;await assert.rejects(f.service.handle(req),/simulated storage failure/);
 assert.equal(f.db.data.get('groups/A/users/bob').farm.cleanliness,40);
 assert.equal((await f.db.collection('ops_farm_transactions').get()).size,0);
 await f.service.handle(req);assert.equal(f.db.data.get('groups/A/users/bob').farm.cleanliness,10);
 await f.service.handle(f.req('helpClean',{targetGroupId:'A',targetAccountId:'bob'}));
 await assert.rejects(f.service.handle(f.req('helpClean',{targetGroupId:'A',targetAccountId:'bob'})),{code:'failed-precondition'});
});
test('insufficient coins, invalid quantity and disabled cutover leave resources unchanged',async()=>{
 const f=fixture(),before=structuredClone(f.farm());
 await assert.rejects(f.service.handle(f.req('buyMedicine',{quantity:1001})),{code:'invalid-argument'});
 await assert.rejects(f.service.handle(f.req('expandWarehouse',{quantity:101})),{code:'failed-precondition'});
 const disabled=createFarmTransactions({db:f.db,player:f.player});
 await assert.rejects(disabled.handle(f.req('collectEggs')),{code:'failed-precondition'});
 assert.deepEqual(f.farm(),before);
});
test('poultry transaction reuses canonical Japanese breed economy and safe capacity checks',async()=>{
 const f=fixture();await f.service.handle(f.req('tradePoultry',{breed:'onagadori',quantity:1,direction:'buy',price:0}));
 assert.equal(f.farm().coins,4000);assert.equal(f.farm().hensState[0].breed,'onagadori');
 await f.service.handle(f.req('tradePoultry',{breed:'onagadori',quantity:1,direction:'sell'}));assert.equal(f.farm().coins,7000);
});
test('warehouse operations validate ownership, unequip discarded last weapon and charge medicine once',async()=>{
 const f=fixture();Object.assign(f.farm(),{mace:1,equippedWeapon:'club',medicines:1,hens:1,hensState:[{id:'hen1',breed:'hen',laidAt:1700000000000,isSick:true,sickTimestamp:1700000000000}],readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0});
 await f.service.handle(f.req('equipWeapon',{item:'mace',currentlyEquipped:false}));assert.equal(f.farm().equippedWeapon,'mace');
 await assert.rejects(f.service.handle(f.req('equipWeapon',{item:'mace',currentlyEquipped:false})),{code:'failed-precondition'});
 await f.service.handle(f.req('discardItem',{item:'mace'}));assert.equal(f.farm().mace,0);assert.equal(f.farm().equippedWeapon,'club');
 await assert.rejects(f.service.handle(f.req('discardItem',{item:'coins'})),{code:'invalid-argument'});
 const treat=f.req('treatHen',{henId:'hen1'});await f.service.handle(treat);await f.service.handle(treat);
 assert.equal(f.farm().medicines,0);assert.equal(f.farm().hensState[0].isSick,false);
 await assert.rejects(f.service.handle(f.req('treatHen',{henId:'hen1'})),/無需消耗藥品/);
});
test('all existing sellable drops use canonical server prices',async()=>{
 const f=fixture(),prices={ancientStones:600,sweetPotatoes:300,cobraFangs:600,eagleFeathers:300,worms:1,earthworms:3,wolfFangs:20,tigerPelts:50,dragonScales:200,gorillaFangs:300};
 let coins=f.farm().coins;
 for(const [item,price]of Object.entries(prices)){
  f.farm()[item]=1;await f.service.handle(f.req('sellItem',{item,quantity:1,unitPrice:999999}));coins+=price;assert.equal(f.farm().coins,coins);
 }
});
