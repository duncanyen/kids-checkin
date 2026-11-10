import test from 'node:test';
import assert from 'node:assert/strict';
import { CORGI_ROUTINE, createCorgiRoutine, corgiRoutineFor, forgetCorgiRoutine } from '../js/farm/corgi-routine.js';

test('corgi runs 30% slower and sits twice during its one-minute outing',()=>{
    assert.equal(CORGI_ROUTINE.runSpeed,110*.7);
    assert.equal(CORGI_ROUTINE.walkSpeed,75*.7);
    assert.equal(CORGI_ROUTINE.runFrameRate,7);
    const routine=createCorgiRoutine(1000);
    assert.deepEqual(routine.phase(1000),{kind:'run',remaining:20000});
    assert.deepEqual(routine.phase(21000),{kind:'sit',remaining:4000});
    assert.equal(routine.phase(25000).kind,'run');
    assert.deepEqual(routine.phase(41000),{kind:'sit',remaining:4000});
    assert.equal(routine.phase(45000).kind,'run');
    assert.equal(routine.phase(61000).kind,'return');
});

test('the full 60 seconds of sleep start at arrival, not the start of the return trip',()=>{
    const routine=createCorgiRoutine(0);
    assert.equal(routine.phase(60000).kind,'return');
    assert.equal(routine.phase(130000).kind,'return','long return must still complete');
    routine.arriveHome(140000);
    routine.arriveHome(150000); // Duplicate arrival/resize cannot restart the timer.
    assert.deepEqual(routine.phase(199999),{kind:'sleep',remaining:1});
    assert.deepEqual(routine.phase(200000),{kind:'run',remaining:20000});
});

test('barking pauses the remaining sleep instead of cancelling or resetting it',()=>{
    const routine=createCorgiRoutine(0);routine.phase(60000);routine.arriveHome(70000);
    routine.pause(80000);routine.pause(81000);
    assert.equal(routine.phase(82000).kind,'guard');
    routine.resume(85000);
    assert.deepEqual(routine.phase(85000),{kind:'sleep',remaining:50000});
    assert.equal(routine.phase(134999).kind,'sleep');
    assert.equal(routine.phase(135000).kind,'run');
});

test('scene changes share the same lease routine; other leases and games are isolated',()=>{
    const game={},routine=corgiRoutineFor(game,'corgi',0);routine.phase(60000);routine.arriveHome(70000);
    assert.equal(corgiRoutineFor(game,'corgi',90000),routine);
    assert.deepEqual(corgiRoutineFor(game,'corgi',90000).phase(100000),{kind:'sleep',remaining:30000});
    assert.notEqual(corgiRoutineFor(game,'other',90000),routine);
    assert.notEqual(corgiRoutineFor({},'corgi',90000),routine);
    forgetCorgiRoutine(game,'corgi');assert.notEqual(corgiRoutineFor(game,'corgi',100000),routine);
});
