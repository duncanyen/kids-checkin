/** Phase 2 client repository. No direct Firestore writes and no refinement API. */
import { farmCommand } from './backend-client.js';
import { readGameContext } from '../game-context.js';
export const weaponInstanceEnabled = false;
export const usesWeaponInstances = farm => farm?.weaponSchemaVersion === 2;
const pendingKey=()=>{const c=readGameContext();return 'nexus.weapon.pending:'+JSON.stringify([c.user.docId||null,c.groupId,c.accountId]);};
export function pendingWeaponAction(){try{return JSON.parse(sessionStorage.getItem(pendingKey()))||null;}catch{return null;}}
const uncertain=error=>!error.code||['ops/timeout','functions/deadline-exceeded','functions/unavailable','functions/internal','functions/unknown','functions/unauthenticated','functions/cancelled'].includes(error.code);
export async function mutateWeapon(action,payload){
    const key=pendingKey(),previous=pendingWeaponAction(),command={action,payload};
    if(previous&&JSON.stringify(previous)!==JSON.stringify(command))throw Error('請先確認上一筆武器操作結果');
    sessionStorage.setItem(key,JSON.stringify(command));
    try{const result=await farmCommand(action,payload);sessionStorage.removeItem(key);return result;}
    catch(error){if(!uncertain(error))sessionStorage.removeItem(key);throw error;}
}
export const weaponRepository={
    list:options=>farmCommand('listWeapons',options||{}),
    get:instanceId=>farmCommand('getWeapon',{instanceId}),
    equip:item=>mutateWeapon('equipWeapon',{item:item.weaponId,instanceId:item.instanceId,currentlyEquipped:item.equipped,expectedWeaponRevision:item.ownerRevision}),
    sell:item=>mutateWeapon('sellItem',{item:item.weaponId,quantity:1,instanceIds:[item.instanceId],expectedWeaponRevision:item.ownerRevision}),
    discard:item=>mutateWeapon('discardItem',{item:item.weaponId,instanceId:item.instanceId,expectedWeaponRevision:item.ownerRevision})
};
