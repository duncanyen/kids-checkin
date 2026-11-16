import { PRIVATE_IDENTITY_ENABLED } from '../private-auth-client.js';
import { createGameOperationsClient } from './operations-client.js';
import { isUncertainSteal } from './steal-request.js';
import { readGameContext } from '../game-context.js';
// 完整遷移、Rules 與隔離驗證通過後才開啟；不能單獨啟用此旗標。
export const FARM_BACKEND_ENABLED = true;
let client,offset=0;
const pending=new Map(),attacks=new Map(),settlements=new Map();
export const hasPendingBackendBattle=()=>settlements.size>0;
// 結算本身與背景資料同步不可排在自己後面；其他經濟操作須等伺服器確認戰鬥已結束。
const duringSettlement=new Set(['homeEncounter','visitEncounter','claimEncounter','battleAttack','battleSettle','ensureFarm','settlePoultry','settleTarget','ensureWelcome','readMail','deleteMail']);
export const farmNow=()=>Date.now()+offset;
async function send(action,payload,id,context){
 if(!FARM_BACKEND_ENABLED||!PRIVATE_IDENTITY_ENABLED)throw Error('農場共用交易尚未啟用');
 client||=createGameOperationsClient(readGameContext());
 const started=performance.now();
 const response=await client.farmTransaction(action,payload,id);
 if(['visitEncounter','stealEgg'].includes(action)){
  console.info('farm-theft-latency',{action,combined:payload.stealWhenClear===true,roundTripMs:Math.round(performance.now()-started),serverTimingAvailable:!!response.timing,...response.timing});
 }
 if(Number.isFinite(response.serverNow))offset=response.serverNow-Date.now();
 const result=response.result;
 const legacyProgress=action==='collectEggs'&&result?.total>0||action==='helpClean'||result?.harvest?.total>0||result?.outcome==='win'||result?.result?.outcome==='win';
 if(response.dailyProgress||legacyProgress){
  // 只通知相同帳號／群組的 UI；事件不授予發獎權限，真正領獎仍由後端交易驗證。
  window.dispatchEvent(new CustomEvent('nexus-farm-daily-progress',{detail:{accountId:context.accountId,groupId:context.groupId,progress:response.dailyProgress||null}}));
 }
 return response.result;
}
/** 逾時保留同一 requestId；明確拒絕才釋放，避免下一次不同操作重用收據。 */
export function farmCommand(action,payload={}){
 const context=readGameContext(),key='nexus.farm.pending:'+JSON.stringify([context.accountId,context.groupId,action,payload]);
 if(pending.has(key))return pending.get(key);
 const id=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,id);
 const barriers=duringSettlement.has(action)?[]:[...settlements.values()];
 let started=false;
 const execute=()=>{started=true;return send(action,payload,id,context);};
 const request=barriers.length?Promise.all(barriers).then(execute):execute();
 const work=request.then(result=>{sessionStorage.removeItem(key);return result;}).catch(error=>{
  // 同一 callable 處理多種交易；只記錄動作與公開錯誤，禁止記錄 payload、收據或登入憑證。
  console.error('farm-transaction-failure',JSON.stringify({
   action,stage:started?'request':'waiting-settlement',code:error?.code||'unknown',message:error?.message||'交易未完成'
  }));
  const theft = action==='stealEgg'||action==='visitEncounter'&&payload.stealWhenClear===true;
  const uncertain = theft ? isUncertainSteal(error) : ['ops/timeout','functions/internal','functions/unavailable','functions/unauthenticated','functions/resource-exhausted'].includes(error.code);
  if(!uncertain)sessionStorage.removeItem(key);
  throw error;
 }).finally(()=>pending.delete(key));pending.set(key,work);return work;
}
/** 找回此村落尚未確認的偷蛋請求；只重播原 payload，不因快照已更新而另開交易。 */
export function pendingStealCommand(target) {
 const context=readGameContext();
 for(const action of ['visitEncounter','stealEgg'])for(const payload of action==='stealEgg'?[target]:[ {...target,reusePermit:true,verifyOnly:true,stealWhenClear:true}, {...target,reusePermit:false,verifyOnly:true,stealWhenClear:true}, {...target,reusePermit:true,stealWhenClear:true}, {...target,reusePermit:false,stealWhenClear:true} ]){
  const key='nexus.farm.pending:'+JSON.stringify([context.accountId,context.groupId,action,payload]);
  if(sessionStorage.getItem(key))return {action,payload};
 }
 return null;
}
export const farmCommandOrLegacy=(action,payload,legacy)=>FARM_BACKEND_ENABLED?farmCommand(action,payload):legacy();
function rowFor(id){let row=attacks.get(id);if(!row){row={melee:0,ranged:0,batch:null,flushing:null,timer:null};attacks.set(id,row);}return row;}
async function flushBattle(id){
 const row=rowFor(id);if(row.flushing)return row.flushing;
 row.flushing=(async()=>{
  for(const mode of ['melee','ranged']){
   if(!row.batch&&row[mode])row.batch={battleId:id,mode,count:row[mode]};
   if(!row.batch)continue;
   const batch=row.batch;
   await farmCommand('battleAttack',batch);row[batch.mode]=Math.max(0,row[batch.mode]-batch.count);row.batch=null;
  }
 })().finally(()=>{row.flushing=null;});return row.flushing;
}
export function recordBattleHit(id,mode='melee'){
 if(!FARM_BACKEND_ENABLED)return;const row=rowFor(id);row[mode]++;
 if(!row.timer)row.timer=setTimeout(()=>{row.timer=null;void flushBattle(id).catch(()=>{});},500);
}
/** 每批皆有固定收據。逾時保留原批次，勝負只由伺服器實際接受的攻擊決定。 */
export function settleBackendBattle(id){
 if(settlements.has(id))return settlements.get(id);
 const work=(async()=>{
  const row=rowFor(id);clearTimeout(row.timer);row.timer=null;
  try{if(row.flushing)await row.flushing;while(row.melee||row.ranged||row.batch)await flushBattle(id);}
  catch(error){if(error.code!=='functions/deadline-exceeded')throw error;}
  const result=await farmCommand('battleSettle',{battleId:id});attacks.delete(id);return result;
 })().finally(()=>settlements.delete(id));
 settlements.set(id,work);return work;
}
export const visitPayload=scene=>({targetGroupId:scene.targetGroupId,targetAccountId:scene.targetAccountId});

/** 後端保留原戰鬥目標；拜訪中遇到其他雞舍的事件只提示，不擅自更換玩家的拜訪位置。 */
export function routeBackendChallenge(scene,claim){
 if(!FARM_BACKEND_ENABLED||!claim?.challenge)return true;
 const challenge=claim.challenge,context=readGameContext();
 if((scene.targetGroupId||context.groupId)===challenge.targetGroupId&&(scene.targetAccountId||context.accountId)===challenge.targetAccountId){scene.backendChallenge=challenge;return true;}
 if(scene.scene.key==='VisitScene'){
  scene.backendChallenge=null;scene.visitEncounterReady=false;
  scene.showFloatingText('其他雞舍尚有怪物事件未結算，請返回自家農場處理後再試。','#FFD54F',14);
  return false;
 }
 scene.scene.start('VisitScene',{targetGroupId:challenge.targetGroupId,targetAccountId:challenge.targetAccountId,targetName:challenge.targetName||challenge.targetAccountId});return false;
}
