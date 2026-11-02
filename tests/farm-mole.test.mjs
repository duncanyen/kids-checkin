import test from 'node:test';
import assert from 'node:assert/strict';
import { nextMoleMilestone, moleSettlement, moleCells, nextMoleCells } from '../js/farm/mole-rules.js';
import { WEAPONS_CONFIG, hitsToDefeat, equippedWeapon } from '../js/farm/combat-rules.js';
import { getUsedSpace } from '../js/farm/inventory-core.js';

test('mole catch milestones are cumulative, level gated and consumed individually',()=>{
    for(const n of [0,1,19])assert.equal(nextMoleMilestone({coopLevel:2,gardenCatchCount:n}),null);
    assert.equal(nextMoleMilestone({coopLevel:1,gardenCatchCount:99}),null);
    assert.equal(nextMoleMilestone({coopLevel:2,gardenCatchCount:20}),20);
    assert.equal(nextMoleMilestone({coopLevel:2,gardenCatchCount:39,moleLastMilestone:20}),null);
    assert.equal(nextMoleMilestone({coopLevel:2,gardenCatchCount:40,moleLastMilestone:20}),40);
    assert.equal(nextMoleMilestone({coopLevel:2,gardenCatchCount:80,moleLastMilestone:20,worms:0,earthworms:0}),40);
    assert.equal(nextMoleMilestone({coopLevel:2,worms:20,earthworms:30}),null);
});
test('exact melee counts and iron hammer balance; bows never hurt mole',()=>{
    for(const [key,n]of Object.entries({club:300,mace:200,battleaxe:150,ironhammer:100}))assert.equal(hitsToDefeat(WEAPONS_CONFIG[key],'mole'),n);
    for(const key of ['shortbow','huntingbow','paladinbow'])assert.equal(hitsToDefeat(WEAPONS_CONFIG[key],'mole'),Infinity);
    for(const [enemy,n]of Object.entries({wolf:2,tiger:4,gorilla:20,cobra:100,dragon:Infinity,eagle:Infinity}))assert.equal(hitsToDefeat(WEAPONS_CONFIG.ironhammer,enemy),n);
    assert.equal(equippedWeapon({equippedWeapon:'ironhammer',ironhammer:0}),WEAPONS_CONFIG.club);
    assert.equal(WEAPONS_CONFIG.ironhammer.buyPrice,15000);assert.equal(WEAPONS_CONFIG.ironhammer.sellPrice,7500);
});
test('deadline, bounded penalties, full warehouse loot and idempotent settlement',()=>{
    const challenge={id:'m1',milestone:20,deadline:60000};
    const base={coins:70,moleChallenge:challenge,warehouseLimit:1,worms:1};
    assert.equal(getUsedSpace({sweetPotatoes:2,ironhammer:1}),3);
    const win=moleSettlement(base,challenge,'win',59999);
    assert.equal(win.patch['farm.sweetPotatoes'],1);
    assert.equal(moleSettlement(base,challenge,'win',60000).patch['farm.coins'],0);
    assert.equal(moleSettlement({...base,coins:500},challenge,'loss',60000).patch['farm.coins'],400);
    assert.equal(moleSettlement({...base,coins:0},challenge,'loss',60000).result.coinsLost,0);
    const repeated=moleSettlement({...base,moleChallenge:null,moleResults:[win.result]},challenge,'win',70000);
    assert.deepEqual(repeated.patch,{});assert.deepEqual(repeated.result,win.result);
    assert.throws(()=>moleSettlement({...base,moleChallenge:null},challenge,'win',0));
});
test('12 cells stay inside garden at both orientations',()=>{
    for(const b of [{left:10,right:250,top:100,bottom:280},{left:100,right:550,top:50,bottom:344}]) {
        const cells=moleCells(b);assert.equal(cells.length,12);assert.equal(new Set(cells.map(c=>`${c.x},${c.y}`)).size,12);
        for(const c of cells){assert.ok(c.x-c.width/2>=b.left);assert.ok(c.x+c.width/2<=b.right);assert.ok(c.y-c.height/2>=b.top);assert.ok(c.y+c.height/2<=b.bottom);}
    }
});

test('three moles occupy distinct holes and move without overlapping',()=>{
    let previous=[];
    for(let turn=0;turn<30;turn++) {
        const next=nextMoleCells(previous,(min,max)=>turn%2?max:min);
        assert.equal(next.length,3);assert.equal(new Set(next).size,3);
        next.forEach((cell,i)=>{assert.ok(cell>=0 && cell<12);assert.notEqual(cell,previous[i]);});
        previous=next;
    }
});
