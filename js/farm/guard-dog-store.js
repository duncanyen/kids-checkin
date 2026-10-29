import { doc, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase-config.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef } from './constants.js';
import { rentGuardDog, activateGuardDog, releaseGuardDog, guardDogLeases } from './guard-dog-core.js';

async function changeDogs(change) {
    return runTransaction(db, async transaction => {
        const group = await transaction.get(doc(db, 'groups', CURRENT_GROUP_ID));
        if (!group.exists() || !group.data().members?.includes(CURRENT_ACCOUNT_ID)) throw new Error('無法確認群組資格');
        const snapshot = await transaction.get(myFarmRef), farm = snapshot.data()?.farm;
        if (!farm) throw new Error('找不到農場存檔');
        const patch = change(farm, Date.now());
        if (patch) transaction.update(myFarmRef, patch);
        return patch;
    });
}
export function rentDog(breedId, days) {
    const id = crypto.randomUUID();
    return changeDogs((farm, now) => rentGuardDog(farm, breedId, days, id, now));
}
export const activateDog = id => changeDogs((farm, now) => activateGuardDog(farm, id, now));
export const releaseDog = id => changeDogs((farm, now) => releaseGuardDog(farm, id, now));
export const expireDogs = () => changeDogs((farm, now) => {
    const dogs = guardDogLeases(farm, now);
    return dogs.length !== (farm.guardDogs || []).length ? { 'farm.guardDogs': dogs } : null;
});
