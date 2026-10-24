import test from 'node:test';
import assert from 'node:assert/strict';
import { GARDEN_ROLL_SIZE, gardenFindForRoll } from '../js/farm/garden-core.js';

test('exact mutually exclusive garden odds: caterpillar 1/30 and earthworm 1/50', () => {
    const counts = { worms: 0, earthworms: 0, none: 0 };
    for(let roll=1;roll<=GARDEN_ROLL_SIZE;roll++) counts[gardenFindForRoll(roll)||'none']++;
    assert.equal(counts.worms/GARDEN_ROLL_SIZE,1/30);
    assert.equal(counts.earthworms/GARDEN_ROLL_SIZE,1/50);
    assert.equal(counts.none,142);
    assert.equal(gardenFindForRoll(1),'earthworms');assert.equal(gardenFindForRoll(3),'earthworms');
    assert.equal(gardenFindForRoll(4),'worms');assert.equal(gardenFindForRoll(8),'worms');
    for(const roll of [0,9,150,151,NaN,1.5,'1'])assert.equal(gardenFindForRoll(roll),null);
});
