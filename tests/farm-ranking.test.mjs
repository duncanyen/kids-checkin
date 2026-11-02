import test from 'node:test';
import assert from 'node:assert/strict';
import { rankFarmPlayers, theftRankingPatch, theftRankingStatus, THEFT_RANKING_START, THEFT_RANKING_END, THEFT_RANKING_FIELD } from '../js/farm/ranking-core.js';
import { readFileSync } from 'node:fs';

test('rankings separate the same account across groups, deduplicate farms and cap at ten', () => {
    const rows = Array.from({length:15}, (_,i) => ({ groupId:'A', groupName:'同名群組', accountId:`p${String(i).padStart(2,'0')}`,name:`玩家${i}`,farm:{stolenEggs20261102:i} }));
    rows.push({groupId:'B',groupName:'同名群組',accountId:'p01',name:'玩家1',farm:{stolenEggs20261102:20}},
        {groupId:'A',accountId:'zero',farm:{}}, {groupId:'A',accountId:'bad',farm:{stolenEggs20261102:Infinity}});
    const original=structuredClone(rows), result=rankFarmPlayers(rows,'stolenEggs20261102');
    assert.equal(result.length,10);assert.equal(result[0].accountId,'p01');assert.equal(result[0].score,20);
    assert.equal(result[0].groupId,'B');assert.equal(result[1].score,14);assert.deepEqual(rows,original);
    const farms=[{groupId:'B',groupName:'乙',accountId:'same',name:'玩家',farm:{n:3}}, {groupId:'A',groupName:'甲',accountId:'same',name:'玩家',farm:{n:4}}];
    assert.deepEqual(rankFarmPlayers([...farms,farms[1]],'n').map(row=>[row.groupId,row.groupName,row.score]),[['A','甲',4],['B','乙',3]]);
    assert.deepEqual(rankFarmPlayers(farms.map(row=>({...row,farm:{n:2}})),'n').map(row=>row.groupId),['A','B']);
});

test('ranking reads exclude closed villages, removed members/profiles and mid-read privacy changes', async () => {
    const groups=[{id:'A',name:'甲',members:['self','removed','ex-member'],farmVillageVisibility:'public'},
        {id:'B',name:'乙',members:['self'],farmVillageVisibility:'public'},
        {id:'C',name:'丙',members:['other'],farmVillageVisibility:'public'}];
    const docs={
        'groups/A':{...groups[0],members:['self','removed']},
        'groups/B':groups[1], 'groups/C':{...groups[2],farmVillageVisibility:'private'},
        'groups/A/users/self':{farm:{stolenEggs20261102:3}},'groups/B/users/self':{farm:{stolenEggs20261102:4}},
        'groups/A/users/ex-member':{farm:{stolenEggs20261102:500}},'groups/C/users/other':{farm:{stolenEggs20261102:600}},
    };
    const profiles=[{accountId:'self',name:'我'},{accountId:'removed',role:'removed'},{accountId:'ex-member'},{accountId:'other'}];
    globalThis.__rankingFixture={groups,docs,profiles};
    const source=readFileSync(new URL('../js/farm/rankings.js',import.meta.url),'utf8').replace(/^(import|export) .* from .*;\n/gm,'');
    const core=readFileSync(new URL('../js/farm/ranking-core.js',import.meta.url),'utf8');
    const mock=`const {groups,docs,profiles}=globalThis.__rankingFixture,db={};
      const doc=(_, ...bits)=>bits.join('/'),collection=doc,query=(ref,filter)=>filter,where=(_,__,ids)=>ids;
      const getDoc=async path=>({exists:()=>!!docs[path],data:()=>structuredClone(docs[path])});
      const getDocs=async ids=>({forEach:cb=>profiles.filter(p=>ids.includes(p.accountId)).forEach(p=>cb({data:()=>p}))});
      const isPublicVillage=g=>g?.farmVillageVisibility==='public',listPublicVillages=async()=>groups;`;
    const mod=await import('data:text/javascript;base64,'+Buffer.from(mock+core+source).toString('base64'));
    const result=await mod.loadFarmRanking({groupId:'A',accountId:'self'});
    assert.equal(result.length,2);assert.equal(result[0].score,4);assert.equal(result[0].groupId,'B');assert.equal(result[0].groupName,'乙');assert.equal(result[1].score,3);assert.equal(result[1].groupName,'甲');
    await assert.rejects(mod.loadFarmRanking({groupId:'A',accountId:'outsider'}),/不在此村落/);
    docs['groups/A'].farmVillageVisibility='private';
    assert.equal((await mod.loadFarmRanking({groupId:'A',accountId:'self'}))[0].score,4);
});

test('fixed Taipei contest dates include the start and exclude the 01:00 cutoff', () => {
    assert.equal(THEFT_RANKING_START, Date.parse('2026-11-01T16:00:00Z'));
    assert.equal(THEFT_RANKING_END, Date.parse('2026-11-08T17:00:00Z'));
    const farm = { [THEFT_RANKING_FIELD]: 8, stolenEggsTotal: 999 };
    assert.deepEqual(theftRankingPatch(farm, { now: THEFT_RANKING_START - 1, publicVillage: true }), {});
    assert.deepEqual(theftRankingPatch(farm, { now: THEFT_RANKING_START, publicVillage: true }), { ['farm.'+THEFT_RANKING_FIELD]: 9 });
    assert.deepEqual(theftRankingPatch(farm, { now: THEFT_RANKING_END - 1, publicVillage: true }), { ['farm.'+THEFT_RANKING_FIELD]: 9 });
    assert.deepEqual(theftRankingPatch(farm, { now: THEFT_RANKING_END, publicVillage: true }), {});
    assert.deepEqual(theftRankingPatch(farm, { now: THEFT_RANKING_START, publicVillage: false }), {});
    assert.deepEqual(theftRankingPatch({ stolenEggsTotal: 999 }, { now: THEFT_RANKING_START, publicVillage: true }), { ['farm.'+THEFT_RANKING_FIELD]: 1 });
    assert.equal(theftRankingStatus(THEFT_RANKING_START - 1), '尚未開始');
    assert.equal(theftRankingStatus(THEFT_RANKING_END - 1), '記錄中');
    assert.equal(theftRankingStatus(THEFT_RANKING_END), '已截止');
    assert.equal(farm[THEFT_RANKING_FIELD],8);
});
