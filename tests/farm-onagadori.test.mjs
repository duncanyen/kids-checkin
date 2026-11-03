import test from 'node:test';
import assert from 'node:assert/strict';
import { BREEDS,HOUR,settlePoultry,poultryPatch,collectPoultry,tradePoultry,feedPoultry,clearPoultryEggs,takePoultryEgg } from '../js/farm/poultry.js';
import { getUsedSpace } from '../js/farm/inventory-core.js';
const apply=(farm,patch)=>({...farm,...Object.fromEntries(Object.entries(patch).map(([k,v])=>[k.slice(5),v]))});
const seed=()=>({poultryVersion:2,hens:1,hensState:[{id:'long',breed:'onagadori',laidAt:0}],readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,coins:20000,warehouseLimit:10,coopLevel:2,worms:1,earthworms:1});
test('onagadori is listed at 6000/3000, but purchase is rejected regardless of money or capacity',()=>{
    assert.equal(BREEDS.onagadori.buy,6000);assert.equal(BREEDS.onagadori.sell,3000);assert.equal(BREEDS.onagadori.eggPrice,120);
    const farm=seed(),copy=structuredClone(farm);
    assert.throws(()=>tradePoultry(farm,'onagadori',1,'buy',0),/尚未開賣/);assert.deepEqual(farm,copy);
    assert.equal(tradePoultry(farm,'onagadori',1,'sell',0)['farm.coins'],23000);
});
test('onagadori produces every 6 hours, caps at 4 eggs per bird, sickness and full storage follow poultry rules',()=>{
    const f=seed();assert.equal(settlePoultry(f,6*HOUR-1).ready.onagadori,0);assert.equal(settlePoultry(f,6*HOUR).ready.onagadori,1);
    for(const hours of [24,48,500])assert.equal(settlePoultry(f,hours*HOUR).ready.onagadori,4);
    const full=apply(f,poultryPatch(settlePoultry(f,24*HOUR)));
    const caught=collectPoultry({...full,warehouseLimit:4},30*HOUR);
    assert.equal(caught.total,2);assert.equal(caught.patch['farm.onagadoriEggs'],2);assert.equal(caught.remaining,2);
    assert.equal(getUsedSpace({onagadoriEggs:3,worms:1}),4);
    const after=apply(full,caught.patch);assert.equal(settlePoultry(after,35*HOUR).ready.onagadori,2);assert.equal(settlePoultry(after,36*HOUR).ready.onagadori,3);
    assert.equal(settlePoultry({...f,hensState:[{...f.hensState[0],isSick:true,sickTimestamp:1}]},24*HOUR).ready.onagadori,0);
    assert.equal(settlePoultry({...f,hensState:[{...f.hensState[0],isSick:true,sickTimestamp:1}]},49*HOUR).hens.length,0);
});
test('feeding, theft, boss loss and sale preserve the new breed and egg rules',()=>{
    const f=seed();assert.equal(feedPoultry(f,'worms','onagadori',5.5*HOUR)['farm.readyEggs'].onagadori,1);
    assert.equal(feedPoultry(f,'earthworms','onagadori',5*HOUR)['farm.readyEggs'].onagadori,1);
    const full=apply(f,poultryPatch(settlePoultry(f,24*HOUR)));
    assert.equal(takePoultryEgg(full,0,24*HOUR).breed,'onagadori');
    assert.equal(clearPoultryEggs(full,24*HOUR)['farm.readyEggs'].onagadori,0);
    const sold=apply(full,tradePoultry(full,'onagadori',1,'sell',24*HOUR));
    assert.equal(sold.hens,0);assert.equal(sold.readyEggs.onagadori,4);assert.equal(collectPoultry(sold,25*HOUR).patch['farm.onagadoriEggs'],4);
});
