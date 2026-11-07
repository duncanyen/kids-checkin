import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WEAPONS_CONFIG as W,hitsToDefeat} from '../js/farm/combat-rules.js';
import {GIANT_CONFIG,ANCIENT_STONE_PRICE,giantKillTotal,nextGiantMilestone,giantSettlement} from '../js/farm/giant-rules.js';
import {killProgressPatch} from '../js/farm/combat-progress.js';
import {getUsedSpace} from '../js/farm/inventory-core.js';
const apply=(f,p)=>Object.assign(f,Object.fromEntries(Object.entries(p).map(([k,v])=>[k.slice(5),v])));
test('giant uses own Lv.3 and every 50 actual wolf/tiger wins; eagles and sold loot do not count',()=>{
 const f={coopLevel:3,combatKills:{wolf:24,tiger:25,eagle:500},wolfFangs:1000};
 assert.equal(giantKillTotal(f),49);assert.equal(nextGiantMilestone(f),null);
 apply(f,killProgressPatch(f,'tiger','tiger50'));assert.equal(nextGiantMilestone(f),50);
 assert.deepEqual(killProgressPatch(f,'tiger','tiger50'),{});
 assert.equal(nextGiantMilestone({...f,coopLevel:2}),null);
 for(const milestone of [50,100,150,200]){f.combatKills.wolf=200;assert.equal(nextGiantMilestone(f),milestone);f.giantLastMilestone=milestone;}
 assert.equal(nextGiantMilestone({coopLevel:3,wolfFangs:500,tigerPelts:500}),null);
});
test('all seven requested weapon hit counts are exact',()=>{
 for(const [key,hits]of Object.entries({club:1000,mace:800,battleaxe:900,ironhammer:400,shortbow:300,huntingbow:200,paladinbow:150}))assert.equal(hitsToDefeat(W[key],'giant'),hits,key);
 assert.equal(GIANT_CONFIG.durationMs,70000);assert.equal(ANCIENT_STONE_PRICE,600);
});
test('giant victory is idempotent and loot occupies inventory even when full',()=>{
 const challenge={id:'g',milestone:50,deadline:70000},f={coins:500,inventoryEggs:10,giantChallenge:challenge};
 const r=giantSettlement(f,challenge,'win',69999);apply(f,r.patch);
 assert.equal(f.ancientStones,1);assert.equal(f.coins,500);assert.equal(getUsedSpace(f),11);
 assert.equal(f.giantChallenge,null);assert.deepEqual(giantSettlement(f,challenge,'win',69999).patch,{});
 assert.deepEqual(giantSettlement(f,challenge,'loss',80000).patch,{});
});
test('absolute 70s deadline overrides late victory and loss affects only available coins',()=>{
 const challenge={id:'g',milestone:100,deadline:70000};
 for(const coins of [0,1,299,300,500]){
  const f={coins,hens:5,eggsReady:3,inventoryEggs:4,giantChallenge:challenge};
  const {result,patch}=giantSettlement(f,challenge,'win',70000);apply(f,patch);
  assert.equal(result.outcome,'loss');assert.equal(result.coinsLost,Math.min(coins,300));assert.equal(f.coins,Math.max(0,coins-300));
  assert.equal(f.hens,5);assert.equal(f.eggsReady,3);assert.equal(f.inventoryEggs,4);assert.equal(f.ancientStones,undefined);
 }
 assert.throws(()=>giantSettlement({giantChallenge:{id:'other'}},challenge,'win',0));
});
test('giant atlas has all animation and reward frames inside the generated image',()=>{
 const atlas=JSON.parse(fs.readFileSync('assets/farm/giant-sheet.json'));
 assert.equal(Object.keys(atlas.frames).length,32);
 for(const {frame:r,sourceSize:s}of Object.values(atlas.frames)){
  assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=atlas.meta.size.w&&r.y+r.h<=atlas.meta.size.h);
  assert.equal(s.w,224);assert.equal(s.h,224);
 }
});
