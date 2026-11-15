import { BREEDS } from './poultry.js';

/**
 * 將成功交易的來源明細轉為顯示資料，不查雞群、不猜個體，也不修改庫存。
 * henId 僅供本次結果分組；有已記錄的個體與公開雞名時一併顯示；沒有來源時只顯示雞蛋名稱。
 * @param {Object} result - 已提交的偷蛋結果：success、totalEggs、eggSources。
 * @returns {Object|null} 共用結果視窗使用的總數及明細；失敗或零顆回傳 null。
 */
export function stealResultView(result) {
    if (result?.success !== true || result.totalEggs === 0) return null;
    if (!Number.isSafeInteger(result.totalEggs) || result.totalEggs < 1) throw new Error('偷蛋結果沒有有效總數');
    const sources = result.eggSources || [];
    if (!Array.isArray(sources)) throw new Error('偷蛋來源格式不正確');
    const groups = new Map();
    let recorded = 0;
    const add = source => {
        if (!source || !Number.isSafeInteger(source.quantity) || source.quantity < 0) throw new Error('偷蛋來源數量不正確');
        if (!source.quantity) return;
        const henId = typeof source.henId === 'string' && source.henId.trim() ? source.henId : null;
        const breed = Object.hasOwn(BREEDS, source.breed) ? source.breed : null;
        const key = JSON.stringify([henId ? 'hen' : 'unknown', henId || breed]);
        let row = groups.get(key);
        if (!row) {
            const eggName = breed ? BREEDS[breed].eggName : '雞蛋';
            const name = henId && typeof source.henName === 'string' ? source.henName.trim() : '';
            row = { henId, breed, primary: name ? `${name}／${eggName}` : eggName, quantity: 0 };
            groups.set(key, row);
        }
        if (row.breed !== breed) throw new Error('同一母雞的品種資料不一致');
        row.quantity += source.quantity; recorded += source.quantity;
        if (!Number.isSafeInteger(recorded) || recorded > result.totalEggs) throw new Error('偷蛋總數與來源不一致');
    };
    sources.forEach(add);
    if (recorded < result.totalEggs) add({ henId: null, breed: result.eggBreed, quantity: result.totalEggs - recorded });
    return Object.freeze({ totalEggs: result.totalEggs, remaining: 0, eggDetails: Object.freeze([...groups.values()].map(Object.freeze)) });
}
