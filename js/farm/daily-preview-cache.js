/** Read-only, account/group-scoped UI preview. A preview NEVER authorizes a reward. */
const VERSION=1,DAY=86400000;
const key=context=>'gugu.daily.preview.v1:'+JSON.stringify([context.accountId,context.groupId]);
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
        if(saved.version!==VERSION||!Number.isFinite(elapsed)||elapsed<0||elapsed>=DAY||!validState(saved.state)||saved.state.serverNow+elapsed>=saved.state.nextResetAt){storage.removeItem(key(context));return null;}
        const result=saved.state;result.serverNow+=elapsed;
        for(const challenge of Object.values(result.challenges))challenge.canClaim=false;
        return result;
    }catch{return null;}
}
export function writeDailyPreview(context,value,{storage,now=Date.now()}={}){
    try{
        storage ||= globalThis.localStorage;
        if(!validState(value))return;
        // Store only display data, never credentials or Auth tokens.
        const state={serverNow:value.serverNow,nextResetAt:value.nextResetAt,dateKey:value.dateKey,timeZone:'Asia/Taipei',challenges:{}};
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
