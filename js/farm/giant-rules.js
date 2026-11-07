import { ENEMY_HEALTH } from './combat-rules.js';
export const GIANT_CONFIG = Object.freeze({health:ENEMY_HEALTH.giant,minCoopLevel:3,killInterval:50,approachMs:7000,durationMs:70000,coinPenalty:300,size:208});
export const ANCIENT_STONE_PRICE = 600;
export const giantKillTotal = farm => ['wolf','tiger'].reduce((n,key)=>n+Math.max(0,Math.trunc(farm?.combatKills?.[key]||0)),0);
export function nextGiantMilestone(farm) {
    const next=(Math.floor((farm?.giantLastMilestone||0)/GIANT_CONFIG.killInterval)+1)*GIANT_CONFIG.killInterval;
    return (farm?.coopLevel||1)>=GIANT_CONFIG.minCoopLevel && giantKillTotal(farm)>=next ? next : null;
}
export const giantDue = farm => !!farm?.giantChallenge || nextGiantMilestone(farm)!==null;
export function giantSettlement(farm,challenge,outcome,now=Date.now()) {
    if(!['win','loss'].includes(outcome))throw Error('無效的戰鬥結果');
    const previous=(farm.giantResults||[]).find(r=>r.id===challenge.id);
    if(previous)return {result:previous,patch:{}};
    if(farm.giantChallenge?.id!==challenge.id)throw Error('此場遠古巨人挑戰已結束');
    const result={id:challenge.id,milestone:challenge.milestone,outcome:now>=challenge.deadline?'loss':outcome};
    const patch={'farm.giantChallenge':null};
    if(result.outcome==='win')patch['farm.ancientStones']=(farm.ancientStones||0)+1;
    else {result.coinsLost=Math.min(GIANT_CONFIG.coinPenalty,Math.max(0,farm.coins||0));patch['farm.coins']=Math.max(0,(farm.coins||0)-GIANT_CONFIG.coinPenalty);}
    patch['farm.giantResults']=[...(farm.giantResults||[]).slice(-31),result];
    return {result,patch};
}
