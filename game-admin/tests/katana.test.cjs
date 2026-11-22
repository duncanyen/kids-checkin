const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const D=require('../functions/domain.cjs'),{MemoryDB}=require('./memory-db.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs');
function setup(){
 const db=new MemoryDB(),stamp=Date.now(),actor={uid:'profile',groupId:'A',accountId:'alice'};
 const farm={coins:1000000,hens:1,hensState:[{id:'h',breed:'hen',laidAt:stamp}],poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,coopLevel:3,warehouseLimit:100,cleanliness:0};
 db.data.set('groups/A',{members:['alice'],farmVillageVisibility:'public'});db.data.set('groups/A/users/alice',{farm});
 const api=createFarmTransactions({db,player:async()=>actor,now:()=>stamp,random:()=>.99,enabled:()=>true});
 const req=(action,data={})=>({auth:{uid:'profile'},data:{action,groupId:'A',requestId:crypto.randomUUID(),...data}});
 return{db,api,req,stamp,farm:()=>db.data.get('groups/A/users/alice').farm};
}
test('server katana purchase/equip/unequip/sale are priced by the trusted catalog and idempotent',async()=>{
 const f=setup(),purchase=f.req('buyWeapon',{item:'katana',quantity:1,price:1});await f.api.handle(purchase);assert.equal(f.farm().coins,500000);assert.equal(f.farm().katana,1);
 await f.api.handle(purchase);assert.equal(f.farm().katana,1);assert.equal(f.farm().coins,500000);
 await f.api.handle(f.req('equipWeapon',{item:'katana',currentlyEquipped:false}));assert.equal(f.farm().equippedWeapon,'katana');
 await assert.rejects(f.api.handle(f.req('sellItem',{item:'katana',quantity:1})),/卸下/);
 await f.api.handle(f.req('equipWeapon',{item:'katana',currentlyEquipped:true}));assert.equal(f.farm().equippedWeapon,'club');
 const sell=f.req('sellItem',{item:'katana',quantity:1,price:999999});await f.api.handle(sell);assert.equal(f.farm().coins,515000);assert.equal(f.farm().katana,0);await f.api.handle(sell);assert.equal(f.farm().coins,515000);
 await assert.rejects(f.api.handle(f.req('equipWeapon',{item:'katana',currentlyEquipped:false})),/倉庫/);
});
test('insufficient coins and full storage cannot debit or grant a katana',async()=>{
 const f=setup();f.farm().coins=499999;await assert.rejects(f.api.handle(f.req('buyWeapon',{item:'katana',quantity:1})),/金幣不足/);assert.equal(f.farm().coins,499999);assert.equal(f.farm().katana,undefined);
 f.farm().coins=1000000;f.farm().worms=100;await assert.rejects(f.api.handle(f.req('buyWeapon',{item:'katana',quantity:1})),/容量不足/);assert.equal(f.farm().coins,1000000);assert.equal(f.farm().katana,undefined);
});
test('actual backend attack and settlement require exactly the requested katana hits for each ground monster',async()=>{
 const {CONFIG}=require('../functions/farm-combat.cjs');
 for(const [kind,hits]of Object.entries({wolf:1,tiger:1,mole:50,cobra:40,gorilla:10,giant:50})){
  const f=setup(),id='katana-'+kind,challenge={id,kind,groupId:'A',targetGroupId:'A',targetAccountId:'alice',startedAt:f.stamp-4000,approachEndsAt:f.stamp-1,deadline:f.stamp+60000,health:CONFIG[kind].health,attacks:{melee:0,ranged:0},milestone:50};
  f.farm().katana=1;f.farm().equippedWeapon='katana';if(['mole','cobra','giant'].includes(kind))f.farm()[kind+'Challenge']=challenge;
  f.db.data.set('ops_farm_active/'+D.hash('profile:A'),challenge);
  if(hits>1){const partial=await f.api.handle(f.req('battleAttack',{battleId:id,mode:'melee',count:hits-1}));assert.ok(partial.result.health>0,kind+' must survive one hit short');}
  const hit=f.req('battleAttack',{battleId:id,mode:'melee',count:1}),done=await f.api.handle(hit);assert.equal(done.result.health,0,kind);await f.api.handle(hit);
  const settled=await f.api.handle(f.req('battleSettle',{battleId:id}));assert.equal(settled.result.outcome,'win',kind);const item=CONFIG[kind].item;assert.equal(f.farm()[item],1);
  await f.api.handle(f.req('battleSettle',{battleId:id}));assert.equal(f.farm()[item],1);
 }
 for(const kind of ['dragon','eagle']){const f=setup();f.farm().katana=1;f.farm().equippedWeapon='katana';f.db.data.set('ops_farm_active/'+D.hash('profile:A'),{id:'flying',kind,groupId:'A',targetGroupId:'A',targetAccountId:'alice',startedAt:f.stamp-4000,deadline:f.stamp+60000,health:CONFIG[kind].health,attacks:{melee:0,ranged:0}});await assert.rejects(f.api.handle(f.req('battleAttack',{battleId:'flying',mode:'melee',count:1})),/無法攻擊/);}
});
test('existing operations reward and chest catalogs recognize the new weapon using its actual item ID',async()=>{
 assert.equal(D.rewards([{kind:'item',itemKey:'katana',amount:1}])[0].itemKey,'katana');assert.equal(D.ITEM_NAMES.katana,'武士刀');
 const product=(await require('../functions/chests.cjs').catalog()).find(item=>item.id==='katana');assert.equal(product.name,'武士刀');assert.equal(product.enabled,true);
 const f=await require('./fixture.cjs').fixture(),balance=await f.admin('gameBalance');assert.equal(balance.weapons.katana.buyPrice,500000);assert.equal(balance.weapons.katana.sellPrice,15000);
 assert.deepEqual(balance.weaponHitCounts.katana,{wolf:1,tiger:1,dragon:null,gorilla:10,eagle:null,cobra:40,mole:50,giant:50});
});
