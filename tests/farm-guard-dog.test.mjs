import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, GUARD_DOG_BREEDS, rentalPrice, rentGuardDog, activateGuardDog, releaseGuardDog, guardDogLeases, activeGuardDog, guardDogInterception, stealBlockedUntil } from '../js/farm/guard-dog-core.js';
const now = 1000000;
const apply = (farm,patch) => ({...farm,...Object.fromEntries(Object.entries(patch).map(([key,value])=>[key.slice(5),value]))});
const rented = (days=7) => apply({coins:2000},rentGuardDog({coins:2000},'pyrenees',days,'dog-1',now));

test('arbitrary days use the cheapest daily/weekly combination',()=>{
    for(const [days,cost] of [[1,80],[2,160],[5,400],[6,400],[7,400],[8,480],[12,800],[14,800],[15,880]])assert.equal(rentalPrice('pyrenees',days),cost);
    for(const days of [0,-1,1.5,NaN,Infinity,'7',1e15])assert.throws(()=>rentalPrice('pyrenees',days));
    assert.throws(()=>rentalPrice('unknown',1));
});
test('renting charges exactly once and waiting dogs never start or expire',()=>{
    const farm=rented(),before=structuredClone(farm);
    assert.equal(farm.coins,1600);assert.equal(farm.guardDogs[0].startedAt,null);
    assert.equal(guardDogLeases(farm,now+365*DAY_MS).length,1);assert.equal(activeGuardDog(farm),null);
    assert.throws(()=>rentGuardDog(farm,'pyrenees',1,'dog-2',now+DAY_MS),/同一品種/);
    assert.throws(()=>rentGuardDog({coins:79},'pyrenees',1,'dog-2',now),/金幣不足/);
    assert.deepEqual(farm,before);
});
test('first activation starts continuous absolute time, not the rental purchase date',()=>{
    const farm=rented(),start=now+10*DAY_MS,active=apply(farm,activateGuardDog(farm,'dog-1',start));
    assert.equal(active.guardDogs[0].startedAt,start);assert.equal(active.guardDogs[0].expiresAt,start+7*DAY_MS);
    assert.throws(()=>activateGuardDog(active,'dog-1',start+DAY_MS),/不能重設/);
    assert.equal(activeGuardDog(active,start+7*DAY_MS-1).id,'dog-1');
    assert.equal(activeGuardDog(active,start+7*DAY_MS),null);assert.deepEqual(guardDogLeases(active,start+7*DAY_MS),[]);
    assert.throws(()=>activateGuardDog(active,'dog-1',start+7*DAY_MS),/找不到/);
});
test('different breeds may wait together, but switching requires forfeiting the current dog',()=>{
    GUARD_DOG_BREEDS.future={...GUARD_DOG_BREEDS.pyrenees,name:'未來犬種'};
    try{
        let farm=rented();farm=apply(farm,rentGuardDog(farm,'future',1,'dog-2',now));
        assert.equal(farm.guardDogs.length,2);farm=apply(farm,activateGuardDog(farm,'dog-1',now));
        assert.throws(()=>activateGuardDog(farm,'dog-2',now),/先解除/);
        const coins=farm.coins;farm=apply(farm,releaseGuardDog(farm,'dog-1',now+1));
        assert.equal(farm.coins,coins);assert.deepEqual(farm.guardDogs.map(d=>d.id),['dog-2']);
        farm=apply(farm,activateGuardDog(farm,'dog-2',now+2));assert.equal(activeGuardDog(farm,now+2).id,'dog-2');
        assert.throws(()=>releaseGuardDog(rented(),'dog-1',now),/護衛中/);
    }finally{delete GUARD_DOG_BREEDS.future;}
});
test('only an unexpired activated dog can bite, with a precise 70 percent boundary',()=>{
    const pending=rented();assert.equal(guardDogInterception(pending,0,now),null);
    const farm=apply(pending,activateGuardDog(pending,'dog-1',now));
    assert.ok(guardDogInterception(farm,0,now));assert.ok(guardDogInterception(farm,.69999,now));
    assert.equal(guardDogInterception(farm,.7,now),null);assert.equal(guardDogInterception(farm,.99,now),null);
    assert.equal(guardDogInterception(farm,0,now+7*DAY_MS),null);assert.equal(guardDogInterception({},0,now),null);
});
test('four-hour blocks survive reload and remain scoped to their group and coop',()=>{
    const farm={villageStealCooldowns:{A:now},villageStealBlockedUntil:{A:now+4*3600000}};
    assert.equal(stealBlockedUntil(farm,'A'),now+4*3600000);assert.equal(stealBlockedUntil(farm,'B'),0);
    assert.equal(stealBlockedUntil({stealCooldowns:{alice:now}},'A','alice'),now+3600000);
    assert.equal(stealBlockedUntil({stealCooldowns:{alice:now}},'B',null),0);
});
