import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID } from './constants.js';
import { createGameOperationsClient } from './operations-client.js?v=20261109-shop';

// Guard inventory and rent payments are changed only by the authenticated backend.
const client=createGameOperationsClient({groupId:CURRENT_GROUP_ID,accountId:CURRENT_ACCOUNT_ID});
export const loadGuardDogCatalogue=()=>client.guardDog('catalog');
export const rentDog=(breedId,days,expectedPrice)=>client.guardDog('rent',{breedId,days,...(expectedPrice===undefined?{}:{expectedPrice})});
export const activateDog=id=>client.guardDog('activate',{id});
export const releaseDog=id=>client.guardDog('release',{id});
export const expireDogs=()=>client.guardDog('expire');
