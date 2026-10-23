import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePoints, normalizeSettings, DEFAULT_SETTINGS, validateSetting, canChangeRedeem } from '../js/wishwall-core.js';

test('group and account IDs isolate same-name and renamed members; unknown owners never guessed', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS);
    const result = calculatePoints([
        { id: '1', groupId: 'A', accountId: 'alice', operator: '舊名字', points: 10 },
        { id: '2', groupId: 'A', accountId: 'bob', operator: '舊名字', points: 4 },
        { id: '3', groupId: 'B', accountId: 'alice', operator: '舊名字', points: 100 },
        { id: '4', groupId: 'A', operator: '舊名字', points: 999 },
    ], [{ id: 'r', groupId: 'A', accountId: 'alice', cost: 3, status: '已完成' }], settings, 'A');
    assert.equal(result.balances.get('alice'), 7);
    assert.equal(result.balances.get('bob'), 4);
    assert.equal(result.balances.size, 2);
});
test('exam accumulation is per account, ordered and refunds count only once', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS);
    const scores = ['3','1','2'].map(id=>({id,accountId:'alice',category:'exam',examType:'小考',score:100,date:'2026-10-24'}));
    scores.push({id:'b',accountId:'bob',category:'exam',examType:'小考',score:100});
    const result = calculatePoints(scores, [{accountId:'alice',cost:3,status:'已取消'}, {accountId:'alice',cost:3,status:'已駁回'}], settings, 'A');
    assert.equal(result.balances.get('alice'), 1);
    assert.equal(result.balances.get('bob'), 0);
    assert.equal(result.earned.get('3'), 1);
});
test('settings reject invalid amounts and redemption transitions protect owners and terminal states', () => {
    for(const points of [-1, Infinity, NaN, 0.001])assert.throws(()=>validateSetting('gifts',{name:'禮物',points}));
    assert.throws(()=>validateSetting('gifts',{name:'禮物',points:0}));
    assert.throws(()=>validateSetting('examRules',{type:'小考',minScore:101,reqCount:1,points:1}));
    assert.equal(validateSetting('choreRules',{name:'整理',points:0.25}).points,0.25);
    assert.equal(canChangeRedeem({accountId:'a',status:'申請中'},'已取消','a',false),true);
    assert.throws(()=>canChangeRedeem({accountId:'a',status:'申請中'},'已取消','b',false));
    assert.throws(()=>canChangeRedeem({accountId:'a',status:'已完成'},'已駁回','admin',true));
    assert.equal(canChangeRedeem({accountId:'a',status:'已取消'},'已取消','a',false),false);
});
