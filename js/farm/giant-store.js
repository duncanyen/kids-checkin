import { runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef, getUsedSpace } from './constants.js';
import { readVillageAccess } from './villages.js';
import { GIANT_CONFIG, nextGiantMilestone, giantSettlement } from './giant-rules.js';
export function claimGiantEncounter(targetAccountId=CURRENT_ACCOUNT_ID,targetGroupId=CURRENT_GROUP_ID) {
    const id=crypto.randomUUID();
    return runTransaction(db,async t=>{
        await readVillageAccess(CURRENT_GROUP_ID,targetGroupId,CURRENT_ACCOUNT_ID,ref=>t.get(ref),targetAccountId);
        const snap=await t.get(myFarmRef),farm=snap.data()?.farm,now=Date.now();
        if(!farm)throw Error('找不到玩家農場');
        if(farm.giantChallenge){
            if(now<farm.giantChallenge.deadline)return {challenge:farm.giantChallenge};
            const {result,patch}=giantSettlement(farm,farm.giantChallenge,'loss',now);t.update(myFarmRef,patch);return {expired:true,result};
        }
        if(farm.cobraChallenge||farm.moleChallenge)return null;
        const milestone=nextGiantMilestone(farm);if(milestone===null)return null;
        const challenge={id,milestone,startedAt:now,approachEndsAt:now+GIANT_CONFIG.approachMs,deadline:now+GIANT_CONFIG.durationMs};
        t.update(myFarmRef,{'farm.giantLastMilestone':milestone,'farm.giantChallenge':challenge});return {challenge};
    });
}
export function settleGiantEncounter(id,outcome) {
    return runTransaction(db,async t=>{
        await readVillageAccess(CURRENT_GROUP_ID,CURRENT_GROUP_ID,CURRENT_ACCOUNT_ID,ref=>t.get(ref),CURRENT_ACCOUNT_ID);
        const snap=await t.get(myFarmRef),farm=snap.data()?.farm;if(!farm)throw Error('找不到玩家農場');
        const previous=(farm.giantResults||[]).find(r=>r.id===id);if(previous)return previous;
        const challenge=farm.giantChallenge;if(!challenge||challenge.id!==id)throw Error('此場遠古巨人挑戰已結束');
        const {result,patch}=giantSettlement(farm,challenge,outcome);
        if(result.outcome==='win')result.overflow=getUsedSpace(farm)>=(farm.warehouseLimit||10);
        t.update(myFarmRef,patch);return result;
    });
}
