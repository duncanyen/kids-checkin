const crypto=require('node:crypto');
const D=require('./domain.cjs');
const {createReporting}=require('./reporting.cjs');
const {createManagement}=require('./management.cjs');
const {createDailyChallenges}=require('./daily-challenges.cjs');
const COLLECTIONS={announcements:'ops_announcements',notifications:'ops_notifications',gifts:'ops_gifts',redemptions:'ops_redemptions',audit:'ops_audit'};
const cleanAudit=value=>{
    if(!value)return null;
    const {codeHash,searchTokens,audienceKeys,...safe}=value;return safe;
};
/**
 * 建立可信任營運服務，管理公告、禮包、護衛犬及四個管理模組。
 * @param {Object} options - Admin SDK db、auth 及可注入的毫秒時鐘 now。
 * @returns {Object} adminAPI、announcements、guardDog、redeem callable 處理介面。
 * @description 每次管理操作核對當前 Auth admin claim；users.role 不授予營運管理權。
 */
function createService({db,auth,verifiedCombatTestEnvironment=false,verifiedCombatTestAccounts=[],now=Date.now,privateIdentityEnabled=()=>false,farmBackendEnabled=()=>false,farmRandom=Math.random,weaponInstanceEnabled=()=>require('./weapon-instance-config.cjs').weaponInstanceEnabled,weaponRefinementEnabled=()=>require('./weapon-instance-config.cjs').weaponRefinementEnabled,refinementTestEnvironment=false,refinementRandomInt=null,refinementHooks=null,refinementTestAccounts=[],refinementCombatBonusEnabled=()=>require('./weapon-instance-config.cjs').refinementCombatBonusEnabled,refinementResetEnabled=()=>require('./weapon-instance-config.cjs').refinementResetEnabled,refinementStoneRewardEnabled=()=>require('./weapon-instance-config.cjs').refinementStoneRewardEnabled,stoneRewardTestEnvironment=false,stoneRewardRandomInt=null,refinementReleaseControlEnabled=()=>require('./weapon-instance-config.cjs').refinementReleaseControlEnabled}) {
    const releaseControl=require('./refinement-release.cjs').createReleaseControl({db,now,enabled:refinementReleaseControlEnabled});
    const refinementStats=require('./refinement-statistics.cjs').createRefinementStatistics({db,now});
    const refinementOpsModule=require('./refinement-operations.cjs'),refinementOps=refinementOpsModule.createRefinementOperations({db,now,statistics:refinementStats});
    const weaponRepository=require('./weapon-repository.cjs').createWeaponRepository({db,enabled:weaponInstanceEnabled});
    const management=createManagement({db,now}),reporting=createReporting({db,now}),farmRanking=require('./farm-ranking.cjs').createFarmRanking({db,now});
    async function admin(request){
        const uid=D.adminIdentity(request.auth),user=await auth.getUser(uid);
        if(user.disabled||user.customClaims?.role!=='admin')D.fail('permission-denied','管理權限已撤銷，請重新登入');
        return{uid,user};
    }
    async function player(request,transaction){
        if(!request.auth?.uid)D.fail('unauthenticated','請重新登入玩家帳號');
        const groupId=D.id(request.data?.groupId);
        const token=request.auth.token||{};
        if(token.photoGroupId!==groupId||typeof token.photoAccountId!=='string')D.fail('permission-denied','玩家工作階段與群組不符，請重新登入');
        const read=ref=>transaction?transaction.get(ref):ref.get();
        const privateMode=await privateIdentityEnabled();
        let privateActor=null;
        if(privateMode){
            // 身分與全域開關各自驗證，但下載可以平行；仍先檢查切換狀態，保留原錯誤順序。
            const identityAttempt=Promise.resolve().then(()=>require('./identity-access.cjs').assertIdentity(request,db,transaction)).then(value=>({value}),error=>({error}));
            if((await read(db.doc('ops_identity_state/global'))).data()?.ready!==true)D.fail('failed-precondition','私有登入尚未完成切換');
            const attempt=await identityAttempt;if(attempt.error)throw attempt.error;privateActor=attempt.value;
        }
        const profileId=privateActor?.profileId||request.auth.uid;
        // 私有驗證已讀取這份 profile；沿用同一次驗證的快照，不再重讀 users。
        const profile=privateActor?.profile||(await read(db.doc(`users/${D.id(profileId)}`))).data();
        if(!profile||profile.role==='removed'||profile.accountId!==token.photoAccountId)D.fail('permission-denied','玩家帳號無效或已停用');
        const [restriction,groupSnap]=await Promise.all([
            read(db.doc(`ops_player_controls/${D.id(profileId)}`)),
            read(db.doc(`groups/${groupId}`))
        ]);
        if(restriction.data()?.blocked===true)D.fail('permission-denied','此帳號暫停使用營運功能，請聯絡管理員');
        if(!groupSnap.data()?.members?.includes(profile.accountId))D.fail('permission-denied','已不在此群組');
        return{uid:profileId,authUid:request.auth.uid,accountId:profile.accountId,name:profile.name||profile.accountId,groupId};
    }
    async function playerSession(request){
        // 格式與作用域錯誤仍須在任何資料庫／Auth RPC 前拒絕。
        if(!request.auth?.uid)D.fail('unauthenticated','請重新登入玩家帳號');
        const groupId=D.id(request.data?.groupId),token=request.auth.token||{};
        if(token.photoGroupId!==groupId||typeof token.photoAccountId!=='string')D.fail('permission-denied','玩家工作階段與群組不符，請重新登入');
        // Auth 與 Firestore 判定均不可省略；它們是獨立來源，不必依序等待網路。
        const lookup=request.auth?.uid?Promise.resolve().then(()=>auth.getUser(request.auth.uid)).then(user=>({user}),error=>({error})):null;
        const identity=await player(request);
        const result=await lookup;if(result.error)throw result.error;
        if(result.user.disabled)D.fail('permission-denied','玩家帳號已停用');
        return identity;
    }
    // Economic mutations revalidate all mutable Firestore permissions INSIDE the
    // transaction. Only Auth RPC and token structure are checked before it.
    async function transactionSession(request){
        if(!request.auth?.uid)D.fail('unauthenticated','請重新登入玩家帳號');
        const groupId=D.id(request.data?.groupId),token=request.auth.token||{};
        if(token.photoGroupId!==groupId||typeof token.photoAccountId!=='string')D.fail('permission-denied','玩家工作階段與群組不符，請重新登入');
        let uid=request.auth.uid;
        if(await privateIdentityEnabled()){
            const I=require('./identity-domain.cjs');
            if(typeof token.nexusProfileId!=='string')D.fail('unauthenticated','請重新登入 Nexus');
            uid=I.id(token.nexusProfileId);
            if(request.auth.uid!==I.profileUid(uid))D.fail('permission-denied','登入身分不符');
        }
        const user=await auth.getUser(request.auth.uid);
        if(user.disabled)D.fail('permission-denied','玩家帳號已停用');
        return{uid};
    }
    async function throttle(key,maximum,windowMs){
        const ref=db.doc(`ops_limits/${D.hash(key)}`);
        await db.runTransaction(async t=>{
            const snap=await t.get(ref),old=snap.data(),stamp=now();
            const reset=!old||stamp>=old.resetAt;
            const count=reset?1:old.count+1;
            if(count>maximum)D.fail('resource-exhausted','操作過於頻繁，請稍後再試');
            t.set(ref,{count,resetAt:reset?stamp+windowMs:old.resetAt,expiresAt:stamp+86400000});
        });
    }
    async function list(kind,payload={}){
        const collection=Object.hasOwn(COLLECTIONS,kind)?COLLECTIONS[kind]:null;if(!collection)D.fail('invalid-argument','未知列表');
        let query=db.collection(collection);
        const filters=['announcements','notifications'].includes(kind)?['status','type']:kind==='gifts'?['status','type']:kind==='redemptions'?['giftCodeId','accountId','result']:['action','result'];
        for(const field of filters)if(payload[field])query=query.where(field,'==',D.text(payload[field],160));
        if(['announcements','notifications','gifts'].includes(kind)&&D.search(payload.search))query=query.where('searchTokens','array-contains',D.search(payload.search));
        query=query.orderBy('createdAt','desc');
        if(payload.cursor){
            const cursor=await db.doc(`${collection}/${D.id(payload.cursor)}`).get();
            if(!cursor.exists)D.fail('failed-precondition','分頁資料已變更，請重新搜尋');query=query.startAfter(cursor);
        }
        const size=payload.pageSize===undefined?25:D.integer(payload.pageSize,1,50);
        const snapshot=await query.limit(size+1).get(),docs=snapshot.docs.slice(0,size);
        return{rows:docs.map(doc=>kind==='gifts'?D.safeGift({...doc.data(),id:doc.id}):{...doc.data(),id:doc.id}),nextCursor:snapshot.size>size?docs.at(-1).id:null};
    }
    async function dashboard(){
        const stamp=now(),announcements=db.collection(COLLECTIONS.announcements),gifts=db.collection(COLLECTIONS.gifts);
        // 固定兩個時間欄位的排序，與 status/startAt/endAt 複合索引維持一致。
        const effectiveAnn=announcements.where('status','in',['published','scheduled']).where('startAt','<=',stamp).where('endAt','>',stamp).orderBy('startAt').orderBy('endAt');
        const effectiveGifts=gifts.where('status','==','active').where('startAt','<=',stamp).where('endAt','>',stamp).orderBy('startAt').orderBy('endAt');
        const count=async(q,metric)=>{
            try{return (await q.count().get()).data().count;}
            catch(error){
                const indexMissing=[9,'9','failed-precondition','FAILED_PRECONDITION'].includes(error.code)&&/index/i.test(error.message||'');
                // 不記錄查詢內容、玩家資料或完整 SDK 訊息，避免敏感資料進入日誌。
                console.error('game-ops-dashboard-query-failed',{metric,code:error.code??'internal',indexMissing});
                if(indexMissing)D.fail('failed-precondition',`營運總覽「${metric}」所需的 Firestore 索引尚未就緒，請建立營運總覽索引並等待 READY 後重試。`);
                throw error;
            }
        };
        const [players,announcementCount,activeAnnouncements,giftCount,activeGifts,redemptionCount,recent]=await Promise.all([
            count(db.collection('users'),'玩家總數'),count(announcements,'公告總數'),count(effectiveAnn,'有效公告'),count(gifts,'禮包總數'),count(effectiveGifts,'有效禮包'),count(db.collection(COLLECTIONS.redemptions).where('result','==','success'),'成功兌換次數'),list('audit',{pageSize:8})
        ]);
        return{players,announcementCount,activeAnnouncements,giftCount,activeGifts,redemptionCount,recent:recent.rows,asOf:stamp,playerCountDefinition:'users 文件總數（含已停用帳號）'};
    }
    async function save(uid,action,payload,requestId){
        const kind=action==='saveAnnouncement'?'announcements':action==='saveNotification'?'notifications':'gifts',collection=COLLECTIONS[kind];
        const isGift=kind==='gifts',recordId=payload.id?D.id(payload.id):crypto.randomUUID();
        const value=isGift?D.gift(payload):D.announcement(payload);
        if(!isGift&&value.status==='published'&&value.startAt>now())D.fail('invalid-argument','立即發布的開始時間不能在未來');
        const rawCode=isGift&&!payload.id?(payload.code?D.normalizeCode(payload.code):D.generateCode()):null;
        if(isGift&&payload.id&&payload.code)D.fail('invalid-argument','已建立的兌換碼不可修改，請另建禮包');
        const codeHash=rawCode?D.hash(rawCode):null;
        const ref=db.doc(`${collection}/${recordId}`),journal=db.doc(`ops_admin_requests/${D.hash(uid+':'+requestId)}`),digest=D.fingerprint({action,payload});
        const auditRef=db.collection(COLLECTIONS.audit).doc();
        const result=await db.runTransaction(async t=>{
            const prior=await t.get(journal);
            if(prior.exists){
                if(prior.data().fingerprint!==digest)D.fail('invalid-argument','請求識別碼已使用，請重新操作');
                return{...prior.data().response,replayed:true,codeUnavailable:isGift&&!payload.id};
            }
            const snap=await t.get(ref),before=snap.data();
            if(payload.id&&!snap.exists)D.fail('not-found','找不到要編輯的資料');
            if(!isGift&&before?.sourceEventId)D.fail('failed-precondition','此公告由活動管理維護，請至活動管理編輯');
            if(isGift&&codeHash){const mapping=await t.get(db.doc(`ops_code_index/${codeHash}`));if(mapping.exists)D.fail('already-exists','此兌換碼已存在，請使用另一組');}
            if(isGift&&before?.redeemedCount){
                for(const field of ['type','rewards','targetAccountIds'])if(D.fingerprint(before[field])!==D.fingerprint(value[field]))D.fail('failed-precondition','已有兌換紀錄，不可變更獎勵、模式或指定對象');
                if(value.maxRedemptions!==null&&value.maxRedemptions<before.redeemedCount)D.fail('failed-precondition','總上限不得低於已兌換次數');
            }
            const stamp=now(),after={...value,[isGift?'giftCodeId':kind==='notifications'?'notificationId':'announcementId']:recordId,createdBy:before?.createdBy||uid,createdAt:before?.createdAt||stamp,updatedAt:stamp};
            if(isGift)Object.assign(after,{codeHash:codeHash||before.codeHash,redeemedCount:before?.redeemedCount||0});
            const response={id:recordId,record:isGift?D.safeGift(after):after};
            t.set(ref,after);
            if(!isGift)t.set(db.doc('ops_feed_versions/global'),{revision:crypto.randomUUID()});
            if(codeHash)t.create(db.doc(`ops_code_index/${codeHash}`),{giftCodeId:recordId});
            t.create(auditRef,{adminUid:uid,createdAt:stamp,action,target:collection+'/'+recordId,before:cleanAudit(before),after:cleanAudit(after),result:'success',requestId});
            t.create(journal,{fingerprint:digest,response,createdAt:stamp});
            return response;
        });
        return rawCode&&!result.replayed?{...result,code:rawCode}:result;
    }
    async function adminAPI(request){
        const {uid,user}=await admin(request),{action,payload={}}=request.data||{};
        await throttle('admin:'+uid,120,60000);
        if(['refinementReleaseStatus','refinementPreviewRelease','refinementPublishRelease','refinementPauseRelease'].includes(action)){const grants=refinementOpsModule.permissions(user);refinementOpsModule.requirePermission(grants,'read');if(action!=='refinementReleaseStatus'){refinementOpsModule.requirePermission(grants,'publish');refinementOpsModule.requirePermission(grants,'risk');}return releaseControl.admin({uid,action,payload,requestId:request.data?.requestId});}
        if(refinementOpsModule.ACTIONS.has(action)){return refinementOps.handle({uid,user,action,payload,requestId:request.data?.requestId});}
        if(['publishRefinementConfig','publishRefinementResetConfig','publishRefinementStoneConfig'].includes(action))D.fail('failed-precondition','請改用精煉管理草稿、預覽及發布流程');
        if(['refinementConfig','refinementResetConfig','refinementStoneConfig'].includes(action))refinementOpsModule.requirePermission(refinementOpsModule.permissions(user),'read');
        if(Array.isArray(user.customClaims?.refinementPermissions)&&user.customClaims.opsLegacyAccess!==true&&!['dashboard','refinementConfig','refinementResetConfig','refinementStoneConfig'].includes(action))D.fail('permission-denied','此精煉營運帳號未獲授其他營運模組權限');
        if(action==='refinementStoneConfig')return stoneRewards.readConfiguration();
        if(action==='refinementResetConfig')return refinementPlayer.readConfiguration();
        if(action==='refinementConfig')return refinement.readConfiguration();
        if(action==='dashboard')return dashboard();
        if(action==='farmReport')return reporting.report(payload);
        if(action==='list')return list(payload.kind,payload);
        if(action==='catalog')return rewardCatalog();
        if(['dailyConfig','dailyPlayer','dailyGrants'].includes(action))return dailyChallenges.adminRead(action,payload);
        if(management.isRead(action))return management.query(action,payload);
        const requestId=D.requestId(request.data.requestId);
        try{
            if(management.isWrite(action))return await management.mutate(uid,action,payload,requestId);
            if(['saveAnnouncement','saveNotification','saveGift'].includes(action))return await save(uid,action,payload,requestId);
            D.fail('invalid-argument','尚未提供此管理操作');
        }catch(error){
            await db.collection(COLLECTIONS.audit).add({adminUid:uid,createdAt:now(),action:typeof action==='string'?action.slice(0,80):'invalid',target:payload.uid?'users/'+String(payload.uid).slice(0,160):payload.id?String(payload.id).slice(0,160):payload.breedId?'guard-dogs/'+String(payload.breedId).slice(0,160):action==='saveSettings'?'ops_settings/global':null,result:'failed',errorCode:error.code||'internal',requestId});
            throw error;
        }
    }
    async function rewardCatalog(){
        const {BREEDS}=await import('./game/poultry.js'),stoneAvailable=await stoneRewards.giftAvailable();
        return{coins:{enabled:true},eggs:Object.entries(BREEDS).map(([key,b])=>({key,name:b.eggName,enabled:true})),chickens:Object.entries(BREEDS).map(([key,b])=>({key,name:b.name,enabled:key==='hen',reason:key==='hen'?'':'第一階段僅開放母雞獎勵'})),items:D.ITEMS.map(key=>({key,name:D.ITEM_NAMES[key],enabled:key==='refinement_stone'?stoneAvailable:true,...(key==='refinement_stone'?{reason:stoneAvailable?'':'材料獎勵尚未開放'}:{})})),limits:{coins:1000000,eggs:1000,chicken:20,item:1000}};
    }
    async function announcements(request){
        const identity=await playerSession(request);await throttle((request.data.action==='ranking'?'ranking:':'announcements:')+identity.uid,30,60000);
        if(request.data.action==='ranking'){
            try{return await farmRanking.load(identity,request.data.ranking);}
            catch(error){if([9,'9','failed-precondition'].includes(error.code)&&/index/i.test(error.message||''))return{rankingUnavailable:'index'};throw error;}
        }
        const settings=(await management.settings()).values;
        if(!settings.announcementsEnabled)return{rows:[],nextCursor:null,...(request.data.action==='feeds'?{feeds:{announcements:{rows:[],nextCursor:null},notifications:{rows:[],nextCursor:null}}}:{}),asOf:now(),paused:true,settings};
        if(request.data.action==='feeds'){
            const stamp=now(),revision=(await db.doc('ops_feed_versions/global').get()).data()?.revision||null;
            const known=request.data.known;
            if(revision&&known?.revision===revision&&Number.isFinite(known.validUntil)&&known.validUntil>stamp&&known.validUntil<=stamp+86400000)
                return{notModified:true,revision,settings,asOf:stamp};
            const feeds={},boundaries=[];
            await Promise.all(['announcements','notifications'].map(async channel=>{
                const result=await db.collection(COLLECTIONS[channel]).where('status','in',['published','scheduled']).where('audienceKeys','array-contains-any',['all','account:'+identity.accountId]).orderBy('priority','desc').orderBy('createdAt','desc').limit(101).get();
                const scanned=result.docs.slice(0,100).map(doc=>({...doc.data(),id:doc.id}));
                for(const row of scanned)for(const value of [row.startAt,row.endAt])if(Number.isFinite(value)&&value>stamp)boundaries.push(value);
                feeds[channel]={rows:scanned.filter(a=>D.activeAnnouncement(a,identity.accountId,stamp)).map(({searchTokens,audienceKeys,...a})=>a),nextCursor:result.size>100?scanned.at(-1).id:null};
            }));
            return{feeds,revision,validUntil:Math.min(stamp+86400000,...boundaries),asOf:stamp,settings};
        }
        const kind=D.enumValue(request.data.channel||'announcements',['announcements','notifications']),collection=COLLECTIONS[kind];
        let query=db.collection(collection).where('status','in',['published','scheduled']).where('audienceKeys','array-contains-any',['all','account:'+identity.accountId]).orderBy('priority','desc').orderBy('createdAt','desc');
        if(request.data.cursor){const cursor=await db.doc(`${collection}/${D.id(request.data.cursor)}`).get();if(!cursor.exists)D.fail('failed-precondition','公告分頁已變更');query=query.startAfter(cursor);}
        // 在後端檢查有效期，不回傳過期或屬於其他玩家的內容。
        const result=await query.limit(101).get(),scanned=result.docs.slice(0,100),stamp=now();
        return{rows:scanned.map(doc=>({...doc.data(),id:doc.id})).filter(a=>D.activeAnnouncement(a,identity.accountId,stamp)).map(({searchTokens,audienceKeys,...a})=>a),nextCursor:result.size>100?scanned.at(-1).id:null,asOf:stamp,settings};
    }
    async function guardDog(request){
        const identity=await playerSession(request),input=request.data||{};
        const action=D.enumValue(input.action,['rent','activate','release','resume','pause','expire','catalog']);
        if(action==='catalog'){await throttle('guard-catalog:'+identity.uid,30,60000);return management.guardCatalog();}
        const requestId=D.requestId(input.requestId);
        await throttle('guard-dog:'+identity.uid,30,60000);
        const G=await import('./game/guard-dog-core.js');
        const payload={action};
        if(action==='rent'){
            payload.breedId=D.id(input.breedId);payload.days=D.integer(input.days,1,Number.MAX_SAFE_INTEGER);
            if(!Object.hasOwn(G.GUARD_DOG_BREEDS,payload.breedId))D.fail('invalid-argument','找不到此護衛犬');
            // 以部署後端的設定為準，不信任客戶端的開放旗標或價格。

        }else if(action!=='expire')payload.id=D.id(input.id);
        const fingerprint=D.fingerprint({groupId:identity.groupId,...payload}),receipt=db.doc(`ops_guard_requests/${D.hash(identity.uid+':'+requestId)}`);
        return db.runTransaction(async t=>{
            const current=await player(request,t),prior=await t.get(receipt);
            if(prior.exists){if(prior.data().fingerprint!==fingerprint)D.fail('invalid-argument','此請求識別碼已用於其他操作');return{...prior.data().response,replayed:true};}
            const ref=db.doc(`groups/${current.groupId}/users/${current.accountId}`),snapshot=await t.get(ref),farm=snapshot.data()?.farm,stamp=now();
            if(!farm)D.fail('failed-precondition','找不到農場存檔');
            const catalog=action==='rent'?await management.guardCatalog(t):null;
            if(catalog&&!catalog.settings.guardDogRentalsEnabled)D.fail('failed-precondition',catalog.settings.pauseMessage);
            if(catalog&&input.expectedPrice!==undefined&&D.integer(input.expectedPrice,1,Number.MAX_SAFE_INTEGER)!==G.rentalPrice(payload.breedId,payload.days,catalog.breeds))D.fail('failed-precondition','租金已變更，請重新開啟商品確認');
            let patch;
            try{
                patch=action==='rent'?G.rentGuardDog(farm,payload.breedId,payload.days,requestId,stamp,catalog.breeds):['activate','resume'].includes(action)?G.activateGuardDog(farm,payload.id,stamp):['release','pause'].includes(action)?G.releaseGuardDog(farm,payload.id,stamp):{'farm.guardDogs':G.guardDogLeases(farm,stamp)};
            }catch(error){D.fail('failed-precondition',error.message||'護衛犬操作失敗');}
            const next={...farm,...Object.fromEntries(Object.entries(patch).map(([key,value])=>[key.slice(5),value]))};
            const response={action,dogId:action==='rent'?requestId:payload.id||null,paid:action==='rent'?farm.coins-next.coins:0};
            if(D.fingerprint(next)!==D.fingerprint(farm))t.update(ref,{farm:next});
            t.create(receipt,{uid:current.uid,groupId:current.groupId,fingerprint,response,createdAt:stamp});
            return response;
        });
    }
    /**
     * 驗證玩家、碼、期間、對象及限額，原子發獎並建立成功收據。
     * @param {Object} request - Firebase 驗證過的 auth 與 code、groupId、requestId。
     * @returns {Promise<Object>} 獎勵結果；相同收據重送不再發獎。
     * @description 僅更新 Firestore，RTDB 由既有鏡像更新；不建立跨庫第二份獎勵。
     */
    async function redeem(request){
        const identity=await playerSession(request),requestId=D.requestId(request.data.requestId);
        // 先限流再解析活動碼，格式錯誤的嘗試也必須計數。
        await throttle('redeem:'+identity.uid,10,60000);
        const ip=request.rawRequest?.ip;if(ip)await throttle('redeem-ip:'+ip,60,60000);
        let giftCodeId=null,giftName=null;
        try{
            const codeHash=D.hash(D.normalizeCode(request.data.code)),receiptId=D.hash(identity.uid+':'+requestId),receipt=db.doc(`ops_receipts/${receiptId}`);
            return await db.runTransaction(async t=>{
                const current=await player(request,t);
                const prior=await t.get(receipt);
                if(prior.exists){
                    const data=prior.data();
                    if(data.codeHash!==codeHash||data.groupId!==current.groupId)D.fail('invalid-argument','此請求識別碼已用於其他兌換');
                    return{...data.response,replayed:true};
                }
                const system=(await management.settings(t)).values;if(!system.redemptionEnabled)D.fail('failed-precondition',system.pauseMessage);
                const lookup=await t.get(db.doc(`ops_code_index/${codeHash}`));
                if(!lookup.exists)D.fail('not-found','找不到此禮包，請確認兌換碼');
                giftCodeId=lookup.data().giftCodeId;
                const giftRef=db.doc(`${COLLECTIONS.gifts}/${D.id(giftCodeId)}`),giftSnap=await t.get(giftRef),g=giftSnap.data();
                if(!g)D.fail('not-found','找不到此禮包');giftName=g.name;
                const claimRef=giftRef.collection('claims').doc(D.hash(current.accountId)),claim=await t.get(claimRef);
                const ownerRef=db.doc(`groups/${current.groupId}/users/${current.accountId}`),owner=await t.get(ownerRef),stamp=now();
                D.assertRedeemable(g,current.accountId,claim.data()?.count||0,stamp);
                const stoneReward=await stoneRewards.authorizeGift(t,g.rewards,stamp,current);
                const awarded=await D.award(owner.data()?.farm,g.rewards,stamp,{allowRefinementStones:!!stoneReward});
                const response={redemptionId:receiptId,giftCodeId,name:g.name,rewards:g.rewards,createdAt:stamp,...(stoneReward?{refinementStoneReward:stoneReward}:{})};
                const weaponWrite=await weaponRepository.prepareChange({t,actor:current,before:owner.data()?.farm,next:awarded,source:'gift:'+receiptId,stamp,action:'award'});
                weaponWrite();
                t.update(ownerRef,{farm:awarded});
                t.update(giftRef,{redeemedCount:g.redeemedCount+1,updatedAt:stamp});
                t.set(claimRef,{count:(claim.data()?.count||0)+1,accountId:current.accountId,updatedAt:stamp});
                t.create(receipt,{uid:current.uid,groupId:current.groupId,codeHash,response,createdAt:stamp});
                t.create(db.doc(`${COLLECTIONS.redemptions}/${receiptId}`),{...response,uid:current.uid,accountId:current.accountId,groupId:current.groupId,result:'success',failureReason:null,requestId});
                return response;
            });
        }catch(error){
            await db.collection(COLLECTIONS.redemptions).add({giftCodeId,name:giftName,uid:identity.uid,accountId:identity.accountId,groupId:identity.groupId,createdAt:now(),result:'failed',rewards:[],failureReason:error.message&&error.code?error.message:'服務暫時無法使用',errorCode:error.code||'internal',requestId});
            throw error;
        }
    }
    const trustedReady=async t=>{if(!await privateIdentityEnabled()||!await farmBackendEnabled())return false;const row=(await(t?t.get(db.doc('ops_identity_state/global')):db.doc('ops_identity_state/global').get())).data();return row?.ready===true&&row?.farmReady===true;};
    const stoneRewards=require('./refinement-stone-rewards.cjs').createStoneRewardService({db,now,enabled:refinementStoneRewardEnabled,trustedReady,testEnvironment:stoneRewardTestEnvironment,testRandomInt:stoneRewardRandomInt,sourceAdmission:(t,actor)=>releaseControl.can(t,actor,'stoneSources'),sourceAvailability:t=>releaseControl.hasStoneSources(t)});
    const dailyChallenges=createDailyChallenges({db,now,player,playerSession,throttle,trustedReady,stoneRewards});
    const Refinement=require('./refinement-service.cjs');
    const refinement=Refinement.createRefinementService({db,now,player,enabled:weaponRefinementEnabled,combatEnabled:refinementCombatBonusEnabled,instanceEnabled:weaponInstanceEnabled,trustedReady,testEnvironment:refinementTestEnvironment,testRandomInt:refinementRandomInt,testHooks:refinementHooks,testAccounts:refinementTestAccounts,releaseAdmission:(t,actor)=>releaseControl.can(t,actor,'refinement'),releaseVersion:async(t,actor)=>(await releaseControl.decision(t,actor)).version});
    const PlayerRefinement=require('./refinement-player-service.cjs');
    const refinementPlayer=PlayerRefinement.createRefinementPlayerService({db,now,player,enabled:weaponRefinementEnabled,resetEnabled:refinementResetEnabled,combatEnabled:refinementCombatBonusEnabled,instanceEnabled:weaponInstanceEnabled,trustedReady,testEnvironment:refinementTestEnvironment,testAccounts:refinementTestAccounts,releaseDecision:(t,actor)=>releaseControl.decision(t,actor)});
    const transactions=require('./farm-transactions.cjs').createFarmTransactions({db,now,player,verifiedInputEnabled:async(t,a)=>verifiedCombatTestEnvironment===true&&require('./refinement-access.cjs').testAccess(true,verifiedCombatTestAccounts)(a),random:farmRandom,enabled:t=>trustedReady(t),prepareProgress:dailyChallenges.prepareProgress,weaponInstanceEnabled,stoneRewards,allowRefinedSales:()=>true});
    const farmRecovery=require('./farm-recovery.cjs').createFarmRecovery({db,player,now});
    async function farmTransaction(request){
        const started=performance.now();await transactionSession(request);const verified=performance.now();
        let admissionMs=0;
        const response=await (request.data?.action==='getFarmTransactionResult'?farmRecovery:PlayerRefinement.ACTIONS.has(request.data?.action)?refinementPlayer:Refinement.ACTIONS.has(request.data?.action)?refinement:transactions).handle(request,{admit:async actor=>{const start=performance.now();await throttle('farm:'+actor.uid,180,60000);admissionMs+=performance.now()-start;}}),finished=performance.now();
        if(['visitEncounter','stealEgg'].includes(request.data?.action)){
            // 不記錄帳號、群組、payload 或憑證；只量測成功請求的處理階段。
            const timing={identityMs:Math.round(verified-started),rateLimitMs:Math.round(admissionMs),transactionMs:Math.round(Math.max(0,finished-verified-admissionMs)),handlerMs:Math.round(finished-started)};
            console.info('farm-theft-timing',{action:request.data.action,combined:request.data.stealWhenClear===true,...timing});
            return{...response,timing};
        }
        return response;
    }
    return{adminAPI,announcements,redeem,rewardCatalog,guardDog,farmTransaction,dailyChallenges:dailyChallenges.handle};
}
module.exports={createService,COLLECTIONS};
