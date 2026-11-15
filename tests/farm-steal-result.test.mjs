import test from 'node:test';
import assert from 'node:assert/strict';
import { stealResultView } from '../js/farm/steal-result.js';

test('同一母雞合併數量，同品種與同名的不同母雞仍分列', () => {
    const result = { success: true, totalEggs: 4, eggSources: [
        { henId: 'a', henName: '花花', breed: 'silkie', quantity: 1 },
        { henId: 'b', henName: '花花', breed: 'silkie', quantity: 1 },
        { henId: 'a', henName: '花花', breed: 'silkie', quantity: 2 }
    ] };
    const before = structuredClone(result), view = stealResultView(result);
    assert.deepEqual(view.eggDetails.map(row => [row.henId, row.primary, row.quantity]), [['a', '烏骨雞蛋', 3], ['b', '烏骨雞蛋', 1]]);
    assert.equal(view.eggDetails.reduce((sum, row) => sum + row.quantity, 0), view.totalEggs);
    assert.deepEqual(result, before);
});

test('預覽範例總數是三顆；已辨識個體也只顯示雞蛋名稱', () => {
    const view = stealResultView({ success: true, totalEggs: 3, eggSources: [
        { henId: 'a', henName: '花花', breed: 'silkie', quantity: 2 },
        { henId: 'b', henName: '米粒', breed: 'silkie', quantity: 1 }
    ] });
    assert.equal(view.totalEggs, 3); assert.equal(view.eggDetails.length, 2);
    const unnamed = stealResultView({ success: true, totalEggs: 2, eggSources: [
        { henId: 'a', henPublicNumber: '公開 07', breed: 'hen', quantity: 1 },
        { henId: 'b', breed: 'bresse', quantity: 1 }
    ] });
    assert.deepEqual(unnamed.eggDetails.map(row => row.primary), ['雞蛋', '布雷斯雞蛋']);
});

test('來源全部或部分缺失時只顯示已知數量，不能依名稱或品種猜個體', () => {
    const missing = stealResultView({ success: true, totalEggs: 1, eggBreed: 'silkie' });
    assert.equal(missing.eggDetails[0].primary, '烏骨雞蛋'); assert.equal(Object.hasOwn(missing.eggDetails[0], 'secondary'), false);
    const partial = stealResultView({ success: true, totalEggs: 3, eggSources: [{ henId: 'a', henName: '米粒', breed: 'hen', quantity: 1 }] });
    assert.equal(partial.eggDetails[1].primary, '雞蛋'); assert.equal(partial.eggDetails[1].quantity, 2);
    const noId = stealResultView({ success: true, totalEggs: 1, eggSources: [{ henName: '不能猜這隻', breed: 'hen', quantity: 1 }] });
    assert.equal(noId.eggDetails[0].primary, '雞蛋');
});

test('失敗及零顆不顯示結果，來源超量／非法數量／同個體不同品種拒絕顯示', () => {
    assert.equal(stealResultView({ success: false }), null); assert.equal(stealResultView({ success: true, totalEggs: 0 }), null);
    for (const result of [
        { success: true },
        { success: true, totalEggs: 1, eggSources: [{ quantity: -1 }] },
        { success: true, totalEggs: 1, eggSources: [{ quantity: 2 }] },
        { success: true, totalEggs: 2, eggSources: [{ henId: 'a', breed: 'hen', quantity: 1 }, { henId: 'a', breed: 'silkie', quantity: 1 }] }
    ]) assert.throws(() => stealResultView(result));
});
