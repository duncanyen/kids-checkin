import { BossEncounter } from './dragon.js';
import { GORILLA_CONFIG, GORILLA_FANG_PRICE } from './gorilla-rules.js';
import { db } from '../firebase-config.js';
import { doc, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef, getUsedSpace, LAY_EGG_TIME_MS } from './constants.js';
import { readVillageAccess } from './villages.js';

export function registerGorillaAnimations(scene) {
    for (const [action, row, repeat] of [['run',0,-1],['attack',1,-1],['hit',2,0],['dead',3,0]]) {
        if (!scene.anims.exists(`gorilla_${action}`)) scene.anims.create({
            key: `gorilla_${action}`,
            frames: scene.anims.generateFrameNumbers('gorilla', { start: row * 4, end: row * 4 + 3 }),
            frameRate: action === 'hit' ? 14 : action === 'dead' ? 6 : 8, repeat,
        });
    }
}

// Rewards/coins belong to the visitor's source farm; lost eggs belong to the target coop.
export async function settleGorillaEncounter(id, outcome, targetAccountId = CURRENT_ACCOUNT_ID, targetGroupId = CURRENT_GROUP_ID) {
    if (!['win','loss'].includes(outcome)) throw new Error('無效的戰鬥結果');
    const targetRef = doc(db, 'groups', targetGroupId, 'users', targetAccountId);
    return runTransaction(db, async transaction => {
        await readVillageAccess(CURRENT_GROUP_ID, targetGroupId, CURRENT_ACCOUNT_ID, ref => transaction.get(ref), targetAccountId);
        const snapshot = await transaction.get(myFarmRef), farm = snapshot.data()?.farm;
        if (!farm) throw new Error('找不到玩家農場');
        const results = farm.gorillaResults || [];
        const previous = results.find(result => result.id === id);
        if (previous) return previous;
        const updates = {}, result = { id, outcome, targetGroupId, targetAccountId };
        if (outcome === 'win') {
            updates['farm.gorillaFangs'] = (farm.gorillaFangs || 0) + 1;
            result.overflow = getUsedSpace(farm) >= (farm.warehouseLimit || 10);
        } else {
            result.coinsLost = Math.min(GORILLA_CONFIG.coinPenalty, Math.max(0, farm.coins || 0));
            updates['farm.coins'] = Math.max(0, (farm.coins || 0) - GORILLA_CONFIG.coinPenalty);
            const targetSnapshot = targetRef.path === myFarmRef.path ? snapshot : await transaction.get(targetRef);
            const target = targetSnapshot.data()?.farm;
            if (!target) throw new Error('找不到目標雞舍');
            const eggUpdates = { 'farm.eggsReady': 0 };
            if (Number.isFinite(target.lastLayTime)) {
                const now = Date.now(), total = Math.max(1, target.hens || 1);
                const healthy = (target.hensState || []).filter(hen => !hen.isSick).length;
                const interval = Math.floor(LAY_EGG_TIME_MS / Math.max(1, healthy || total));
                const ticks = Math.max(0, Math.floor((now - target.lastLayTime) / interval));
                eggUpdates['farm.lastLayTime'] = (target.eggsReady || 0) >= total * 6 ? now : target.lastLayTime + ticks * interval;
            }
            if (targetRef.path === myFarmRef.path) Object.assign(updates, eggUpdates);
            else transaction.update(targetRef, eggUpdates);
        }
        updates['farm.gorillaResults'] = [...results.slice(-31), result];
        transaction.update(myFarmRef, updates);
        return result;
    });
}

export class GorillaEncounter extends BossEncounter {
    constructor(scene) {
        super(scene, {
            key: 'gorilla', name: '大金剛', config: GORILLA_CONFIG, size: 208, frameSize: 314,
            // Atlas pivots keep every run, punch, hurt and death frame grounded.
            spawnX: 94, minX: 94, approachInset: 22, escapeRise: 0,
            travel: 'run', attack: 'attack', attackPhase: 'attack',
            movingLabel: '奔向雞舍中', attackLabel: '揮拳攻擊中', reward: '猩猩尖牙',
            salePrice: GORILLA_FANG_PRICE, settle: settleGorillaEncounter,
        });
    }
}
