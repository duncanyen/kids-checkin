const crypto=require('node:crypto');
const D=require('./domain.cjs');
const DEFAULT_SETTINGS=Object.freeze({announcementsEnabled:true,redemptionEnabled:true,guardDogRentalsEnabled:true,pauseMessage:'此營運功能暫停開放，請稍後再試。'});
const READ_ACTIONS=['listPlayers','playerDetail','gameBalance','listEvents','getSettings'];
const WRITE_ACTIONS=['savePlayerControl','adjustPlayerCoins','saveGuardConfig','saveEvent','saveSettings'];
const boolean=value=>{if(typeof value!=='boolean')D.fail('invalid-argument','開關格式不正確');return value;};
const revision=value=>D.integer(value,0,Number.MAX_SAFE_INTEGER-1);
const profile=(snap)=>{const p=snap.data()||{};return{uid:snap.id,accountId:p.accountId||'',name:p.name||p.accountId||'',role:p.role||'member'};};
const control=value=>({blocked:value?.blocked===true,notes:typeof value?.notes==='string'?value.notes:'',reason:typeof value?.reason==='string'?value.reason:'',revision:value?.revision||0,updatedAt:value?.updatedAt||null});
const requireVersion=(old,expected)=>{if((old?.revision||0)!==revision(expected))D.fail('failed-precondition','資料已被更新，請重新讀取後再儲存');};

/**
 * 建立玩家、護衛犬設定、活動與系統開關的營運操作層。
 * @param {Object} options - Admin SDK db 與 now 毫秒時鐘。
 * @returns {Object} 查詢、交易及設定讀取介面，必須由 createService 先驗證管理員。
 * @description 新控制資料獨立於 users／groups；只有明確的金幣調整更新原農場。
 */
