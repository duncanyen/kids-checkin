import { BREEDS } from './poultry.js';

/**
 * 將已成功提交的收蛋交易結果轉成唯讀顯示資料；不讀取存檔、不發獎，也不更新任務。
 * 呼叫端只能在交易 Promise 成功後使用，不能以此函式判斷交易是否已提交。
 * @param {{total: number, collected: Object<string, number>, remaining: number}} result - 現有收蛋交易回傳值。
 * @returns {Object|null} 可供彈窗呈現的資料，沒有收穫時回傳 null。
 * @throws {Error} 數量或雞種不一致時拒絕建立成功明細，交由呼叫端記錄並顯示備援提示。
 */
export function eggResultView(result) {
    const validCount = value => Number.isSafeInteger(value) && value >= 0;
    if (!result || !validCount(result.total) || !validCount(result.remaining) ||
        !result.collected || typeof result.collected !== 'object' || Array.isArray(result.collected)) {
        throw new Error('收蛋結果格式不正確');
    }
    const eggDetails = [];
    for (const [eggType, quantity] of Object.entries(result.collected)) {
        if (!Object.hasOwn(BREEDS, eggType) || !validCount(quantity)) throw new Error('收蛋明細格式不正確');
        if (quantity) eggDetails.push(Object.freeze({ eggType, eggName: BREEDS[eggType].eggName, quantity }));
    }
    if (eggDetails.reduce((sum, row) => sum + row.quantity, 0) !== result.total) {
        throw new Error('收蛋總數與明細不一致');
    }
    if (!result.total) return null;
    return Object.freeze({ totalEggs: result.total, eggDetails: Object.freeze(eggDetails), remaining: result.remaining });
}
