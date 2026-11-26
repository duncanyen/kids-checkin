import test from 'node:test';
import assert from 'node:assert/strict';
import {battleCountdownState} from '../js/farm/battle-countdown-state.js';
test('countdown respects the existing deadline, ceil seconds and urgency boundaries without extending battle time',()=>{
 const timing={deadline:60000,durationMs:60000};
 for(const [now,seconds,phase]of [[0,60,'normal'],[29000,31,'normal'],[30000,30,'normal'],[49999,11,'normal'],[50000,10,'urgent'],[54999,6,'urgent'],[55000,5,'danger'],[56999,4,'danger'],[57000,3,'final'],[59999,1,'final'],[60000,0,'expired'],[80000,0,'expired']]){
  const value=battleCountdownState(timing,now);assert.equal(value.seconds,seconds);assert.equal(value.phase,phase);assert.equal(value.visible,seconds<=30);assert.ok(value.ratio>=0&&value.ratio<=1);
 }
 assert.equal(timing.deadline,60000);assert.equal(battleCountdownState(timing,30000).ratio,.5);assert.equal(battleCountdownState(timing,-100).ratio,1);
});
test('background resume reads elapsed wall time immediately; every original monster duration can use the same display model',()=>{
 for(const durationMs of [40000,50000,60000,70000,80000,90000]){
  const timing={deadline:100000+durationMs,durationMs};assert.equal(battleCountdownState(timing,100000).seconds,durationMs/1000);
  assert.equal(battleCountdownState(timing,timing.deadline-2000).phase,'final');assert.equal(battleCountdownState(timing,timing.deadline+1).ratio,0);
 }
});
