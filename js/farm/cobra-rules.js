import { ENEMY_HEALTH } from './combat-rules.js';
import { killTotal } from './combat-progress.js';

export const COBRA_CONFIG = Object.freeze({
    health: ENEMY_HEALTH.cobra,
    approachMs: 8000,
    durationMs: 50000,
    coinPenalty: 200,
    size: 160
});
export const COBRA_FANG_PRICE = 600;

export function nextCobraMilestone(farm) {
    const last = Math.max(0, Number(farm?.cobraLastMilestone || 0));
    const next = (Math.floor(last / 100) + 1) * 100;
    return (farm?.coopLevel || 1) >= 2 && killTotal(farm) >= next ? next : null;
}

export const cobraDue = farm => !!farm?.cobraChallenge || nextCobraMilestone(farm) !== null;

export function cobraSettlement(farm, challenge, outcome, now = Date.now()) {
    if (!['win', 'loss'].includes(outcome)) throw new Error('無效的戰鬥結果');
    const previous = (farm.cobraResults || []).find(result => result.id === challenge.id);
    if (previous) return { result: previous, patch: {} };
    if (farm.cobraChallenge?.id !== challenge.id) throw new Error('此場蛇王挑戰已結束，請重新確認存檔。');

    const finalOutcome = now >= challenge.deadline ? 'loss' : outcome;
    const result = { id: challenge.id, milestone: challenge.milestone, outcome: finalOutcome };
    const patch = { 'farm.cobraChallenge': null };
    if (finalOutcome === 'win') {
        patch['farm.cobraFangs'] = (farm.cobraFangs || 0) + 1;
    } else {
        result.coinsLost = Math.min(COBRA_CONFIG.coinPenalty, Math.max(0, farm.coins || 0));
        patch['farm.coins'] = Math.max(0, (farm.coins || 0) - COBRA_CONFIG.coinPenalty);
    }
    patch['farm.cobraResults'] = [...(farm.cobraResults || []).slice(-31), result];
    return { result, patch };
}
