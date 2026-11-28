/** Local prediction and fixed-ID batches. No SDK; transport is the existing farmCommand. */
import {evaluateInputs} from './verified-combat.js';
import {battleAttackAvailable} from './combat-damage.js';
export function createVerifiedInputClient(battle,{request,now,onHit=()=>{},onHealth=()=>{},onError=()=>{}}){
 let confirmed=structuredClone(battle),pending=[],batch=null,batchId=null,work=null,timer=null,closed=false,blocked=false;const seen=new Set();let predicted=confirmed;
 const time=()=>Math.max(confirmed.inputState.upToAt,pending.at(-1)?.at||0,Math.min(now(),battle.deadline-1));
 const payload=(events,endAt)=>({battleId:battle.id,combatVersion:2,damageVersion:battle.damageVersion,inputProtocol:1,firstInputSeq:confirmed.inputState.nextSeq,events,endAt});
 function simulate(events,endAt){return evaluateInputs(confirmed,{firstInputSeq:confirmed.inputState.nextSeq,events,endAt},endAt);}
 function apply(outcome){predicted=outcome.battle;for(const h of outcome.hits){const key=h.mode+':'+h.hitIndex;if(!seen.has(key)){seen.add(key);onHit(h,h.healthAfter);}}onHealth(predicted.health);return outcome;}
 function advance(){if(closed||blocked)return predicted;try{apply(simulate(pending,time()));}catch(e){blocked=true;onError(e);}if(predicted.health!==confirmed.health&&!timer&&!work)queue();return predicted;}
 function record(event){if(closed||blocked||pending.length>=64||!battleAttackAvailable(battle,now())||predicted.health<=0)return false;const at=time(),e={...event,seq:confirmed.inputState.nextSeq+pending.length,at};try{const outcome=simulate([...pending,e],at);pending.push(e);apply(outcome);queue();return true;}catch(e){if(!['INPUT_MELEE_RATE','INPUT_BOW_RATE','INPUT_SHORT_PULL','INPUT_TAP_POINT'].includes(e.reason))onError(e);return false;}}
 function queue(){if(!timer&&!closed&&!blocked)timer=setTimeout(()=>{timer=null;void flush().catch(()=>{});},500);}
 async function flush(){if(closed)throw Error('INPUT_CLIENT_CLOSED');if(work)return work;clearTimeout(timer);timer=null;
  work=Promise.resolve().then(async()=>{advance();if(blocked)throw Error('INPUT_CLIENT_BLOCKED');if(!batch){if(!pending.length&&predicted.health===confirmed.health&&predicted.inputState.arrows.length===confirmed.inputState.arrows.length)return;const events=pending.slice(0,64),endAt=events.length<pending.length?events.at(-1).at:time();batch=payload(events,endAt);batchId=crypto.randomUUID();}
   const r=await request(batch,batchId);confirmed={...confirmed,health:r.health,attacks:r.attacks,chainState:r.chainState,actionCount:r.actionCount,inputState:r.inputState,lastAttackAt:r.hits?.at(-1)?.at||confirmed.lastAttackAt};pending.splice(0,batch.events.length);batch=null;batchId=null;apply({battle:confirmed,hits:r.hits||[]});if(confirmed.health===0)pending=[];apply(simulate(pending,time()));
  }).catch(e=>{if(!['ops/timeout','functions/unavailable','functions/internal','functions/unauthenticated','functions/resource-exhausted'].includes(e.code))blocked=true;onError(e);throw e;}).finally(()=>{work=null;if(pending.length&&!timer&&!closed&&!blocked)queue();});return work;
 }
 async function settle(){clearTimeout(timer);timer=null;for(let n=0;n<10;n++){if(work)await work;advance();if(!batch&&!pending.length&&predicted.health===confirmed.health)break;await flush();}return confirmed;}
 return{tap:p=>record({type:'tap',x:p.x,y:p.y}),shoot:(origin,pull)=>record({type:'shoot',origin,pull}),switchMode:mode=>record({type:'switch',mode}),advance,flush,settle,get current(){return predicted;},get confirmed(){return confirmed;},get pendingCount(){return pending.length;},destroy(){closed=true;clearTimeout(timer);}};
}
