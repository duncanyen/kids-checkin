import test from 'node:test';
import assert from 'node:assert/strict';
import { GORILLA_CONFIG, GORILLA_FANG_PRICE, rollHomeBossEncounter, rollVisitBossEncounter, bossWeaponDamage } from '../js/farm/gorilla-rules.js';

test('Lv.3+ exact exclusive gorilla 1/30 and dragon 1/20; Lv.2 dragon stays 1/20',()=>{
    for(const level of [0,1])assert.equal(rollHomeBossEncounter(level,()=>{throw Error('ineligible level rolled');}),null);
    let dragon=0;for(let roll=1;roll<=20;roll++)if(rollHomeBossEncounter(2,(min,max)=>{assert.equal(max,20);return roll;})==='dragon')dragon++;
    assert.equal(dragon,1);
    for(const level of [3,4,10]){
        const counts={gorilla:0,dragon:0,eagle:0,none:0};
        for(let roll=1;roll<=60;roll++)counts[rollHomeBossEncounter(level,(min,max)=>{assert.equal(min,1);assert.equal(max,60);return roll;})||'none']++;
        assert.equal(counts.gorilla/60,1/30);assert.equal(counts.dragon/60,1/20);assert.equal(counts.eagle,3);assert.equal(counts.none,52);
    }
});
test('1000 club hits, 200 mace hits, configurable future damage and encounter timing',()=>{
    assert.equal(GORILLA_CONFIG.health/bossWeaponDamage({damage:1},'gorilla'),1000);
    assert.equal(GORILLA_CONFIG.health/bossWeaponDamage({damage:10,damageByEnemy:{gorilla:5}},'gorilla'),200);
    assert.equal(bossWeaponDamage({damage:10,damageByEnemy:{gorilla:5}},'dragon'),10);
    assert.equal(bossWeaponDamage({damage:25},'gorilla'),25);
    assert.equal(GORILLA_CONFIG.flightMs,10000);assert.equal(GORILLA_CONFIG.durationMs-GORILLA_CONFIG.flightMs,30000);
    assert.equal(GORILLA_FANG_PRICE,300);assert.equal(GORILLA_CONFIG.coinPenalty,100);
});

test('stealing from Lv.3+ farms has exact 1/30 gorilla and 1/30 dragon; lower coops never roll gorilla',()=>{
    assert.equal(rollVisitBossEncounter(1,()=>{throw Error('ineligible boss roll');}),null);
    for(const level of [2,3,4]) {
        const counts={gorilla:0,dragon:0,eagle:0,none:0};
        const total=level>=3?60:30;
        for(let n=1;n<=total;n++) counts[rollVisitBossEncounter(level,(_,max)=>{assert.equal(max,total);return n;})||'none']++;
        assert.equal(counts.gorilla,level>=3?2:0);assert.equal(counts.dragon,total/30);assert.equal(counts.eagle,level>=3?3:0);
    }
});
