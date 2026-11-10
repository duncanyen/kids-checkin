import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, GUARD_DOG_BREEDS, rentalPrice, rentGuardDog, activateGuardDog, releaseGuardDog, guardDogLeases, activeGuardDog, guardDogInterception, stealBlockedUntil, colliePatrolPhase, guardDogPatrolPhase, guardDogRemainingMs, guardDogStatus } from '../js/farm/guard-dog-core.js';
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
test('different breeds may wait together, and switching preserves the current balance',()=>{
    GUARD_DOG_BREEDS.future={...GUARD_DOG_BREEDS.pyrenees,name:'未來犬種'};
    try{
        let farm=rented();farm=apply(farm,rentGuardDog(farm,'future',1,'dog-2',now));
        assert.equal(farm.guardDogs.length,2);farm=apply(farm,activateGuardDog(farm,'dog-1',now));
        assert.throws(()=>activateGuardDog(farm,'dog-2',now),/先解除/);
        const coins=farm.coins;farm=apply(farm,releaseGuardDog(farm,'dog-1',now+1));
        assert.equal(farm.coins,coins);assert.deepEqual(farm.guardDogs.map(d=>d.id),['dog-1','dog-2']);
        assert.equal(farm.guardDogs[0].remainingMs,7*DAY_MS-1);
        farm=apply(farm,activateGuardDog(farm,'dog-2',now+2));assert.equal(activeGuardDog(farm,now+2).id,'dog-2');
        assert.deepEqual(releaseGuardDog(rented(),'dog-1',now)['farm.guardDogs'],rented().guardDogs);
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

test('beagle uses its own prices, 33 percent bite boundary and two-hour block',()=>{
    for(const [days,cost] of [[1,20],[2,40],[5,100],[6,100],[7,100],[8,120],[12,200],[14,200]])assert.equal(rentalPrice('beagle',days),cost);
    let farm=apply({coins:500},rentGuardDog({coins:500},'beagle',7,'beagle-1',now));
    assert.equal(farm.coins,400);assert.equal(guardDogInterception(farm,0,now),null);
    farm=apply(farm,activateGuardDog(farm,'beagle-1',now));
    assert.ok(guardDogInterception(farm,.32999,now));assert.equal(guardDogInterception(farm,.33,now),null);
    assert.equal(guardDogInterception(farm,0,now).breed.blockMs,2*3600000);
    assert.equal(guardDogInterception(farm,0,now+7*DAY_MS),null);
    assert.equal(GUARD_DOG_BREEDS.pyrenees.biteChance,.7);assert.equal(GUARD_DOG_BREEDS.pyrenees.blockMs,4*3600000);
});

test('pyrenees and beagle can both be rented, but cannot guard at the same time',()=>{
    let farm=rented();farm=apply(farm,rentGuardDog(farm,'beagle',1,'beagle-1',now));
    assert.equal(farm.guardDogs.length,2);assert.equal(farm.coins,1580);
    assert.throws(()=>rentGuardDog(farm,'beagle',1,'duplicate',now),/同一品種/);
    farm=apply(farm,activateGuardDog(farm,'dog-1',now));
    assert.throws(()=>activateGuardDog(farm,'beagle-1',now),/先解除/);
    farm=apply(farm,releaseGuardDog(farm,'dog-1',now+1));
    farm=apply(farm,activateGuardDog(farm,'beagle-1',now+2));
    assert.equal(activeGuardDog(farm,now+2).breedId,'beagle');assert.equal(farm.guardDogs.find(d=>d.id==='beagle-1').expiresAt,now+2+DAY_MS);
});


test('collie is displayed at 200/1000 but closed to new rentals; existing leases retain 80 percent interception',()=>{
    assert.equal(rentalPrice('collie',1),200);assert.equal(rentalPrice('collie',7),1000);assert.equal(rentalPrice('collie',8),1200);
    assert.throws(()=>rentGuardDog({coins:999999},'collie',1,'collie',now),/尚未開放/);
    let farm={coins:50,guardDogs:[{id:'collie',breedId:'collie',days:1,paid:200000,startedAt:null,expiresAt:null}]};
    assert.equal(activeGuardDog(farm,now),null);farm=apply(farm,activateGuardDog(farm,'collie',now+500));
    assert.equal(Array.from({length:1000},(_,i)=>guardDogInterception(farm,i/1000,now+500)).filter(Boolean).length,800);
    assert.equal(guardDogInterception(farm,.8,now+500),null);assert.equal(guardDogInterception(farm,.79999,now+500).breed.blockMs,4*3600000);
    assert.equal(activeGuardDog(farm,now+500+DAY_MS),null);
});
test('collie spends exactly 60 percent of each full patrol cycle running',()=>{
    for(let cycle=0;cycle<3;cycle++){
        const phases=Array.from({length:30},(_,i)=>colliePatrolPhase(cycle*30000+i*1000));
        assert.equal(phases.filter(p=>p.running).length,18);assert.equal(phases.filter(p=>!p.running).length,12);
    }
    assert.deepEqual(colliePatrolPhase(18000),{running:false,remaining:12000});
    assert.deepEqual(colliePatrolPhase(30000),{running:true,remaining:18000});
});

test('corgi rents at 100/500, waits in storage, intercepts below 40%, and expires normally',()=>{
    assert.equal(rentalPrice('corgi',1),100);assert.equal(rentalPrice('corgi',7),500);assert.equal(rentalPrice('corgi',8),600);
    let farm=apply({coins:600},rentGuardDog({coins:600},'corgi',7,'corgi',now));
    assert.equal(farm.coins,100);assert.equal(activeGuardDog(farm,now),null);
    assert.throws(()=>rentGuardDog(farm,'corgi',1,'duplicate',now),/同一品種/);
    assert.throws(()=>rentGuardDog({coins:99},'corgi',1,'poor',now),/金幣不足/);
    farm=apply(farm,activateGuardDog(farm,'corgi',now));
    assert.equal(guardDogInterception(farm,.399999,now).breed.blockMs,2*3600000);
    assert.equal(guardDogInterception(farm,.4,now),null);
    assert.equal(activeGuardDog(farm,now+7*DAY_MS),null);
});

test('legacy corgi patrol helper stays compatible; current routine is tested separately',()=>{
    for(let cycle=0;cycle<3;cycle++){
        const phases=Array.from({length:30},(_,second)=>guardDogPatrolPhase('corgi',cycle*30000+second*1000));
        assert.equal(phases.filter(p=>p.running).length,15);
    }
    assert.deepEqual(guardDogPatrolPhase('corgi',15000),{running:false,remaining:15000});
    assert.deepEqual(guardDogPatrolPhase('corgi',30000),{running:true,remaining:15000});
    assert.equal(colliePatrolPhase(15000).running,true);
});


test('pause saves exact milliseconds across long storage and repeated resume cycles',()=>{
    let farm=rented(1);farm=apply(farm,activateGuardDog(farm,'dog-1',now));
    farm=apply(farm,releaseGuardDog(farm,'dog-1',now+6*3600000+123));
    const balance=18*3600000-123;
    assert.equal(farm.guardDogs[0].remainingMs,balance);
    assert.equal(farm.guardDogs[0].startedAt,null);assert.equal(farm.guardDogs[0].expiresAt,null);
    assert.equal(activeGuardDog(farm,now),null);assert.equal(guardDogInterception(farm,0,now),null);
    assert.equal(guardDogRemainingMs(farm.guardDogs[0],now+100*DAY_MS),balance);
    assert.match(guardDogStatus(farm.guardDogs[0],now+100*DAY_MS),/待命・餘 18時0分/);
    const duplicate=apply(farm,releaseGuardDog(farm,'dog-1',now+100*DAY_MS));assert.deepEqual(duplicate,farm);
    const resumedAt=now+100*DAY_MS;farm=apply(farm,activateGuardDog(farm,'dog-1',resumedAt));
    assert.equal(farm.guardDogs[0].expiresAt,resumedAt+balance);
    farm=apply(farm,releaseGuardDog(farm,'dog-1',resumedAt+60001));
    assert.equal(farm.guardDogs[0].remainingMs,balance-60001);
    farm=apply(farm,activateGuardDog(farm,'dog-1',resumedAt+10*DAY_MS));
    assert.equal(activeGuardDog(farm,resumedAt+10*DAY_MS+balance-60001),null);
});

test('legacy waiting and active leases pause safely; zero or corrupt balances cannot restore full days',()=>{
    let farm={coins:42,guardDogs:[{id:'legacy',breedId:'pyrenees',days:1,startedAt:now,expiresAt:now+DAY_MS}]};
    farm=apply(farm,releaseGuardDog(farm,'legacy',now+1000));assert.equal(farm.guardDogs[0].remainingMs,DAY_MS-1000);
    farm=apply(farm,activateGuardDog(farm,'legacy',now+10*DAY_MS));assert.equal(farm.guardDogs[0].expiresAt,now+11*DAY_MS-1000);
    const waiting={guardDogs:[{id:'waiting',breedId:'beagle',days:1,startedAt:null,expiresAt:null}]};
    assert.equal(activateGuardDog(waiting,'waiting',now)['farm.guardDogs'][0].expiresAt,now+DAY_MS);
    for(const remainingMs of [0,-1,NaN,1.5,DAY_MS+1,'86400000']){
        const invalid={guardDogs:[{...waiting.guardDogs[0],remainingMs}]};
        assert.deepEqual(guardDogLeases(invalid,now),[]);assert.throws(()=>activateGuardDog(invalid,'waiting',now),/找不到/);
    }
    assert.throws(()=>releaseGuardDog(farm,'legacy',now+11*DAY_MS),/找不到/);
});
