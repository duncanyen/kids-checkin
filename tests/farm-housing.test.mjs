import test from 'node:test';import assert from 'node:assert/strict';
import { outdoorHens,housingPatch,treatmentPatch } from '../js/farm/poultry-housing.js';
import { settlePoultry,HOUR } from '../js/farm/poultry.js';
const farm=n=>({hens:n,hensState:Array.from({length:n},(_,i)=>({id:'h'+i,breed:i%2?'silkie':'hen',laidAt:0})),coins:1,medicines:3,poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0},eggsReady:0});
test('outdoor minimum, default all, zero and small flocks, mixed breed settings',()=>{
 for(const n of [0,1,5,6,7,20])assert.equal(outdoorHens(farm(n)).length,n);
 const f={...farm(10),outdoorHensByBreed:{hen:3,silkie:3}};assert.equal(outdoorHens(f).length,6);
 assert.throws(()=>housingPatch(f,{hen:2,silkie:3}),/至少/);assert.throws(()=>housingPatch(f,{hen:6,silkie:3}),/變更/);
 assert.equal(outdoorHens({...farm(4),outdoorHensByBreed:{hen:0,silkie:0}}).length,4);
 assert.equal(outdoorHens({...farm(10),outdoorHensByBreed:{hen:0,silkie:0}}).length,6);
});
test('indoor housing never reduces production',()=>{
 const f=farm(10),inside={...f,outdoorHensByBreed:{hen:3,silkie:3}};
 assert.deepEqual(settlePoultry(f,24*HOUR),settlePoultry(inside,24*HOUR));
});
test('random treatment reaches indoor sick birds, consumes once and preserves unrelated birds',()=>{
 const f={...farm(10),outdoorHensByBreed:{hen:3,silkie:3}};f.hensState[9]={...f.hensState[9],isSick:true,sickTimestamp:1,pausedFull:true};
 assert.ok(!outdoorHens(f).some(h=>h.id==='h9'));
 const patch=treatmentPatch(f,{roll:.9,now:HOUR});assert.equal(patch['farm.medicines'],2);assert.equal(patch['farm.hensState'][9].isSick,false);assert.equal(patch['farm.hensState'][9].laidAt,HOUR);assert.equal(patch['farm.hensState'][9].pausedFull,undefined);
 assert.throws(()=>treatmentPatch({...f,medicines:0},{now:HOUR}),/不足/);
 assert.throws(()=>treatmentPatch(f,{id:'sold',now:HOUR}),/康復/);
 assert.throws(()=>treatmentPatch(f,{now:49*HOUR}),/康復/);
});
