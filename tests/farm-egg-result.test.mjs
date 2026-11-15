import test from 'node:test';
import assert from 'node:assert/strict';
import { eggResultView } from '../js/farm/egg-result.js';

test('收蛋顯示沿用各雞種名稱，只列有收穫的品種，支援單顆及大量雞蛋', () => {
    for (const [breed, name] of [['silkie', '烏骨雞蛋'], ['bresse', '布雷斯雞蛋']]) {
        for (const quantity of [1, 10000]) {
            const input = { total: quantity, collected: { hen: 0, [breed]: quantity }, remaining: 0 };
            const before = structuredClone(input), view = eggResultView(input);
            assert.deepEqual(view.eggDetails, [{ eggType: breed, eggName: name, quantity }]);
            assert.equal(view.totalEggs, quantity);
            assert.deepEqual(input, before);
        }
    }
});

test('多雞種與部分收取保留交易原值，重複建立顯示資料沒有副作用', () => {
    const input = { total: 13, collected: { hen: 1, silkie: 4, bresse: 3, onagadori: 5 }, remaining: 7 };
    const view = eggResultView(input);
    assert.equal(view.eggDetails.length, 4);
    assert.equal(view.eggDetails.reduce((sum, row) => sum + row.quantity, 0), view.totalEggs);
    assert.equal(view.remaining, 7);
    assert.deepEqual(eggResultView(input), view);
    assert.throws(() => { view.eggDetails[0].quantity++; }, TypeError);
    assert.equal(input.collected.hen, 1);
});

test('無蛋不建立成功資料，不一致、未知雞種及非法數量會拒絕呈現', () => {
    assert.equal(eggResultView({ total: 0, collected: { hen: 0 }, remaining: 0 }), null);
    for (const input of [null, { total: 2, collected: { hen: 1 }, remaining: 0 },
        { total: 1, collected: { unknown: 1 }, remaining: 0 },
        { total: 1, collected: { hen: -1 }, remaining: 0 },
        { total: 1, collected: { hen: '1' }, remaining: 0 },
        { total: 1, collected: { hen: 1 }, remaining: -1 }]) {
        assert.throws(() => eggResultView(input));
    }
});
