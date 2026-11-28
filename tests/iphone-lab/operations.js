import {labFetch} from '/lab/client.js';
export const GAME_OPERATIONS_ENABLED=true,GAME_ANNOUNCEMENTS_ENABLED=true,GAME_REDEMPTION_ENABLED=false;
export function createGameOperationsClient(){const request=(name,action,payload={},requestId=crypto.randomUUID())=>labFetch('/lab/rpc',{name,action,payload,requestId});return{
 farmTransaction:(action,payload={},id)=>request('gameOpsFarmTransaction',action,payload,id),
 dailyChallenges:(action,payload={})=>request('gameOpsDailyChallenges',action,payload),
 guardDog:(action,payload={})=>request('gameOpsGuardDog',action,payload),
 announcementFeeds:known=>request('gameOpsAnnouncements','feeds',{known}),
 announcements:(cursor,channel)=>request('gameOpsAnnouncements',undefined,{cursor,channel}),
 farmRanking:ranking=>request('gameOpsAnnouncements','ranking',{ranking}),
 redeem:()=>Promise.reject(Error('隔離驗收站不提供正式禮包登入／兌換'))
};}
