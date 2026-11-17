import test from 'node:test';
import assert from 'node:assert/strict';
import {battleRewardView,BATTLE_REWARDS} from '../js/farm/battle-reward.js';
test('all monster views use committed reward IDs and quantities; failure never becomes a victory',()=>{
 for(const [kind,item] of Object.entries(BATTLE_REWARDS)){
  const original={id:'battle-'+kind,outcome:'win',monster:kind,inventoryUpdated:true,rewards:[{itemId:item.item,quantity:1}]};
  const before=structuredClone(original),view=battleRewardView(original,kind);
  assert.equal(view.monsterName,item.name);assert.deepEqual(view.loot,[{itemId:item.item,name:item.itemName,quantity:1,icon:item.icon}]);assert.deepEqual(original,before);
  assert.equal(battleRewardView({...original,outcome:'loss'},kind),null);
  assert.equal(battleRewardView({...original,monster:'unknown'},kind),null);
 }
});
test('inventory confirmation overrides capacity and legacy guesses, including successful victory without loot',()=>{
 const noSpace=battleRewardView({id:'full',outcome:'win',hasSpace:false,inventoryUpdated:false,rewards:[]},'wolf');
 assert.equal(noSpace.inventoryUpdated,false);assert.deepEqual(noSpace.loot,[]);
 const unconfirmed=battleRewardView({id:'unknown',outcome:'win'},'eagle');assert.deepEqual(unconfirmed.loot,[]);
 assert.equal(battleRewardView({id:'old-backend',outcome:'win',hasSpace:true},'eagle').loot[0].quantity,1);
 assert.equal(battleRewardView({id:'legacy',outcome:'win'},'eagle',{legacyInventoryConfirmed:true}).inventoryUpdated,true);
});
test('future multi-item receipt uses real quantities and handles missing art/name without changing inventory',()=>{
 const view=battleRewardView({id:'multi',outcome:'win',inventoryUpdated:true,rewards:[{itemId:'eagleFeathers',quantity:2},{itemId:'wolfFangs',quantity:3},{itemId:'missing',itemName:'長名稱',quantity:12345}]},'eagle');
 assert.deepEqual(view.loot.map(row=>row.quantity),[2,3,12345]);assert.equal(view.loot[2].name,'長名稱');assert.equal(view.loot[2].icon,undefined);
 assert.throws(()=>battleRewardView({id:'bad',outcome:'win',inventoryUpdated:true,rewards:[{itemId:'eagleFeathers',quantity:-1}]},'eagle'));
});
