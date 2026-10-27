import test from 'node:test';
import assert from 'node:assert/strict';
import {WEAPONS_CONFIG as W,hitsToDefeat,equippedBow,weaponDamage} from '../js/farm/combat-rules.js';
import {rollHomeBossEncounter,rollVisitBossEncounter} from '../js/farm/gorilla-rules.js';
import {launchVelocity,arrowPoint,arrowHits} from '../js/farm/archery-core.js';
test('flying enemies require owned equipped bows with exact hit counts',()=>{
 for(const key of ['club','mace','battleaxe'])for(const enemy of ['eagle','dragon'])assert.equal(weaponDamage(W[key],enemy),0);
 assert.equal(hitsToDefeat(W.shortbow,'dragon'),20);assert.equal(hitsToDefeat(W.huntingbow,'dragon'),10);
 assert.equal(hitsToDefeat(W.shortbow,'eagle'),10);assert.equal(hitsToDefeat(W.huntingbow,'eagle'),5);
 assert.equal(equippedBow({shortbow:1}),null);assert.equal(equippedBow({equippedBow:'shortbow',shortbow:0}),null);
 assert.equal(equippedBow({equippedBow:'shortbow',shortbow:1}),W.shortbow);
 for(const key of ['shortbow','huntingbow'])for(const enemy of ['wolf','tiger','gorilla'])assert.equal(weaponDamage(W[key],enemy),0);
});
test('exclusive exact odds on home and visited coops, eagle never below lv3',()=>{
 for(const roll of [rollHomeBossEncounter,rollVisitBossEncounter]){
  for(const level of [1,2,3,4]){
   const count={eagle:0,dragon:0,gorilla:0,none:0};let total;
   roll(level,(_,max)=>{total=max;return max;});
   if(!total){assert.equal(level,1);continue;}
   for(let i=1;i<=total;i++)count[roll(level,()=>i)||'none']++;
   assert.equal(count.eagle/total,level>=3?1/20:0);
   assert.equal(count.gorilla/total,level>=3?1/30:0);
   assert.equal(count.dragon/total,roll===rollHomeBossEncounter?1/20:1/30);
  }
 }
});
test('drag direction, capped power, gravity, swept collision and misses',()=>{
 assert.equal(launchVelocity({x:0,y:0},{x:0,y:5}),null);
 const v=launchVelocity({x:195,y:730},{x:195,y:830});assert.deepEqual(v,{x:0,y:-900});
 assert.equal(Math.hypot(...Object.values(launchVelocity({x:0,y:0},{x:0,y:500}))),1050);
 assert.deepEqual(arrowPoint({x:195,y:730},v,1),{x:195,y:10});
 const bounds={centerX:200,centerY:200,width:100,height:100};
 assert.equal(arrowHits({x:0,y:200},{x:400,y:200},bounds),true);
 assert.equal(arrowHits({x:0,y:140},{x:400,y:140},bounds),false);
});
