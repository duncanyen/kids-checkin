import {createFarmSafetyRuntime,requiresFarmUpdate,staleFarmPage} from './safety-runtime.js';
import {uncertainTransaction} from './transaction-journal.js';
import {createVerifiedInputClient} from './verified-input-client.js';
import {hitResult,batchDamage,chronologicalDamage,battleAttackAvailable} from './combat-damage.js';
import { PRIVATE_IDENTITY_ENABLED } from '../private-auth-client.js';
import { createGameOperationsClient } from './operations-client.js';
import { isUncertainSteal } from './steal-request.js';
import { readGameContext } from '../game-context.js';
import { createBattlePage } from './battle-page-client.js';
// 完整遷移、Rules 與隔離驗證通過後才開啟；不能單獨啟用此旗標。
export const FARM_BACKEND_ENABLED = true;
let client,offset=0;
const battlePage = FARM_BACKEND_ENABLED ? createBattlePage({
 request: (action,payload,id) => { client ||= createGameOperationsClient(readGameContext()); return client.farmTransaction(action,payload,id); },
 storage: sessionStorage, events: window, resume: () => window.location.reload()
}) : null;
const pending=new Map(),attacks=new Map(),settlements=new Map(),verifiedInputs=new Map();
export const farmSafety=FARM_BACKEND_ENABLED?createFarmSafetyRuntime({context:readGameContext,page:battlePage,request:(action,payload,id)=>{client ||= createGameOperationsClient(readGameContext());return client.farmTransaction(action,payload,id);},onPause:()=>{for(const c of verifiedInputs.values())c.destroy();for(const row of attacks.values()){clearTimeout(row.timer);row.timer=null;}}}):null;
export function verifiedInputFor(battle){if(battle?.inputProtocol!==1)return null;if(!verifiedInputs.has(battle.id))verifiedInputs.set(battle.id,createVerifiedInputClient(battle,{now:farmNow,request:(p,id)=>farmCommand('battleAttack',p,id),onHit:(hit,health)=>window.dispatchEvent(new CustomEvent('nexus-farm-verified-hit',{detail:{battleId:battle.id,hit,health}})),onHealth:health=>window.dispatchEvent(new CustomEvent('nexus-farm-battle-health',{detail:{battleId:battle.id,health}})),onError:error=>console.error('verified-battle-input',error.reason||error.code||error.message)}));return verifiedInputs.get(battle.id);}
window.addEventListener('pagehide',()=>{for(const c of verifiedInputs.values())c.destroy();verifiedInputs.clear();});
export const hasPendingBackendBattle=()=>settlements.size>0;
// 結算本身與背景資料同步不可排在自己後面；其他經濟操作須等伺服器確認戰鬥已結束。
const duringSettlement=new Set(['homeEncounter','visitEncounter','claimEncounter','battleAttack','battleSettle','ensureFarm','settlePoultry','settleTarget','ensureWelcome','readMail','deleteMail']);
export const farmNow=()=>Date.now()+offset;
async function send(action,payload,id,context){
 if(!FARM_BACKEND_ENABLED||!PRIVATE_IDENTITY_ENABLED)throw Error('農場共用交易尚未啟用');
 client||=createGameOperationsClient(readGameContext());
 const started=performance.now();
 const response=await battlePage.execute(action,payload,id);
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
export function farmCommand(action,payload={},explicitRequestId=null){
 const context=readGameContext(),key='nexus.farm.pending:'+JSON.stringify([context.accountId,context.groupId,action,payload]);
 if(pending.has(key))return pending.get(key);
 const previousId=sessionStorage.getItem(key)||farmSafety?.journal.find(action,payload)?.id;
 if(explicitRequestId&&previousId&&previousId!==explicitRequestId)throw Error('請先確認原交易編號');
 const id=explicitRequestId||previousId||crypto.randomUUID();
 const barriers=duringSettlement.has(action)?[]:[...settlements.values()];
 let started=false;
 const execute=()=>farmSafety.execute(action,payload,id,()=>{started=true;sessionStorage.setItem(key,id);return send(action,payload,id,context);});
 const request=barriers.length?Promise.all(barriers).then(execute):execute();
 const work=request.then(result=>{sessionStorage.removeItem(key);return result;}).catch(error=>{
  // 同一 callable 處理多種交易；只記錄動作與公開錯誤，禁止記錄 payload、收據或登入憑證。
  console.error('farm-transaction-failure',JSON.stringify({
   action,stage:started?'request':'waiting-settlement',code:error?.code||'unknown',message:error?.message||'交易未完成'
  }));
  const theft = action==='battleAttack'&&payload.damageVersion===5||action==='openChest'||action==='openChests'||action==='buyScene'||action==='setScene'||action==='cleanOwn'||action==='helpClean'||action==='stealEgg'||action==='visitEncounter'&&payload.stealWhenClear===true;
  const uncertain = uncertainTransaction(error)||requiresFarmUpdate(error)||staleFarmPage(error)||error.code==='ops/recovery-pending'|| (theft ? isUncertainSteal(error) : ['ops/timeout','functions/internal','functions/unavailable','functions/unauthenticated','functions/resource-exhausted'].includes(error.code));
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
function rowFor(id,battle){let row=attacks.get(id);if(!row){row={melee:0,ranged:0,batch:null,flushing:null,timer:null,confirmed:{melee:battle?.attacks?.melee||0,ranged:battle?.attacks?.ranged||0},battle,health:battle?.health,queue:[],batchV5:null,predictedChain:battle?.chainState||{mode:null,critical:false,streak:0}};attacks.set(id,row);}if(!row.battle&&battle){row.battle=battle;row.health=battle.health;row.confirmed={melee:battle.attacks?.melee||0,ranged:battle.attacks?.ranged||0};row.predictedChain=battle.chainState||{mode:null,critical:false,streak:0};}return row;}
async function flushBattle(id){
 const row=rowFor(id);if(row.flushing)return row.flushing;
 row.flushing=(async()=>{
  if(row.battle?.damageVersion===5){
   if(!row.batchV5&&row.queue.length){const runs=row.queue.splice(0,64);row.batchV5={battleId:id,combatVersion:2,damageVersion:5,firstAction:row.confirmed.melee+row.confirmed.ranged,attackRuns:runs};}
   if(!row.batchV5)return;const batch=row.batchV5,result=await farmCommand('battleAttack',batch);for(const run of batch.attackRuns)if(run.type!=='switch')row[run.mode]=Math.max(0,row[run.mode]-run.count);row.confirmed={...result.attacks};row.batchV5=null;
   if(result.health===0){clearTimeout(row.timer);row.timer=null;row.queue=[];row.melee=row.ranged=0;row.health=0;row.predictedChain={mode:null,critical:false,streak:0};}
   else{const pending=chronologicalDamage({...row.battle,health:result.health},row.queue,row.confirmed,result.chainState);row.predictedChain=pending.chainState;row.health=Math.max(0,result.health-pending.damage);}
   window.dispatchEvent(new CustomEvent('nexus-farm-battle-health',{detail:{battleId:id,health:row.health}}));if(row.queue.length&&!row.timer)row.timer=setTimeout(()=>{row.timer=null;void flushBattle(id).catch(()=>{});},500);return;
  }
  for(const mode of ['melee','ranged']){
   if(!row.batch&&row[mode])row.batch={battleId:id,mode,count:row[mode],...(row.battle?.combatVersion===2?{combatVersion:2,...(row.battle.damageVersion?{damageVersion:row.battle.damageVersion}:{}),firstHit:row.confirmed[mode]}:{})};
   if(!row.batch)continue;
   const batch=row.batch;
   const result=await farmCommand('battleAttack',batch);row[batch.mode]=Math.max(0,row[batch.mode]-batch.count);row.confirmed[batch.mode]+=batch.count;row.batch=null;
   if(row.battle?.combatVersion===2&&Number.isFinite(result.health)){
    const pending=['melee','ranged'].reduce((sum,kind)=>sum+batchDamage(row.battle,kind,row.confirmed[kind],row[kind]),0);
    row.health=Math.max(0,result.health-pending);
    window.dispatchEvent(new CustomEvent('nexus-farm-battle-health',{detail:{battleId:id,health:row.health}}));
   }
  }
 })().finally(()=>{row.flushing=null;});return row.flushing;
}
export const canAttackBackendBattle=battle=>!farmSafety?.blocked&&battleAttackAvailable(battle,farmNow());
export function recordBattleHit(id,mode='melee',battle,weapon,kind,onHit){
 if(!FARM_BACKEND_ENABLED||battle?.inputProtocol===1||!canAttackBackendBattle(battle))return 0;const row=rowFor(id,battle);if(row.battle?.damageVersion===5&&row.health<=0)return 0;const hit=hitResult(battle,mode,row.confirmed[mode]+row[mode],weapon,kind,row.predictedChain),damage=hit.damage;onHit?.(hit);if(!damage)return 0;row[mode]++;if(row.battle?.damageVersion===5){row.predictedChain={mode,critical:hit.critical,streak:hit.streak};const last=row.queue.at(-1);if(last?.mode===mode&&last.type!=='switch')last.count++;else row.queue.push({mode,count:1});}if(Number.isFinite(row.health))row.health=Math.max(0,row.health-damage);
 if(!row.timer)row.timer=setTimeout(()=>{row.timer=null;void flushBattle(id).catch(()=>{});},500);
 return damage;
}
/** 每批皆有固定收據。逾時保留原批次，勝負只由伺服器實際接受的攻擊決定。 */
export function settleBackendBattle(id){
 if(settlements.has(id))return settlements.get(id);
 const work=(async()=>{
  if(verifiedInputs.has(id)){const controller=verifiedInputs.get(id);if(farmNow()<controller.confirmed.deadline){try{await controller.settle();}catch(error){if(error.code!=='functions/deadline-exceeded')throw error;}}const result=await farmCommand('battleSettle',{battleId:id});controller.destroy();verifiedInputs.delete(id);return result;}
  const row=rowFor(id);clearTimeout(row.timer);row.timer=null;
  try{if(row.flushing)await row.flushing;while(row.melee||row.ranged||row.batch||row.batchV5||row.queue.length)await flushBattle(id);}
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

/** Explicit bow/melee control switch resets V5 chain even if no arrow is fired. */
export function recordBattleModeSwitch(id,mode,battle){
 if(battle?.inputProtocol===1){verifiedInputFor(battle)?.switchMode(mode);return;}
 if(battle?.damageVersion!==5||!canAttackBackendBattle(battle))return;
 const row=rowFor(id,battle);if(row.health<=0)return;
 row.predictedChain={mode,critical:false,streak:0};const last=row.queue.at(-1);if(last?.type==='switch')last.mode=mode;else row.queue.push({type:'switch',mode});
 if(!row.timer)row.timer=setTimeout(()=>{row.timer=null;void flushBattle(id).catch(()=>{});},500);
}
