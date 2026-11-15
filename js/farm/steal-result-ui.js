import { openFarmResult, prepareFarmResultAssets } from './egg-result-ui.js?v=20261115-steal-v1';
import { stealResultView } from './steal-result.js';

// 七張 PNG 與附件逐位元相同，共用既有 URL，避免為偷蛋再下載一份相同素材。
const common = 'assets/farm/egg-result/v1/egg_result_', own = 'assets/farm/steal-result/v1/steal_result_';
const assets = Object.fromEntries(['panel', 'close', 'total_banner', 'section_title', 'row', 'storage_banner', 'confirm'].map(name => [name, common + name + '.png']));
Object.assign(assets, { title: own + 'title.png', illustration: own + 'hen.png' });
export const prepareStealResultAssets = () => prepareFarmResultAssets(assets);
const pending = new Map(), shown = new Set();

/** 同一筆交易只呈現一次；儲存的只有交易 ID，不含玩家憑證或母雞名稱。 */
export async function openStealResult(scene, result, context) {
    const view = stealResultView(result);
    if (!view) return null;
    if (typeof result.transactionId !== 'string' || !result.transactionId) throw new Error('偷蛋結果缺少交易識別碼');
    const scope = JSON.stringify([context.groupId, context.accountId]), key = scope + ':' + result.transactionId;
    const storageKey = 'gugu.steal-result.shown:' + scope;
    let history = [];
    try { const value = JSON.parse(sessionStorage.getItem(storageKey) || '[]'); if (Array.isArray(value)) history = value.filter(id => typeof id === 'string'); } catch { /* 儲存不可用時仍保留本頁防重。 */ }
    if (shown.has(key) || history.includes(result.transactionId)) return { duplicate: true };
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
        const dialog = await openFarmResult(scene, view, { assets, title: '偷蛋成功', lead: '本次偷到 ', kind: 'steal', sourceRows: true, titleOverlay: true, waitForAssets: false });
        if (dialog?.root?.isConnected) {
            shown.add(key);
            try { sessionStorage.setItem(storageKey, JSON.stringify([...history, result.transactionId])); } catch { /* 不因儲存失敗影響已提交交易。 */ }
        }
        return dialog;
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
}
