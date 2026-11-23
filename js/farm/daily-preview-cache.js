/** Read-only, account/group-scoped UI preview. A preview NEVER authorizes a reward. */
const VERSION=2,DAY=86400000;
const key=context=>'gugu.daily.preview.v2:'+JSON.stringify([context.accountId,context.groupId]);
const sameScope=(value,context)=>value?.scopeVersion===VERSION&&value.accountId===context.accountId&&value.groupId===context.groupId;
function validState(value){
    if(!value||!Number.isFinite(value.serverNow)||!Number.isFinite(value.nextResetAt)||value.nextResetAt<=value.serverNow||value.nextResetAt-value.serverNow>DAY||!/^\d{4}-\d{2}-\d{2}$/.test(value.dateKey))return false;
    return ['checkin','mission'].every(type=>{
        const c=value.challenges?.[type];
        return c&&Number.isInteger(c.day)&&c.day>=1&&c.day<=7&&typeof c.cycleId==='string'
            &&Array.isArray(c.rewards)&&c.rewards.length===7&&c.rewards.every(n=>Number.isSafeInteger(n)&&n>0)
            &&Array.isArray(c.tasks)&&c.tasks.length<=3&&c.tasks.every(t=>typeof t.type==='string'&&typeof t.name==='string'&&Number.isInteger(t.target)&&t.target>0&&Number.isInteger(t.count)&&t.count>=0&&t.count<=t.target);
    });
}
export function readDailyPreview(context,{storage,now=Date.now()}={}){
    try{
        storage ||= globalThis.localStorage;
        const saved=JSON.parse(storage.getItem(key(context))||'null');
        if(!saved)return null;
        const elapsed=now-saved.savedAt;
        if(saved.version!==VERSION||!Number.isFinite(elapsed)||elapsed<0||elapsed>=DAY||!validState(saved.state)||!sameScope(saved.state,context)||saved.state.serverNow+elapsed>=saved.state.nextResetAt){storage.removeItem(key(context));return null;}
        const result=saved.state;result.serverNow+=elapsed;
        for(const challenge of Object.values(result.challenges))challenge.canClaim=false;
        return result;
    }catch{return null;}
}
export function writeDailyPreview(context,value,{storage,now=Date.now()}={}){
    try{
        storage ||= globalThis.localStorage;
        if(!validState(value)||!sameScope(value,context))return;
        // Store only display data, never credentials or Auth tokens.
        const state={scopeVersion:VERSION,accountId:context.accountId,groupId:context.groupId,serverNow:value.serverNow,nextResetAt:value.nextResetAt,dateKey:value.dateKey,timeZone:'Asia/Taipei',challenges:{}};
        for(const type of ['checkin','mission']){
            const c=value.challenges[type];
            state.challenges[type]={type,day:c.day,cycleId:c.cycleId,rewards:c.rewards,tasks:c.tasks.map(t=>({type:t.type,name:t.name,target:t.target,enabled:t.enabled,count:t.count,verified:t.verified,reason:t.reason})),
                enabled:c.enabled,claimed:c.claimed,claimedAt:c.claimedAt||null,grantId:c.grantId||null,
                blocked:c.blocked,canClaim:false,missedDayPolicy:c.missedDayPolicy};
        }
        storage.setItem(key(context),JSON.stringify({version:VERSION,savedAt:now,state}));
    }catch{ /* Storage limits/private mode must not prevent playing or claiming. */ }
}
export function removeDailyPreview(context,{storage}={}){try{storage ||= globalThis.localStorage;storage.removeItem(key(context));}catch{}}

/** 合併同日、同循環的後端交易顯示進度；重送／較慢回覆不能倒退已完成或已領取狀態。 */
export function mergeDailyProgress(state,update){
    const current=state?.challenges?.mission,incoming=update?.mission;
    if(!current||!incoming||!sameScope(update,state)||typeof update.dateKey!=='string'||!Number.isFinite(update.serverNow))return null;
    if(update.dateKey<state.dateKey)return state;
    if(update.dateKey!==state.dateKey||incoming.cycleId!==current.cycleId||incoming.day!==current.day||
        incoming.policyVersion!==current.policyVersion||incoming.enabled!==current.enabled||incoming.blocked!==current.blocked||
        !Array.isArray(incoming.tasks)||incoming.tasks.length!==current.tasks.length)return null;
    const tasks=[];
    for(const task of current.tasks){
        const matches=incoming.tasks.filter(row=>row.type===task.type),next=matches[0];
        if(matches.length!==1||next.target!==task.target||next.enabled!==task.enabled||next.verified!==task.verified||
            !Number.isSafeInteger(next.count)||next.count<0||next.count>task.target)return null;
        tasks.push({...task,count:Math.max(task.count,next.count)});
    }
    const claimed=!!current.claimed||!!incoming.claimed;
    const enabledTasks=tasks.filter(task=>task.enabled);
    const mission={...current,tasks,claimed,grantId:current.grantId||incoming.grantId||null,claimedAt:current.claimedAt||incoming.claimedAt||null,
        canClaim:current.enabled&&!current.blocked&&!claimed&&enabledTasks.length>0&&enabledTasks.every(task=>task.count>=task.target)};
    if(tasks.every((task,index)=>task.count===current.tasks[index].count)&&mission.claimed===current.claimed&&
        mission.grantId===current.grantId&&mission.claimedAt===current.claimedAt&&mission.canClaim===current.canClaim)return state;
    return{...state,challenges:{...state.challenges,mission}};
}
