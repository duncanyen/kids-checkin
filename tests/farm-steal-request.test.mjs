import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmStealRequest, isUncertainSteal } from '../js/farm/steal-request.js';

test('已提交但回覆逾時時，確認原請求而不產生另一個交易', async () => {
    let calls = 0, hints = 0, awards = 0;
    const receipts = new Map(), id = 'same-request';
    const send = async () => {
        calls++;
        if (receipts.has(id)) return receipts.get(id);
        const result = { success: true, totalEggs: ++awards };
        receipts.set(id, result);
        throw Object.assign(Error('reply lost'), { code: 'ops/timeout' });
    };
    assert.deepEqual(await confirmStealRequest(send, () => hints++), { success: true, totalEggs: 1 });
    assert.equal(awards, 1); assert.equal(calls, 2); assert.equal(hints, 1);
});

test('明確拒絕不重送；持續不確定最多確認一次並保留錯誤', async () => {
    for (const code of ['functions/failed-precondition', 'ops/timeout', 'functions/deadline-exceeded', 'functions/unknown', undefined]) {
        let calls = 0;
        await assert.rejects(confirmStealRequest(async () => { calls++; throw Object.assign(Error(code), { code }); }, () => {}), { code });
        assert.equal(calls, isUncertainSteal({ code }) ? 2 : 1);
    }
});

test('離開場景時可停止自動確認，原未知交易不另送', async () => {
    let calls = 0;
    const error = Object.assign(Error('timeout'), { code: 'ops/timeout' });
    await assert.rejects(confirmStealRequest(async () => { calls++; throw error; }, original => { throw original; }), error);
    assert.equal(calls, 1);
});
