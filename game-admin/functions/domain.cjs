const crypto=require('node:crypto');
class OpsError extends Error { constructor(code,message){super(message);this.code=code;} }
const fail=(code,message)=>{throw new OpsError(code,message);};
const text=(value,max=200,required=true)=>{
    if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('invalid-argument','文字欄位格式或長度不正確');
    return value.trim();
};
const integer=(value,min,max)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail('invalid-argument','數值超出允許範圍');return value;};
const id=value=>{if(typeof value!=='string'||!value||value.length>160||value.includes('/'))fail('invalid-argument','資料識別碼無效');return value;};
const requestId=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(value))fail('invalid-argument','請提供有效的請求識別碼');return value;};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const fingerprint=value=>hash(JSON.stringify(canonical(value)));
const enumValue=(value,values)=>{if(!values.includes(value))fail('invalid-argument','選項無效');return value;};
function targets(value){if(!Array.isArray(value)||value.length>100)fail('invalid-argument','指定帳號最多 100 個');return [...new Set(value.map(v=>id(text(v,160))))];}
function windowFields(input){
    const startAt=integer(input.startAt,0,8640000000000000),endAt=integer(input.endAt,1,8640000000000000);
    if(endAt<=startAt)fail('invalid-argument','結束時間必須晚於開始時間');return{startAt,endAt};
}
const tokens=value=>{const chars=[...value.normalize('NFKC').toLowerCase()];return chars.slice(0,80).map((_,i)=>chars.slice(0,i+1).join(''));};
const search=value=>typeof value==='string'?value.normalize('NFKC').trim().toLowerCase().slice(0,80):'';
function announcement(input){
    const value={title:text(input.title,120),content:text(input.content,10000),type:enumValue(input.type,['general','maintenance','event','update']),priority:integer(input.priority,0,100),targetType:enumValue(input.targetType,['all','accounts']),targetAccountIds:targets(input.targetAccountIds||[]),...windowFields(input),activityCode:input.activityCode?normalizeCode(input.activityCode):'',showPopup:!!input.showPopup,status:enumValue(input.status,['draft','scheduled','published','archived'])};
    if(value.targetType==='accounts'&&!value.targetAccountIds.length)fail('invalid-argument','請指定至少一位玩家');
    if(value.targetType==='all')value.targetAccountIds=[];
    return{...value,searchTokens:tokens(value.title),audienceKeys:value.targetType==='all'?['all']:value.targetAccountIds.map(v=>'account:'+v)};
}
const activeAnnouncement=(a,accountId,now)=>['published','scheduled'].includes(a.status)&&a.startAt<=now&&now<a.endAt&&(a.targetType==='all'||a.targetAccountIds?.includes(accountId));
function normalizeCode(value){
    const normalized=text(value,160).normalize('NFKC').toUpperCase().replace(/[\s-]/g,'');
    if(!/^[A-Z0-9]{8,64}$/.test(normalized))fail('invalid-argument','兌換碼須為 8–64 位英文字母或數字');return normalized;
}
const generateCode=()=>crypto.randomBytes(12).toString('hex').toUpperCase();
const ITEM_NAMES={worms:'菜蟲',earthworms:'蚯蚓',wolfFangs:'狼牙',tigerPelts:'虎皮',dragonScales:'龍麟',gorillaFangs:'猩猩尖牙',cobraFangs:'眼鏡蛇王毒牙',eagleFeathers:'巨鷹羽毛',sweetPotatoes:'地瓜',medicines:'咕咕活力散',mace:'狼牙棒',battleaxe:'雙手斧',ironhammer:'大鐵槌',shortbow:'短弓',huntingbow:'獵弓',paladinbow:'聖騎士弓'};
const ITEMS=Object.freeze(['worms','earthworms','wolfFangs','tigerPelts','dragonScales','gorillaFangs','cobraFangs','eagleFeathers','sweetPotatoes','medicines','mace','battleaxe','ironhammer','shortbow','huntingbow','paladinbow']);
function rewards(value){
    if(!Array.isArray(value)||!value.length||value.length>20)fail('invalid-argument','請設定 1–20 項獎勵');
    return value.map(r=>{
        const kind=enumValue(r.kind,['coins','eggs','chicken','item']);
        const amount=integer(r.amount,1,kind==='coins'?1000000:kind==='chicken'?20:1000);
        if(kind==='coins')return{kind,amount};
        if(kind==='chicken'){
            if(r.breed!=='hen')fail('invalid-argument','第一階段僅支援母雞獎勵，其他雞種尚未開放');return{kind,breed:'hen',amount};
        }
        if(kind==='eggs')return{kind,breed:enumValue(r.breed,['hen','silkie','bresse','onagadori']),amount};
        return{kind,itemKey:enumValue(r.itemKey,ITEMS),amount};
    });
}
function gift(input){
    const type=enumValue(input.type,['universal','limited','single','targeted']);
    const value={name:text(input.name,120),description:text(input.description||'',2000,false),type,rewards:rewards(input.rewards),maxRedemptions:type==='single'?1:input.maxRedemptions===null?null:integer(input.maxRedemptions,1,1000000),maxRedemptionsPerUser:type==='single'?1:integer(input.maxRedemptionsPerUser,1,100),targetAccountIds:targets(input.targetAccountIds||[]),...windowFields(input),status:enumValue(input.status,['draft','active','inactive'])};
    if(type==='limited'&&value.maxRedemptions===null)fail('invalid-argument','限量禮包必須設定總數上限');
    if(type==='targeted'&&!value.targetAccountIds.length)fail('invalid-argument','請指定至少一位玩家');
    if(type!=='targeted')value.targetAccountIds=[];
    return{...value,searchTokens:tokens(value.name)};
}
function assertRedeemable(g,accountId,count,now){
    if(g.status!=='active')fail('failed-precondition','禮包尚未啟用或已停用');
    if(now<g.startAt)fail('failed-precondition','禮包尚未開始');
    if(now>=g.endAt)fail('deadline-exceeded','禮包已到期');
    if(g.type==='targeted'&&!g.targetAccountIds?.includes(accountId))fail('permission-denied','此禮包未開放給此帳號');
    if(g.maxRedemptions!==null&&g.redeemedCount>=g.maxRedemptions)fail('resource-exhausted','禮包已兌換完畢');
    if(count>=g.maxRedemptionsPerUser)fail('already-exists','已達此帳號的兌換上限');
    rewards(g.rewards);
}
async function award(farm,value,now){
    const {settlePoultry,poultryPatch,coopCapacity,BREEDS}=await import('./game/poultry.js');
    const {getUsedSpace}=await import('./game/inventory-core.js');
    if(!farm||!Number.isSafeInteger(farm.coins)||farm.coins<0||!Number.isInteger(farm.hens)||farm.hens<0)fail('failed-precondition','農場存檔尚未準備完成');
    const additions=rewards(value),result=structuredClone(farm);
    const birds=additions.filter(r=>r.kind==='chicken').reduce((n,r)=>n+r.amount,0);
    if(birds){
        const state=settlePoultry(farm,now);
        if(state.hens.length+birds>coopCapacity(farm.coopLevel))fail('resource-exhausted','雞舍容量不足，請先整理雞舍');
        for(let i=0;i<birds;i++)state.hens.push({id:crypto.randomUUID(),breed:'hen',laidAt:now,isSick:false});
        Object.assign(result,Object.fromEntries(Object.entries(poultryPatch(state)).map(([k,v])=>[k.slice(5),v])));
    }
    for(const r of additions){
        if(r.kind==='chicken')continue;
        const key=r.kind==='coins'?'coins':r.kind==='eggs'?BREEDS[r.breed].eggKey:r.itemKey;
        const previous=result[key]||0;
        if(!Number.isSafeInteger(previous)||previous<0||!Number.isSafeInteger(previous+r.amount))fail('failed-precondition','農場數值無法安全更新');
        result[key]=previous+r.amount;
    }
    if(additions.some(r=>['eggs','item'].includes(r.kind))&&getUsedSpace(result)>(result.warehouseLimit||10))fail('resource-exhausted','倉庫容量不足，請先整理或擴充倉庫');
    return result;
}
function adminIdentity(auth){
    if(!auth?.uid)fail('unauthenticated','請先登入管理後台');
    if(auth.token?.role!=='admin')fail('permission-denied','此帳號沒有遊戲管理權限');
    return auth.uid;
}
function safeGift(value){const {codeHash,...data}=value;return data;}
module.exports={OpsError,fail,text,integer,id,requestId,hash,fingerprint,enumValue,targets,search,announcement,activeAnnouncement,normalizeCode,generateCode,rewards,gift,assertRedeemable,award,adminIdentity,safeGift,ITEMS,ITEM_NAMES};
