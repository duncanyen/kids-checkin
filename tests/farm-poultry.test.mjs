import test from 'node:test';
import assert from 'node:assert/strict';
import { BREEDS, HOUR, poultryState, settlePoultry, poultryPatch, productionChanged, collectPoultry, clearPoultryEggs, takePoultryEgg, tradePoultry, feedPoultry } from '../js/farm/poultry.js';
const apply = (farm, patch) => ({ ...farm, ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key.slice(5), value])) });
const seed = () => ({ poultryVersion: 2, hens: 3, hensState: ['hen', 'silkie', 'bresse'].map((breed, i) => ({ id: 'h'+i, breed, isSick: false, laidAt: 0 })), readyEggs: { hen: 0, silkie: 0, bresse: 0 }, eggsReady: 0, coins: 20000, coopLevel: 1, worms: 2, earthworms: 2 });
test('exact per-bird intervals, 24-hour yields, breed prices and offline cap', () => {
 assert.deepEqual(settlePoultry(seed(), 4*HOUR).ready, { hen:1, silkie:1, bresse:0 });
 assert.deepEqual(settlePoultry(seed(), 6*HOUR).ready, { hen:1, silkie:1, bresse:1 });
 for(const hours of [24,48,365*24]) assert.deepEqual(settlePoultry(seed(), hours*HOUR).ready, { hen:6, silkie:6, bresse:4 });
 assert.deepEqual(Object.values(BREEDS).map(b=>[b.buy,b.sell,b.eggPrice]),[[1000,500,10],[2000,1000,30],[4000,2000,60]]);
});
test('legacy migration preserves IDs, available eggs, original aggregate cadence and inventories', () => {
 const old={ hens:2,hensState:[{},{}],lastLayTime:0,eggsReady:3,inventoryEggs:4 };
 const copy=structuredClone(old),state=settlePoultry(old,2*HOUR);
 assert.equal(state.ready.hen,4);assert.equal(state.hens.length,2);assert.ok(state.hens.every(h=>h.breed==='hen'));
 assert.deepEqual(old,copy);const result=collectPoultry(old,2*HOUR);assert.equal(result.patch['farm.inventoryEggs'],8);
 const saved=apply(old,poultryPatch(state));assert.equal(productionChanged(saved,2*HOUR),false);
 assert.equal(poultryState({hens:0}).hens.length,0);
});
test('buy uses shared coop capacity and fresh clocks; sales retain eggs and support empty coop', () => {
 const full=seed();assert.throws(()=>tradePoultry(full,'silkie',1,'buy',HOUR),/空間不足/);
 const empty={hens:0,coins:5000,coopLevel:1,lastLayTime:0};
 const bought=apply(empty,tradePoultry(empty,'bresse',1,'buy',24*HOUR,['new']));
 assert.equal(bought.coins,1000);assert.equal(bought.hensState[0].id,'new');assert.equal(bought.hensState[0].laidAt,24*HOUR);
 assert.equal(settlePoultry(bought,29*HOUR).ready.bresse,0);assert.equal(settlePoultry(bought,30*HOUR).ready.bresse,1);
 const sold=apply(bought,tradePoultry(bought,'bresse',1,'sell',30*HOUR));assert.equal(sold.coins,3000);assert.equal(sold.hens,0);assert.equal(sold.readyEggs.bresse,1);
 assert.equal(settlePoultry(sold,100*HOUR).ready.bresse,1);assert.throws(()=>tradePoultry(sold,'bresse',1,'sell',31*HOUR),/數量不足/);
 assert.throws(()=>tradePoultry({...empty,coins:1},'silkie',1,'buy'),/金幣不足/);
 for(const qty of [-1,0,1.5,NaN])assert.throws(()=>tradePoultry(empty,'hen',qty,'buy'));
 for(const [level,limit]of [[1,3],[2,10],[3,20],[4,20]]){const f={...empty,coopLevel:level,coins:100000};assert.equal(tradePoultry(f,'hen',limit,'buy',0)['farm.hens'],limit);assert.throws(()=>tradePoultry(f,'hen',limit+1,'buy',0));}
});
test('feeding only selected breed, correct 30/60 minute boosts, no consumption for unavailable targets', () => {
 const f=seed(),patch=feedPoultry(f,'worms','silkie',3.5*HOUR),fed=apply(f,patch);
 assert.deepEqual(fed.readyEggs,{hen:0,silkie:1,bresse:0});assert.equal(fed.worms,1);
 assert.equal(fed.hensState.find(h=>h.breed==='bresse').laidAt,0);
 const b=apply(f,feedPoultry(f,'earthworms','bresse',5*HOUR));assert.equal(b.readyEggs.bresse,1);assert.equal(b.earthworms,1);
 const sick=seed();sick.hensState[1].isSick=true;assert.throws(()=>feedPoultry(sick,'worms','silkie',0),/健康雞隻/);
 assert.throws(()=>feedPoultry({...f,hens:0,hensState:[]},'worms','silkie',0));
 const full=apply(f,poultryPatch(settlePoultry(f,24*HOUR)));assert.throws(()=>feedPoultry(full,'worms','silkie',24*HOUR),/產能已滿/);
 assert.throws(()=>feedPoultry({...f,worms:0},'worms','hen',0));
});
test('collect and steal keep egg type, full clocks cannot bank, boss loss clears every breed', () => {
 const f=seed(),full=apply(f,poultryPatch(settlePoultry(f,24*HOUR)));
 const collection=collectPoultry(full,48*HOUR);assert.equal(collection.total,16);assert.equal(collection.patch['farm.silkieEggs'],6);assert.equal(collection.patch['farm.bresseEggs'],4);
 const after=apply(full,collection.patch);assert.deepEqual(settlePoultry(after,49*HOUR).ready,{hen:0,silkie:0,bresse:0});assert.equal(settlePoultry(after,52*HOUR).ready.silkie,1);
 const egg=takePoultryEgg(full,.99,24*HOUR);assert.equal(egg.breed,'bresse');assert.equal(egg.patch['farm.readyEggs'].bresse,3);assert.equal(egg.patch['farm.eggsReady'],15);
 const lost=apply(full,clearPoultryEggs(full,30*HOUR));assert.deepEqual(lost.readyEggs,{hen:0,silkie:0,bresse:0});assert.equal(settlePoultry(lost,31*HOUR).ready.bresse,0);
});
test('sick birds stop producing and death never replaces a sold/dead bird with a free hen', () => {
 const f=seed();f.hensState.forEach(h=>{h.isSick=true;h.sickTimestamp=1;});
 assert.deepEqual(settlePoultry(f,24*HOUR).ready,{hen:0,silkie:0,bresse:0});assert.equal(settlePoultry(f,49*HOUR).hens.length,0);
});