function createManagement({db,now}){
    const read=(ref,t)=>t?t.get(ref):ref.get();
    async function settings(t){
        const snap=await read(db.doc('ops_settings/global'),t),data=snap.data()||{},v=data.values||{};
        const values={...DEFAULT_SETTINGS};
        for(const key of ['announcementsEnabled','redemptionEnabled','guardDogRentalsEnabled'])if(Object.hasOwn(v,key))values[key]=boolean(v[key]);
        if(Object.hasOwn(v,'pauseMessage'))values.pauseMessage=D.text(v.pauseMessage,300);
        return{values,revision:data.revision||0,updatedAt:data.updatedAt||null};
    }
    async function guardCatalog(t){
        const G=await import('./game/guard-dog-core.js'),snap=await read(db.doc('ops_game_config/guard-dogs'),t),data=snap.data()||{},system=await settings(t);
        const breeds={};
        for(const [id,base]of Object.entries(G.GUARD_DOG_BREEDS)){
            const override=data.guardDogs?.[id];
            const configured=override?{...base,...validateGuard(override)}:{...base};
            breeds[id]={...configured,configuredRentable:configured.rentable!==false,rentable:system.values.guardDogRentalsEnabled&&configured.rentable!==false,
                availability:!system.values.guardDogRentalsEnabled?'paused':configured.rentable===false?'closed':'open'};
        }
        return{breeds,revision:data.revision||0,updatedAt:data.updatedAt||null,settings:system.values};
    }
    function validateGuard(value){
        const dayPrice=D.integer(value.dayPrice,1,1000000),weekPrice=D.integer(value.weekPrice,dayPrice,dayPrice*7);
        return{dayPrice,weekPrice,rentable:boolean(value.rentable)};
    }
    async function listPlayers(payload){
        let query=db.collection('users');
        if(payload.accountId)query=query.where('accountId','==',D.text(payload.accountId,160));
        query=query.orderBy('accountId');
        if(payload.cursor){const snap=await db.doc('users/'+D.id(payload.cursor)).get();if(!snap.exists)D.fail('failed-precondition','玩家分頁已變更');query=query.startAfter(snap);}
        const size=payload.pageSize===undefined?25:D.integer(payload.pageSize,1,50),snap=await query.limit(size+1).get(),docs=snap.docs.slice(0,size);
        return{rows:await Promise.all(docs.map(async doc=>({...profile(doc),control:control((await db.doc('ops_player_controls/'+doc.id).get()).data())}))),nextCursor:snap.size>size?docs.at(-1).id:null};
    }
    async function playerDetail(payload){
        const snap=await db.doc('users/'+D.id(payload.uid)).get();if(!snap.exists)D.fail('not-found','找不到玩家');
        const p=profile(snap);if(!p.accountId)D.fail('failed-precondition','玩家缺少固定帳號，請先確認原始資料');const groups=await db.collection('groups').where('members','array-contains',p.accountId).limit(21).get();
        const farms=await Promise.all(groups.docs.slice(0,20).map(async group=>{
            const owner=await db.doc(`groups/${group.id}/users/${p.accountId}`).get(),farm=owner.data()?.farm;
            return{groupId:group.id,groupName:group.data().name||group.id,hasFarm:!!farm,coins:Number.isSafeInteger(farm?.coins)?farm.coins:null,
                hens:Number.isSafeInteger(farm?.hens)?farm.hens:null,coopLevel:Number.isSafeInteger(farm?.coopLevel)?farm.coopLevel:null};
        }));
        return{...p,control:control((await db.doc('ops_player_controls/'+p.uid).get()).data()),farms,moreGroups:groups.size>20};
    }
    async function listEvents(payload){
        let q=db.collection('ops_events');
        if(payload.status)q=q.where('status','==',D.enumValue(payload.status,['draft','scheduled','active','ended','cancelled']));
        if(D.search(payload.search))q=q.where('searchTokens','array-contains',D.search(payload.search));
        q=q.orderBy('createdAt','desc');
        if(payload.cursor){const s=await db.doc('ops_events/'+D.id(payload.cursor)).get();if(!s.exists)D.fail('failed-precondition','活動分頁已變更');q=q.startAfter(s);}
        const snap=await q.limit(26).get(),docs=snap.docs.slice(0,25),stamp=now();
        return{rows:docs.map(s=>{const d=s.data();return{...d,id:s.id,effectiveStatus:['active','scheduled'].includes(d.status)?stamp>=d.endAt?'ended':stamp>=d.startAt?'active':'scheduled':d.status};}),nextCursor:snap.size>25?docs.at(-1).id:null};
    }
    async function query(action,payload){
        if(action==='listPlayers')return listPlayers(payload);
        if(action==='playerDetail')return playerDetail(payload);
        if(action==='listEvents')return listEvents(payload);
        if(action==='getSettings')return settings();
        if(action==='gameBalance'){
            const [{BREEDS},{WEAPONS_CONFIG,ENEMY_HEALTH,hitsToDefeat},dogs]=await Promise.all([import('./game/poultry.js'),import('./game/combat-rules.js'),guardCatalog()]);
            return{chickens:BREEDS,weapons:WEAPONS_CONFIG,enemyHealth:ENEMY_HEALTH,weaponHitCounts:Object.fromEntries(Object.entries(WEAPONS_CONFIG).map(([id,w])=>[id,Object.fromEntries(Object.keys(ENEMY_HEALTH).map(enemy=>{const hits=hitsToDefeat(w,enemy);return[enemy,Number.isFinite(hits)?hits:null];}))])),guardDogs:dogs};
        }
        D.fail('invalid-argument','未知管理查詢');
    }
    /**
     * 同筆交易完成管理變更、成功稽核與請求收據，版本不符則拒絕覆寫。
     * @param {string} uid - 已由服務驗證的管理員 Auth UID。
     * @param {string} action - 已支援的管理寫入操作。
     * @param {Object} payload - 含原因、必要的 expectedRevision 或 expectedCoins。
     * @param {string} requestId - 此次操作的固定識別碼。
     * @returns {Promise<Object>} 操作結果；同 UID、識別碼與內容重送回傳原結果。
     */
    async function mutate(uid,action,payload,requestId){
        const journal=db.doc('ops_admin_requests/'+D.hash(uid+':'+requestId)),fingerprint=D.fingerprint({action,payload}),audit=db.collection('ops_audit').doc();
        return db.runTransaction(async t=>{
            const prior=await t.get(journal);
            if(prior.exists){if(prior.data().fingerprint!==fingerprint)D.fail('invalid-argument','請求識別碼已用於其他操作');return{...prior.data().response,replayed:true};}
            const stamp=now();let before,after,target,commit,response;
            const reason=D.text(payload.reason,500);
            if(action==='savePlayerControl'||action==='adjustPlayerCoins'){
                const player=await t.get(db.doc('users/'+D.id(payload.uid)));if(!player.exists)D.fail('not-found','找不到玩家');
                const p=profile(player);
                if(action==='savePlayerControl'){
                    const ref=db.doc('ops_player_controls/'+p.uid),old=await t.get(ref);requireVersion(old.data(),payload.expectedRevision);
                    before=control(old.data());after={blocked:boolean(payload.blocked),notes:D.text(payload.notes||'',1000,false),reason,revision:before.revision+1,updatedAt:stamp,updatedBy:uid};target=ref.path;
                    commit=()=>t.set(ref,after);response={control:after};
                }else{
                    const groupId=D.id(payload.groupId),group=await t.get(db.doc('groups/'+groupId));
                    if(!group.data()?.members?.includes(p.accountId))D.fail('failed-precondition','玩家已不在此群組');
                    const ref=db.doc(`groups/${groupId}/users/${p.accountId}`),owner=await t.get(ref),farm=owner.data()?.farm;
                    const delta=D.integer(payload.delta,-1000000,1000000);if(delta===0)D.fail('invalid-argument','調整金額不可為零');
                    if(!Number.isSafeInteger(farm?.coins)||farm.coins<0)D.fail('failed-precondition','農場金幣資料無法安全調整');
                    if(farm.coins!==D.integer(payload.expectedCoins,0,Number.MAX_SAFE_INTEGER))D.fail('failed-precondition','玩家金幣已變動，請重新讀取後確認');
                    const coins=farm.coins+delta;if(!Number.isSafeInteger(coins)||coins<0)D.fail('failed-precondition','調整後金幣不得為負或超出安全範圍');
                    before={coins:farm.coins};after={coins,delta,reason,accountId:p.accountId,groupId};target=ref.path;
                    commit=()=>t.update(ref,{farm:{...farm,coins}});response={coins,accountId:p.accountId,groupId};
                }
            }else if(action==='saveGuardConfig'){
                const G=await import('./game/guard-dog-core.js'),id=D.id(payload.breedId);
                if(!Object.hasOwn(G.GUARD_DOG_BREEDS,id))D.fail('invalid-argument','未知護衛犬');
                const value=validateGuard(payload),ref=db.doc('ops_game_config/guard-dogs'),old=await t.get(ref),data=old.data()||{};requireVersion(data,payload.expectedRevision);
                before=data.guardDogs?.[id]||{dayPrice:G.GUARD_DOG_BREEDS[id].dayPrice,weekPrice:G.GUARD_DOG_BREEDS[id].weekPrice,rentable:G.GUARD_DOG_BREEDS[id].rentable!==false};after=value;target=ref.path+'/'+id;
                const next={guardDogs:{...(data.guardDogs||{}),[id]:value},revision:(data.revision||0)+1,updatedAt:stamp,updatedBy:uid};
                commit=()=>t.set(ref,next);response={revision:next.revision};
            }else if(action==='saveSettings'){
                const ref=db.doc('ops_settings/global'),old=await t.get(ref);requireVersion(old.data(),payload.expectedRevision);
                before={...DEFAULT_SETTINGS,...(old.data()?.values||{})};after={};
                for(const key of ['announcementsEnabled','redemptionEnabled','guardDogRentalsEnabled'])after[key]=boolean(payload[key]);
                after.pauseMessage=D.text(payload.pauseMessage,300);target=ref.path;
                const next={values:after,revision:(old.data()?.revision||0)+1,updatedAt:stamp,updatedBy:uid};commit=()=>t.set(ref,next);response={revision:next.revision};
            }else if(action==='saveEvent'){
                const id=payload.id?D.id(payload.id):crypto.randomUUID(),ref=db.doc('ops_events/'+id),old=await t.get(ref);
                if(payload.id&&!old.exists)D.fail('not-found','找不到活動');requireVersion(old.data(),payload.expectedRevision);
                const status=D.enumValue(payload.status,['draft','scheduled','active','ended','cancelled']);
                const announcement=D.announcement({title:payload.title,content:payload.description,type:'event',priority:payload.priority,targetType:payload.targetType,targetAccountIds:payload.targetAccountIds,startAt:payload.startAt,endAt:payload.endAt,activityCode:payload.activityCode,showPopup:payload.showPopup,status:status==='active'?'published':status==='scheduled'?'scheduled':status==='draft'?'draft':'archived'});
                if(status==='active'&&announcement.startAt>stamp)D.fail('invalid-argument','未開始的活動請選擇排程');
                const linked=db.doc('ops_announcements/event-'+id),linkedOld=await t.get(linked);
                if(linkedOld.exists&&linkedOld.data().sourceEventId!==id)D.fail('failed-precondition','活動公告識別碼衝突');
                before=old.data()||null;after={eventId:id,title:announcement.title,description:announcement.content,status,type:D.enumValue(payload.type,['community','seasonal','competition']),
                    priority:announcement.priority,targetType:announcement.targetType,targetAccountIds:announcement.targetAccountIds,startAt:announcement.startAt,endAt:announcement.endAt,
                    activityCode:announcement.activityCode,showPopup:announcement.showPopup,searchTokens:announcement.searchTokens,revision:(old.data()?.revision||0)+1,
                    createdAt:old.data()?.createdAt||stamp,createdBy:old.data()?.createdBy||uid,updatedAt:stamp,updatedBy:uid};target=ref.path;
                commit=()=>{t.set(ref,after);t.set(linked,{...announcement,announcementId:'event-'+id,sourceEventId:id,createdAt:linkedOld.data()?.createdAt||stamp,createdBy:linkedOld.data()?.createdBy||uid,updatedAt:stamp});};response={id,revision:after.revision};
            }else D.fail('invalid-argument','未知管理操作');
            commit();
            t.create(audit,{adminUid:uid,createdAt:stamp,action,target,before,after,result:'success',reason,requestId});
            t.create(journal,{fingerprint,response,createdAt:stamp});return response;
        });
    }
    return{isRead:action=>READ_ACTIONS.includes(action),isWrite:action=>WRITE_ACTIONS.includes(action),query,mutate,settings,guardCatalog};
}
module.exports={createManagement,DEFAULT_SETTINGS};
