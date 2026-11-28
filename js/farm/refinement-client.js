/** Durable scoped operation recovery. Only the backend supplies stats, prices and outcomes. */
import { farmCommand } from './backend-client.js';
import { readGameContext } from '../game-context.js';
const key=()=>{const c=readGameContext();return 'nexus.refinement.pending.v1:'+JSON.stringify([c.user.docId,c.groupId,c.accountId]);};
const uncertain=e=>!e.code||['ops/timeout','functions/deadline-exceeded','functions/unavailable','functions/internal','functions/unknown','functions/unauthenticated','functions/cancelled','functions/resource-exhausted'].includes(e.code);
let inflight=null,inflightScope=null;
export function pendingRefinement(){const value=localStorage.getItem(key());if(!value)return null;const p=JSON.parse(value);if(p.schemaVersion!==1||!['refineWeapon','resetRefinement'].includes(p.action)||typeof p.requestId!=='string'||!p.payload?.instanceId||!['club','mace','battleaxe','ironhammer','katana','shortbow','huntingbow','paladinbow'].includes(p.display?.weaponId))throw Error('待確認交易紀錄異常，請保留資料並聯絡管理員');return p;}
export const refinementClient={
 capabilities:async()=>{try{return await farmCommand('getRefinementCapabilities');}catch(error){if(['functions/invalid-argument','functions/unimplemented'].includes(error.code))return{detailsAvailable:false,refinementEnabled:false,resetEnabled:false,refinedSalesEnabled:false};throw error;}},details:id=>farmCommand('getWeaponDetails',{instanceId:id}),
 preview:id=>farmCommand('previewRefinement',{instanceId:id}),resetPreview:id=>farmCommand('previewRefinementReset',{instanceId:id})
};
async function execute(p){
 const scopeKey=key();
 try{const result=await farmCommand(p.action,p.payload,p.requestId);if(scopeKey===key())localStorage.removeItem(scopeKey);return result;}
 catch(error){if(!uncertain(error)&&scopeKey===key())localStorage.removeItem(scopeKey);throw error;}
}
export function startRefinement(action,quote){
 if(!['refineWeapon','resetRefinement'].includes(action))throw Error('不支援的精煉操作');
 if(inflight)return inflightScope===key()?inflight:Promise.reject(Error('另一個群組操作仍在確認中，請稍後重試'));
 if(pendingRefinement())return Promise.reject(Error('請先確認上次精煉或解除結果'));
 const p={schemaVersion:1,action,requestId:crypto.randomUUID(),display:{weaponId:quote.weaponId},payload:{instanceId:quote.instanceId,quoteId:quote.quoteId,configVersion:quote.configVersion,expectedLevel:quote.currentLevel}};
 localStorage.setItem(key(),JSON.stringify(p));
 inflightScope=key();inflight=execute(p).finally(()=>{inflight=null;inflightScope=null;});return inflight;
}
export function recoverRefinement(){
 if(inflight)return inflightScope===key()?inflight:Promise.reject(Error('另一個群組操作仍在確認中，請稍後重試'));
 const p=pendingRefinement();if(!p)return Promise.reject(Error('沒有待確認交易'));
 const scopeKey=key();inflightScope=scopeKey;
 inflight=(async()=>{let found;try{found=await farmCommand(p.action==='resetRefinement'?'getRefinementResetResult':'getRefinementResult',{transactionId:p.requestId});}catch(error){if(error.code!=='functions/not-found')throw error;}
  if(found?.status==='completed'){if(scopeKey===key())localStorage.removeItem(scopeKey);return found;}
  if(found?.status==='rejected'){if(scopeKey===key())localStorage.removeItem(scopeKey);throw Error(found.error?.message||'原交易已拒絕，未扣款');}
  if(scopeKey!==key())throw Error('帳號或群組已切換，停止恢復');
  return execute(p);
 })().finally(()=>{inflight=null;inflightScope=null;});return inflight;
}
