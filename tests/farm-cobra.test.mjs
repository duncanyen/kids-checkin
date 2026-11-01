import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS_CONFIG as W, hitsToDefeat } from '../js/farm/combat-rules.js';
import { killTotal, killProgressPatch } from '../js/farm/combat-progress.js';
import { nextCobraMilestone, cobraSettlement, COBRA_CONFIG, COBRA_FANG_PRICE } from '../js/farm/cobra-rules.js';
import { getUsedSpace } from '../js/farm/inventory-core.js';
const patchFarm=(farm,patch)=>Object.assign(farm,Object.fromEntries(Object.entries(patch).map(([key,value])=>[key.slice(5),value])));

test('combined kill milestones use the challenger level and persist independently of loot',()=>{
 const farm={coopLevel:2,combatKills:{wolf:35,tiger:34,eagle:30},wolfFangs:1000};
 assert.equal(nextCobraMilestone(farm),null);
 patchFarm(farm,killProgressPatch(farm,'eagle','eagle-1'));
 assert.equal(killTotal(farm),100);assert.equal(nextCobraMilestone(farm),100);
 assert.deepEqual(killProgressPatch(farm,'eagle','eagle-1'),{});
 farm.wolfFangs=0;farm.eagleFeathers=0;assert.equal(killTotal(farm),100);
 assert.equal(nextCobraMilestone({...farm,coopLevel:1}),null);
 farm.cobraLastMilestone=100;assert.equal(nextCobraMilestone(farm),null);
 farm.combatKills.wolf+=200;assert.equal(nextCobraMilestone(farm),200);
 farm.cobraLastMilestone=200;assert.equal(nextCobraMilestone(farm),300);
 farm.cobraLastMilestone=300;assert.equal(nextCobraMilestone(farm),null);
 assert.equal(killTotal({}),0); // Legacy inventories cannot reconstruct historic kills.
 assert.throws(()=>killProgressPatch(farm,'dragon','x'));
});
test('all six weapons take the requested exact numbers of hits',()=>{
 for(const [key,hits] of Object.entries({club:500,mace:300,battleaxe:200,shortbow:60,huntingbow:40,paladinbow:20}))assert.equal(hitsToDefeat(W[key],'cobra'),hits,key);
 assert.equal(COBRA_CONFIG.durationMs,50000);assert.equal(COBRA_FANG_PRICE,600);
});
test('victory awards one fang even with a full warehouse and repeated settlement is inert',()=>{
 const challenge={id:'fight',milestone:100,deadline:50000};
 const farm={coins:90,inventoryEggs:10,warehouseLimit:10,cobraChallenge:challenge};
 const {patch,result}=cobraSettlement(farm,challenge,'win',49999);
 patchFarm(farm,patch);assert.equal(result.outcome,'win');assert.equal(farm.cobraFangs,1);assert.equal(farm.coins,90);
 assert.equal(getUsedSpace(farm),11);assert.equal(farm.cobraChallenge,null);
 assert.deepEqual(cobraSettlement(farm,challenge,'win',49999).patch,{});
 assert.deepEqual(cobraSettlement(farm,challenge,'loss',60000).patch,{});
});
test('timeout overrides late wins, deducts only available coins and changes no hens or eggs',()=>{
 const challenge={id:'fight',milestone:200,deadline:50000};
 for(const coins of [0,50,199,200,300]){
  const farm={coins,hens:2,eggsReady:4,inventoryEggs:6,cobraChallenge:challenge};
  const {patch,result}=cobraSettlement(farm,challenge,'win',50000);
  patchFarm(farm,patch);assert.equal(result.outcome,'loss');assert.equal(result.coinsLost,Math.min(coins,200));
  assert.equal(farm.coins,Math.max(0,coins-200));assert.equal(farm.hens,2);assert.equal(farm.eggsReady,4);assert.equal(farm.inventoryEggs,6);assert.equal(farm.cobraFangs,undefined);
 }
 assert.throws(()=>cobraSettlement({cobraChallenge:{id:'other'}},challenge,'win',0));
});
