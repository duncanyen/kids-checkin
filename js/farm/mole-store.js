import {FARM_BACKEND_ENABLED,farmCommand,settleBackendBattle} from './backend-client.js';
import { runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef, getUsedSpace } from './constants.js';
import { readVillageAccess } from './villages.js';
import { MOLE_CONFIG, nextMoleMilestone, moleSettlement } from './mole-rules.js';

export function claimMoleEncounter(targetAccountId = CURRENT_ACCOUNT_ID, targetGroupId = CURRENT_GROUP_ID) {
    if(FARM_BACKEND_ENABLED)return farmCommand('claimEncounter',{monster:'mole',targetAccountId:targetAccountId||CURRENT_ACCOUNT_ID,targetGroupId:targetGroupId||CURRENT_GROUP_ID});
    const id = crypto.randomUUID();
    return runTransaction(db, async transaction => {
        await readVillageAccess(CURRENT_GROUP_ID, targetGroupId, CURRENT_ACCOUNT_ID, ref => transaction.get(ref), targetAccountId);
        const snapshot = await transaction.get(myFarmRef), farm = snapshot.data()?.farm;
        if (!farm) throw new Error('找不到玩家農場');
        const now = Date.now();
        if (farm.moleChallenge) {
            if (now < farm.moleChallenge.deadline) return { challenge: farm.moleChallenge };
            const { result, patch } = moleSettlement(farm, farm.moleChallenge, 'loss', now);
            transaction.update(myFarmRef, patch);
            return { expired: true, result };
        }
        if (farm.cobraChallenge || farm.giantChallenge) return null;
        const milestone = nextMoleMilestone(farm);
        if (milestone === null) return null;
        const challenge = {
            id, milestone, startedAt: now,
            approachEndsAt: now,
            deadline: now + MOLE_CONFIG.durationMs
        };
        transaction.update(myFarmRef, { 'farm.moleLastMilestone': milestone, 'farm.moleChallenge': challenge });
        return { challenge };
    });
}

export function settleMoleEncounter(id, outcome) {
    if(FARM_BACKEND_ENABLED)return settleBackendBattle(id);
    return runTransaction(db, async transaction => {
        // This fight affects the challenger only, even in someone else's farm.
        await readVillageAccess(CURRENT_GROUP_ID, CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, ref => transaction.get(ref), CURRENT_ACCOUNT_ID);
        const snapshot = await transaction.get(myFarmRef), farm = snapshot.data()?.farm;
        if (!farm) throw new Error('找不到玩家農場');
        const previous = (farm.moleResults || []).find(result => result.id === id);
        if (previous) return previous;
        const challenge = farm.moleChallenge;
        if (!challenge || challenge.id !== id) throw new Error('此場地鼠挑戰已結束');
        const { result, patch } = moleSettlement(farm, challenge, outcome);
        if (result.outcome === 'win') result.overflow = getUsedSpace(farm) >= (farm.warehouseLimit || 10);
        transaction.update(myFarmRef, patch);
        return result;
    });
}
