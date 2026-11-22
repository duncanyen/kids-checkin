import test from 'node:test';
import assert from 'node:assert/strict';
import {WEAPONS_CONFIG as W,ENEMY_HEALTH,hitsToDefeat,weaponDamage} from '../js/farm/combat-rules.js';
import {HORNET_CONFIG as C,HONEY_PRICE,hornetPosition} from '../js/farm/hornet-core.js';
import {getUsedSpace} from '../js/farm/inventory-core.js';
import {farmActionsBlocked} from '../js/farm/entry-encounter.js';
import {battleRewardView} from '../js/farm/battle-reward.js';
test('hornet bow hits are exactly 30/20/10, every melee weapon is ineffective and reward uses original inventory',()=>{
 assert.equal(ENEMY_HEALTH.hornet,600);assert.equal(C.health,600);assert.equal(C.durationMs,50000);assert.equal(C.flightMs,10000);assert.equal(C.coinPenalty,100);assert.equal(HONEY_PRICE,300);
 for(const [id,hits]of [['shortbow',30],['huntingbow',20],['paladinbow',10]])assert.equal(hitsToDefeat(W[id],'hornet'),hits);
 for(const id of ['club','mace','battleaxe','ironhammer','katana'])assert.equal(weaponDamage(W[id],'hornet'),0);
 assert.equal(getUsedSpace({honey:2,worms:3}),5);assert.equal(farmActionsBlocked({entryChecked:true,hornetEncounter:{destroyed:false,settled:false}}),true);
 const v=battleRewardView({id:'h',outcome:'win',monster:'hornet',inventoryUpdated:true,rewards:[{itemId:'honey',quantity:1}]},'hornet');assert.equal(v.monsterName,'虎頭蜂');assert.equal(v.loot[0].name,'蜂蜜');assert.equal(v.loot[0].icon,'honey');
});
test('hornet visual route enters quickly from lower right, circles above coop, feints every five seconds and stays in bounds',()=>{
 const context={coop:{x:195,top:230,bottom:380},view:{left:0,right:390,top:0,bottom:844},hen:{x:150,y:470}};
 assert.deepEqual(hornetPosition(0,{...context,view:{left:0,top:0,width:390,height:844}}),hornetPosition(0,context));
 const start=hornetPosition(0,context);assert.equal(start.x,374);assert.equal(start.y,804);
 const approach=hornetPosition(1000,context),arrived=hornetPosition(2000,context);assert.ok(approach.y<300);assert.equal(arrived.phase,'hover');assert.equal(arrived.y,200);
 for(const t of [14500,19500,24500,29500,34500,39500,44500,49500]){const p=hornetPosition(t,context);assert.equal(p.phase,'dive');assert.ok(p.y>400);}
 assert.equal(hornetPosition(15000,context).phase,'hover');
 const positions=Array.from({length:500},(_,i)=>hornetPosition(i*100,context));assert.ok(positions.every(p=>p.x>=0&&p.x<=390&&p.y>=0&&p.y<=844));assert.ok(hornetPosition(5000,context).x!==hornetPosition(7000,context).x);
});
