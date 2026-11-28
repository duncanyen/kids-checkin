/** 每日挑戰只使用伺服器時間及既有 farm.coins；未驗證的遊戲事件不可累計。 */
const D=require('./domain.cjs');
const Scope=require('./daily-scope.cjs');
const {reuseTransactionReads}=require('./transaction-reads.cjs');
const TYPES=['checkin','mission'];
const TASKS=[
    {type:'COLLECT_EGG_ACTION',name:'收取雞蛋',target:3,enabled:true},
    {type:'HELP_CLEAN_OTHER',name:'協助其他玩家清潔',target:3,enabled:true},
    {type:'DEFEAT_MONSTER',name:'擊退怪物',target:3,enabled:true}
];
const DEFAULT_CONFIG={version:'v2-checkin-100',checkin:{enabled:true,rewards:[100,100,100,100,100,100,1000],missedDayPolicy:'reset'},mission:{enabled:true,rewards:[200,400,600,800,1000,1200,2000],missedDayPolicy:'reset',tasks:TASKS}};
// 外部事件 consumer 預設停用；農場交易 producer 由正式安全切換狀態啟用。
const VERIFIED_PRODUCERS=Object.freeze({});
const FARM_PRODUCERS=Object.freeze(Object.fromEntries(TASKS.map(task=>[task.type,'farm-transactions-v1'])));
const DAY_MS=86400000;
const dateKey=stamp=>new Date(stamp+8*3600000).toISOString().slice(0,10);
const previousDate=key=>new Date(Date.parse(key+'T00:00:00Z')-DAY_MS).toISOString().slice(0,10);
function configValue(input){
    const value=input||DEFAULT_CONFIG;
    const result={version:D.text(value.version,80)};
    for(const type of TYPES){
        const c=value[type];
        if(!c||typeof c.enabled!=='boolean'||!Array.isArray(c.rewards)||c.rewards.length!==7)D.fail('failed-precondition','每日挑戰設定無效，請聯絡管理員');
        result[type]={enabled:c.enabled,rewards:c.rewards.map(n=>D.integer(n,1,1000000)),missedDayPolicy:D.enumValue(c.missedDayPolicy,['reset','continue'])};
    }
    const tasks=value.mission.tasks;
    if(!Array.isArray(tasks)||tasks.length!==TASKS.length||new Set(tasks.map(t=>t.type)).size!==TASKS.length)D.fail('failed-precondition','每日任務設定無效');
    result.mission.tasks=TASKS.map(base=>{
        const item=tasks.find(t=>t.type===base.type);
        if(!item||typeof item.enabled!=='boolean')D.fail('failed-precondition','每日任務設定無效');
        return{...base,target:D.integer(item.target,1,1000),enabled:item.enabled};
    });
    return result;
}
function nextDay(state,today,policy,uid,type){
    if(state?.lastClaimDate>today)D.fail('failed-precondition','伺服器日期早於上次領獎日期，請聯絡管理員');
    if(state?.lastClaimDate===today)return{day:state.day,cycleId:state.cycleId};
    const continues=state?.lastClaimDate&&(state.lastClaimDate===previousDate(today)||policy==='continue');
    const day=continues?state.day%7+1:1;
    return{day,cycleId:day===1?D.hash(`${uid}:${type}:${today}`).slice(0,24):state.cycleId};
}
function createDailyChallenges({db,now,player,playerSession,throttle,verifiedProducers=VERIFIED_PRODUCERS,trustedReady=async()=>false,stoneRewards=null}){
    const configRef=db.doc('ops_daily_configs/current');
    const refFor=(collection,identity,type,date)=>Scope.scopedRef(db,collection,identity,type,date);
    async function prepare(t,identity,types,stamp){
        const config=configValue((await t.get(configRef)).data());
        const today=dateKey(stamp);
        // 所有讀取先於寫入；status 的日快照鎖定今日金額及任務規格。
        const rows=await Promise.all(types.map(async type=>{
            const stateRef=refFor('ops_daily_states',identity,type),dayRef=refFor('ops_daily_days',identity,type,today);
            const snapshot=await t.get(dayRef),stateSnapshot=snapshot.exists?null:await t.get(stateRef);
            const isNewState=!!stateSnapshot&&!stateSnapshot.exists;
            const legacy=isNewState?await Scope.legacyDay({db,t,identity,type,today,yesterday:previousDate(today),policy:config[type].missedDayPolicy}):null;
            const state=stateSnapshot?.data()||legacy?.state;
            const stateSeed={uid:identity.uid,...Scope.scopeOf(identity),...legacy?.state,migratedAt:stamp};
            let data=snapshot.data();
            if(!data){
                data={uid:identity.uid,...Scope.scopeOf(identity),type,dateKey:today,
                    ...nextDay(state,today,config[type].missedDayPolicy,Scope.scopeKey(identity),type),
                    rewards:config[type].rewards,policyVersion:config.version,missedDayPolicy:config[type].missedDayPolicy,
                    tasks:type==='mission'?config.mission.tasks:[],progress:{},claimedAt:null,grantId:null,createdAt:stamp};
                if(legacy?.snapshot){
                    const old=legacy.snapshot;
                    for(const key of ['rewards','policyVersion','missedDayPolicy','tasks'])if(old[key]!==undefined)data[key]=old[key];
                }
                if(legacy?.grant){
                    const grant=legacy.grant;
                    Object.assign(data,{day:grant.response.day,cycleId:grant.response.cycleId,claimedAt:grant.createdAt,grantId:grant.id,claimedGroupId:identity.groupId,legacyGrantId:grant.id});
                    data.rewards=[...data.rewards];data.rewards[data.day-1]=grant.response.amount;
                    if(type==='mission')data.progress=legacy.snapshot?.progress||Object.fromEntries(data.tasks.filter(task=>task.enabled).map(task=>[task.type,task.target]));
                }else if(type==='mission'&&legacy?.snapshot){
                    data.progress=await Scope.legacyProgress({db,t,identity,today,tasks:data.tasks});
                }
            }
            return{type,stateRef,dayRef,data,isNew:!snapshot.exists,isNewState,stateSeed};
        }));
        const producers=await trustedReady(t)?{...verifiedProducers,...FARM_PRODUCERS}:verifiedProducers;
        return{config,today,rows,producers};
    }
    function view(row,config,producers=verifiedProducers){
        const d=row.data,c=config[row.type];
        const tasks=d.tasks.map(task=>({...task,count:Math.min(task.target,d.progress[task.type]||0),
            verified:!!producers[task.type],reason:producers[task.type]?'':'目前遊戲操作尚未接上後端驗證，暫不計次'}));
        const blocked=tasks.some(task=>task.enabled&&!task.verified);
        const activeTasks=tasks.filter(task=>task.enabled);
        const completed=activeTasks.length>0&&activeTasks.every(task=>(d.progress[task.type]||0)>=task.target);
        return{type:row.type,dateKey:d.dateKey,day:d.day,cycleId:d.cycleId,rewards:d.rewards,enabled:c.enabled,
            claimed:!!d.grantId,claimedAt:d.claimedAt,grantId:d.grantId,tasks,blocked,
            canClaim:c.enabled&&!d.grantId&&(row.type==='checkin'||(!blocked&&completed)),policyVersion:d.policyVersion,
            missedDayPolicy:d.missedDayPolicy,...(row.stoneReward?{refinementStoneReward:row.stoneReward}:{})};
    }
    function initialize(t,rows){for(const row of rows){if(row.isNewState)t.create(row.stateRef,row.stateSeed);if(row.isNew)t.create(row.dayRef,row.data);}}
    async function handle(request){
        const identity=await playerSession(request);
        await throttle('daily:'+Scope.scopeKey(identity),60,60000);
        const action=request.data?.action;
        if(!['status','claim'].includes(action))D.fail('invalid-argument','未知的每日挑戰操作');
        const stoneDraw=stoneRewards?.sampler();
        return db.runTransaction(async transaction=>{
            const t=reuseTransactionReads(transaction);
            const current=await player(request,t),stamp=now();
            if(action==='status'){
                const prepared=await prepare(t,current,TYPES,stamp);
                if(stoneRewards)for(const row of prepared.rows){if(row.data.grantId){if(row.data.refinementStoneReward)row.stoneReward={...row.data.refinementStoneReward,claimed:true};}else row.stoneReward=await stoneRewards.dailyPreview(t,{type:row.type,day:row.data.day,actor:current},stamp);}
                initialize(t,prepared.rows);
                return{...Scope.scopeOf(current),serverNow:stamp,nextResetAt:(Math.floor((stamp+8*3600000)/DAY_MS)+1)*DAY_MS-8*3600000,dateKey:prepared.today,timeZone:'Asia/Taipei',challenges:Object.fromEntries(prepared.rows.map(row=>[row.type,view(row,prepared.config,prepared.producers)]))};
            }
            const type=D.enumValue(request.data.type,TYPES);
            D.requestId(request.data.requestId);
            const prepared=await prepare(t,current,[type],stamp),row=prepared.rows[0],d=row.data;
            if(request.data.dateKey!==prepared.today)D.fail('deadline-exceeded','已跨過台灣午夜，請重新載入今日挑戰後再領取');
            if(request.data.cycleId!==d.cycleId||request.data.day!==d.day)D.fail('failed-precondition','挑戰資料已更新，請重新載入');
            const grantRef=refFor('ops_daily_grants',current,type,prepared.today),prior=await t.get(d.grantId?db.doc('ops_daily_grants/'+D.id(d.grantId)):grantRef);
            if(prior.exists){if(!Scope.owns(prior.data(),current))D.fail('failed-precondition','領獎紀錄與群組不符');initialize(t,prepared.rows);return{...prior.data().response,...Scope.scopeOf(current),replayed:true};}
            const status=view(row,prepared.config,prepared.producers);
            if(!status.canClaim)D.fail('failed-precondition',status.blocked?'任務尚未接上可信任事件，暫不可領取':!status.enabled?'此挑戰目前已停用':'尚未完成今日任務');
            const ownerRef=db.doc(`groups/${current.groupId}/users/${current.accountId}`),owner=await t.get(ownerRef);
            const amount=d.rewards[d.day-1];
            const material=stoneRewards?await stoneRewards.daily(t,{type,day:d.day,grantId:grantRef.id,actor:current},stamp,stoneDraw):null;
            const rewards=[{kind:'coins',amount},...(material?.quantity>0?[{kind:'item',itemKey:'refinement_stone',amount:material.quantity}]:[])];
            const farm=await D.award(owner.data()?.farm,rewards,stamp,{allowRefinementStones:!!material});
            const response={...Scope.scopeOf(current),transactionId:grantRef.id,type,dateKey:prepared.today,cycleId:d.cycleId,day:d.day,amount,groupId:current.groupId,createdAt:stamp,...(material?{refinementStoneReward:material}:{})};
            t.update(ownerRef,{farm});
            t.set(row.dayRef,{...d,...(material?{refinementStoneReward:material}:{}),claimedAt:stamp,grantId:grantRef.id,claimedGroupId:current.groupId});
            t.set(row.stateRef,{uid:current.uid,...Scope.scopeOf(current),day:d.day,cycleId:d.cycleId,lastClaimDate:prepared.today,updatedAt:stamp});
            t.create(grantRef,{uid:current.uid,...Scope.scopeOf(current),type,dateKey:prepared.today,cycleId:d.cycleId,createdAt:stamp,result:'success',requestId:request.data.requestId,response});
            return response;
        });
    }
    /**
     * 未對外提供 callable 的可信任事件接點。
     * 必須先由已驗證的遊戲後端寫入不可由客戶端存取的事件；未登錄的外部 producer 預設拒絕。
     * 未來應由後端事件派送器呼叫；事件與日進度去重在同一交易，數量一律按有效操作 +1。
     */
    async function consumeVerifiedEvent(eventId){
        D.id(eventId);
        return db.runTransaction(async t=>{
            const sourceRef=db.doc(`ops_verified_farm_events/${eventId}`),source=await t.get(sourceRef),event=source.data();
            if(!event||verifiedProducers[event.type]!==event.producer||!event.producer)D.fail('failed-precondition','沒有受信任的遊戲事件來源');
            if(event.success!==true||!Number.isSafeInteger(event.occurredAt)||event.occurredAt>now()||dateKey(event.occurredAt)!==dateKey(now()))D.fail('failed-precondition','事件不是今日的有效成功操作');
            if(event.type==='HELP_CLEAN_OTHER'&&(!event.targetAccountId||event.targetAccountId===event.accountId))D.fail('invalid-argument','必須協助其他玩家清潔');
            if(event.type==='COLLECT_EGG_ACTION'&&(!Number.isSafeInteger(event.collected)||event.collected<=0))D.fail('invalid-argument','未成功收取雞蛋');
            const current=await playerSession({auth:{uid:event.uid,token:{photoAccountId:event.accountId,photoGroupId:event.groupId}},data:{groupId:event.groupId}});
            await player({auth:{uid:event.uid,token:{photoAccountId:event.accountId,photoGroupId:event.groupId}},data:{groupId:event.groupId}},t);
            const receiptRef=db.doc(`ops_daily_events/${eventId}`),receipt=await t.get(receiptRef);
            if(receipt.exists)return{replayed:true};
            const prepared=await prepare(t,current,['mission'],now()),row=prepared.rows[0],task=row.data.tasks.find(task=>task.type===event.type&&task.enabled);
            if(!prepared.config.mission.enabled||!task||row.data.grantId){initialize(t,prepared.rows);t.create(receiptRef,{uid:current.uid,...Scope.scopeOf(current),result:'ignored',createdAt:now()});return{ignored:true};}
            const progress={...row.data.progress,[event.type]:Math.min(task.target,(row.data.progress[event.type]||0)+1)};
            initialize(t,[{...row,data:{...row.data,progress}}]);if(!row.isNew)t.set(row.dayRef,{...row.data,progress});
            t.create(receiptRef,{uid:current.uid,...Scope.scopeOf(current),type:event.type,dateKey:prepared.today,result:'counted',createdAt:now()});
            return{progress};
        });
    }
    /** 與遊戲經濟交易共用同一個 Transaction；先完成讀取，回傳最後階段的寫入 closure。 */
    async function prepareProgress(t,current,event,stamp){
        if(event.producer!=='farm-transactions-v1'||event.occurredAt!==stamp)D.fail('failed-precondition','遊戲事件來源無效');
        if(event.type==='COLLECT_EGG_ACTION'&&!(event.collected>0))D.fail('failed-precondition','沒有有效收蛋');
        if(event.type==='HELP_CLEAN_OTHER'&&(!event.targetAccountId||event.targetAccountId===current.accountId))D.fail('failed-precondition','不是協助其他玩家');
        const receiptRef=db.doc('ops_daily_events/'+D.id(event.id)),prior=await t.get(receiptRef);
        if(prior.exists)return()=>{};
        const prepared=await prepare(t,current,['mission'],stamp),row=prepared.rows[0],task=row.data.tasks.find(task=>task.type===event.type&&task.enabled);
        if(prepared.producers[event.type]!==event.producer)D.fail('failed-precondition','每日任務尚未完成安全切換');
        const counted=prepared.config.mission.enabled&&task&&!row.data.grantId;
        const progress=counted?{...row.data.progress,[event.type]:Math.min(task.target,(row.data.progress[event.type]||0)+1)}:row.data.progress;
        const increased=counted&&progress[event.type]>(row.data.progress[event.type]||0);
        const write=()=>{initialize(t,[{...row,data:{...row.data,progress}}]);if(increased&&!row.isNew)t.set(row.dayRef,{...row.data,progress});t.create(receiptRef,{uid:current.uid,...Scope.scopeOf(current),type:event.type,dateKey:prepared.today,result:counted?'counted':'ignored',createdAt:stamp});};
        // 進度與經濟變更同筆提交後才回傳；UI 不必為同一次操作再查詢完整 status。
        write.dailyProgress={...Scope.scopeOf(current),serverNow:stamp,dateKey:prepared.today,mission:view({...row,data:{...row.data,progress}},prepared.config,prepared.producers)};
        return write;
    }
    async function adminRead(action,payload={}) {
        if(action==='dailyConfig')return{config:configValue((await configRef.get()).data()),verifiedProducers:await trustedReady()?{...verifiedProducers,...FARM_PRODUCERS}:verifiedProducers};
        const uid=D.id(payload.uid);
        if(action==='dailyPlayer'){
            const requestedDate=payload.dateKey||dateKey(now());
            if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate))D.fail('invalid-argument','日期格式不正確');
            const identity={uid,groupId:D.id(payload.groupId),accountId:D.id(payload.accountId)};
            const rows=await Promise.all(TYPES.map(async type=>({type,state:(await refFor('ops_daily_states',identity,type).get()).data()||null,day:(await refFor('ops_daily_days',identity,type,requestedDate).get()).data()||null})));
            return{uid,...Scope.scopeOf(identity),dateKey:requestedDate,rows};
        }
        const size=payload.pageSize===undefined?25:D.integer(payload.pageSize,1,50);
        let query=db.collection('ops_daily_grants').where('uid','==',uid).orderBy('createdAt','desc');
        if(payload.cursor){const cursor=await db.doc(`ops_daily_grants/${D.id(payload.cursor)}`).get();if(!cursor.exists||cursor.data().uid!==uid)D.fail('invalid-argument','分頁游標無效');query=query.startAfter(cursor);}
        const snapshot=await query.limit(size+1).get(),rows=snapshot.docs.slice(0,size);
        return{rows:rows.map(row=>({id:row.id,...row.data()})),nextCursor:snapshot.size>size?rows.at(-1).id:null};
    }
    return{handle,consumeVerifiedEvent,adminRead,prepareProgress};
}
module.exports={createDailyChallenges,DEFAULT_CONFIG,VERIFIED_PRODUCERS,dateKey,configValue};
