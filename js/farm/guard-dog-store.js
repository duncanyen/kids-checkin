import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID } from './constants.js';
import { createGameOperationsClient } from './operations-client.js?v=20261109-shop';

// Guard inventory and rent payments are changed only by the authenticated backend.
const client=createGameOperationsClient({groupId:CURRENT_GROUP_ID,accountId:CURRENT_ACCOUNT_ID});
export const loadGuardDogCatalogue=()=>client.guardDog('catalog');
export const rentDog=(breedId,days,expectedPrice)=>client.guardDog('rent',{breedId,days,...(expectedPrice===undefined?{}:{expectedPrice})});
// 拒絕向仍會刪除租約的舊後端送出解除／重啟操作，確保保留餘額的承諾成立。
async function pausedLeaseAction(action,id){
    const catalog=await loadGuardDogCatalogue();
    if(catalog?.leasePolicy!=='pausable-v1')throw new Error('護衛犬服務更新中，請稍後再試。');
    return client.guardDog(action,{id});
}
// 使用新動作名稱：即使流量暫時落到舊版服務，也只會拒絕，不會刪除租約或重設天數。
export const activateDog=id=>pausedLeaseAction('resume',id);
export const releaseDog=id=>pausedLeaseAction('pause',id);
export const expireDogs=()=>client.guardDog('expire');
