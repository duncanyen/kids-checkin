import { runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef, getUsedSpace } from './constants.js';
import { readVillageAccess } from './villages.js';
import { COBRA_CONFIG, nextCobraMilestone, cobraSettlement } from './cobra-rules.js';

export function claimCobraEncounter(targetAccountId = CURRENT_ACCOUNT_ID, targetGroupId = CURRENT_GROUP_ID) {
    const id = crypto.randomUUID();
    return runTransaction(db, async transaction => {
        await readVillageAccess(CURRENT_GROUP_ID, targetGroupId, CURRENT_ACCOUNT_ID, ref => transaction.get(ref), targetAccountId);
        const snapshot = await transaction.get(myFarmRef), farm = snapshot.data()?.farm;
        if (!farm) throw new Error('找不到玩家農場');
        const now = Date.now();
        if (farm.cobraChallenge) {
            if (now < farm.cobraChallenge.deadline) return { challenge: farm.cobraChallenge };
            const { result, patch } = cobraSettlement(farm, farm.cobraChallenge, 'loss', now);
            transaction.update(myFarmRef, patch);
            return { expired: true, result };
        }
        if(farm.giantChallenge)return null;
        const milestone = nextCobraMilestone(farm);
        if (milestone === null) return null;
        const challenge = {
            id, milestone, startedAt: now,
            approachEndsAt: now + COBRA_CONFIG.approachMs,
            deadline: now + COBRA_CONFIG.durationMs
        };
        transaction.update(myFarmRef, { 'farm.cobraLastMilestone': milestone, 'farm.cobraChallenge': challenge });
        return { challenge };
    });
}

export function settleCobraEncounter(id, outcome) {
    return runTransaction(db, async transaction => {
        // This fight affects the challenger only, even in someone else's farm.
        await readVillageAccess(CURRENT_GROUP_ID, CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, ref => transaction.get(ref), CURRENT_ACCOUNT_ID);
        const snapshot = await transaction.get(myFarmRef), farm = snapshot.data()?.farm;
        if (!farm) throw new Error('找不到玩家農場');
        const previous = (farm.cobraResults || []).find(result => result.id === id);
        if (previous) return previous;
        const challenge = farm.cobraChallenge;
        if (!challenge || challenge.id !== id) throw new Error('此場蛇王挑戰已結束');
        const { result, patch } = cobraSettlement(farm, challenge, outcome);
        if (result.outcome === 'win') result.overflow = getUsedSpace(farm) >= (farm.warehouseLimit || 10);
        transaction.update(myFarmRef, patch);
        return result;
    });
}
