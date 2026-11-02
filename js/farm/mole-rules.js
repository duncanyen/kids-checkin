import { ENEMY_HEALTH } from './combat-rules.js';
export const MOLE_CONFIG = Object.freeze({ health: ENEMY_HEALTH.mole, flightMs: 0, durationMs: 60000, catchInterval: 40 });
export function nextMoleMilestone(farm) {
    const next = (Math.floor((farm?.moleLastMilestone || 0) / MOLE_CONFIG.catchInterval) + 1) * MOLE_CONFIG.catchInterval;
    return (farm?.coopLevel || 1) >= 2 && (farm?.gardenCatchCount || 0) >= next ? next : null;
}
export const moleDue = farm => !!farm?.moleChallenge || nextMoleMilestone(farm) !== null;
export function moleSettlement(farm, challenge, outcome, now = Date.now()) {
    if (!['win','loss'].includes(outcome)) throw Error('無效的戰鬥結果');
    const previous = (farm.moleResults || []).find(r => r.id === challenge.id);
    if (previous) return { result: previous, patch: {} };
    if (farm.moleChallenge?.id !== challenge.id) throw Error('此場地鼠挑戰已結束');
    const result = { id: challenge.id, milestone: challenge.milestone, outcome: now >= challenge.deadline ? 'loss' : outcome };
    const patch = { 'farm.moleChallenge': null };
    if (result.outcome === 'win') patch['farm.sweetPotatoes'] = (farm.sweetPotatoes || 0) + 1;
    else {
        result.coinsLost = Math.min(100, Math.max(0, farm.coins || 0));
        patch['farm.coins'] = Math.max(0, (farm.coins || 0) - 100);
    }
    patch['farm.moleResults'] = [...(farm.moleResults || []).slice(-31), result];
    return { result, patch };
}
export function moleCells(bounds) {
    const width = (bounds.right-bounds.left)/4, height = (bounds.bottom-bounds.top)/3;
    return Array.from({length:12},(_,i)=>({x:bounds.left+(i%4+.5)*width,y:bounds.top+(Math.floor(i/4)+.5)*height,width,height}));
}

// Three distinct holes per exposure; each mole moves away from its last hole.
export function nextMoleCells(previous = [], roll = (min,max) => Phaser.Math.Between(min,max)) {
    const chosen=[];
    for (let i=0;i<3;i++) {
        const available=Array.from({length:12},(_,n)=>n).filter(n=>!chosen.includes(n) && n!==previous[i]);
        chosen.push(available[roll(0,available.length-1)]);
    }
    return chosen;
}
