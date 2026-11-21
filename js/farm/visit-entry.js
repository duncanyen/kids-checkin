import { cobraDue } from './cobra-rules.js';
import { giantDue } from './giant-rules.js';
import { moleDue } from './mole-rules.js';

/** 與拜訪原有里程碑優先順序一致；只在選定雞舍的載入階段使用。 */
export function visitEntryMilestone(farm) {
    if (farm?.giantChallenge) return 'giant';
    if (farm?.moleChallenge) return 'mole';
    return cobraDue(farm) ? 'cobra' : giantDue(farm) ? 'giant' : moleDue(farm) ? 'mole' : null;
}

/**
 * 預先取得伺服器進場結果，不偷蛋、不另計任務。已逾時的舊戰鬥保留原目標結算。
 * @param {Object} context - 目前選定的群組、雞舍與來源農場快照。
 * @param {Object} dependencies - command 為既有 farmCommand；active 防止過期選擇切場景。
 * @returns {Promise<Object|null>} 伺服器結果；取消選擇時回傳 null。
 */
export async function prepareVisitEntry(context, { command, active }) {
    if (!active()) return null;
    const target = { targetGroupId: context.targetGroupId, targetAccountId: context.targetAccountId };
    // The server owns milestone thresholds and probabilities; a stale farm snapshot
    // must not decide which monster is requested during village loading.
    let authorized = await command('visitEncounter', target);
    if (!active()) return null;
    if (authorized?.result && !authorized.challenge) {
        authorized = await command('visitEncounter', { ...target, reusePermit: true });
        if (!active()) return null;
    }
    if (authorized?.result && !authorized.challenge) throw Error('進場狀態持續變動，請重新選擇雞舍。');
    const battle = authorized?.challenge;
    if (battle && (battle.targetGroupId !== target.targetGroupId || battle.targetAccountId !== target.targetAccountId)) {
        throw Error('其他雞舍尚有怪物事件未結算，請先返回自家農場處理。');
    }
    return { ...target, authorized };
}
