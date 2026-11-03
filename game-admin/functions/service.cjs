const crypto=require('node:crypto');
const D=require('./domain.cjs');
const COLLECTIONS={announcements:'ops_announcements',gifts:'ops_gifts',redemptions:'ops_redemptions',audit:'ops_audit'};
const cleanAudit=value=>{
    if(!value)return null;
    const {codeHash,searchTokens,audienceKeys,...safe}=value;return safe;
};
function createService({db,auth,now=Date.now}) {
    async function admin(request){
        const uid=D.adminIdentity(request.auth),user=await auth.getUser(uid);
        if(user.disabled||user.customClaims?.role!=='admin')D.fail('permission-denied','管理權限已撤銷，請重新登入');
        return uid;
    }
    async function player(request,transaction){
        if(!request.auth?.uid)D.fail('unauthenticated','請重新登入玩家帳號');
        const groupId=D.id(request.data?.groupId);
        const token=request.auth.token||{};
        if(token.photoGroupId!==groupId||typeof token.photoAccountId!=='string')D.fail('permission-denied','玩家工作階段與群組不符，請重新登入');
        const read=ref=>transaction?transaction.get(ref):ref.get();
        const profileSnap=await read(db.doc(`users/${D.id(request.auth.uid)}`));
        const profile=profileSnap.data();
        if(!profile||profile.role==='removed'||profile.accountId!==token.photoAccountId)D.fail('permission-denied','玩家帳號無效或已停用');
        const groupSnap=await read(db.doc(`groups/${groupId}`));
        if(!groupSnap.data()?.members?.includes(profile.accountId))D.fail('permission-denied','已不在此群組');
        return{uid:request.auth.uid,accountId:profile.accountId,groupId};
    }
    async function playerSession(request){
        const identity=await player(request);
        const user=await auth.getUser(identity.uid);
        if(user.disabled)D.fail('permission-denied','玩家帳號已停用');
        return identity;
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
        const filters=kind==='announcements'?['status','type']:kind==='gifts'?['status','type']:kind==='redemptions'?['giftCodeId','accountId','result']:['action','result'];
        for(const field of filters)if(payload[field])query=query.where(field,'==',D.text(payload[field],160));
        if(['announcements','gifts'].includes(kind)&&D.search(payload.search))query=query.where('searchTokens','array-contains',D.search(payload.search));
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
        const effectiveAnn=announcements.where('status','in',['published','scheduled']).where('startAt','<=',stamp).where('endAt','>',stamp);
        const effectiveGifts=gifts.where('status','==','active').where('startAt','<=',stamp).where('endAt','>',stamp);
        const count=q=>q.count().get().then(s=>s.data().count);
        const [players,announcementCount,activeAnnouncements,giftCount,activeGifts,redemptionCount,recent]=await Promise.all([
            count(db.collection('users')),count(announcements),count(effectiveAnn),count(gifts),count(effectiveGifts),count(db.collection(COLLECTIONS.redemptions).where('result','==','success')),list('audit',{pageSize:8})
        ]);
        return{players,announcementCount,activeAnnouncements,giftCount,activeGifts,redemptionCount,recent:recent.rows,asOf:stamp,playerCountDefinition:'users 文件總數（含已停用帳號）'};
    }
    async function save(uid,action,payload,requestId){
        const kind=action==='saveAnnouncement'?'announcements':'gifts',collection=COLLECTIONS[kind];
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
            if(isGift&&codeHash){const mapping=await t.get(db.doc(`ops_code_index/${codeHash}`));if(mapping.exists)D.fail('already-exists','此兌換碼已存在，請使用另一組');}
            if(isGift&&before?.redeemedCount){
                for(const field of ['type','rewards','targetAccountIds'])if(D.fingerprint(before[field])!==D.fingerprint(value[field]))D.fail('failed-precondition','已有兌換紀錄，不可變更獎勵、模式或指定對象');
                if(value.maxRedemptions!==null&&value.maxRedemptions<before.redeemedCount)D.fail('failed-precondition','總上限不得低於已兌換次數');
            }
            const stamp=now(),after={...value,[isGift?'giftCodeId':'announcementId']:recordId,createdBy:before?.createdBy||uid,createdAt:before?.createdAt||stamp,updatedAt:stamp};
            if(isGift)Object.assign(after,{codeHash:codeHash||before.codeHash,redeemedCount:before?.redeemedCount||0});
            const response={id:recordId,record:isGift?D.safeGift(after):after};
            t.set(ref,after);
            if(codeHash)t.create(db.doc(`ops_code_index/${codeHash}`),{giftCodeId:recordId});
            t.create(auditRef,{adminUid:uid,createdAt:stamp,action,target:collection+'/'+recordId,before:cleanAudit(before),after:cleanAudit(after),result:'success',requestId});
            t.create(journal,{fingerprint:digest,response,createdAt:stamp});
            return response;
        });
        return rawCode&&!result.replayed?{...result,code:rawCode}:result;
    }
    async function adminAPI(request){
        const uid=await admin(request),{action,payload={}}=request.data||{};
        await throttle('admin:'+uid,120,60000);
        if(action==='dashboard')return dashboard();
        if(action==='list')return list(payload.kind,payload);
        if(action==='catalog')return rewardCatalog();
        const requestId=D.requestId(request.data.requestId);
        try{
            if(['saveAnnouncement','saveGift'].includes(action))return await save(uid,action,payload,requestId);
            D.fail('invalid-argument','尚未提供此管理操作');
        }catch(error){
            await db.collection(COLLECTIONS.audit).add({adminUid:uid,createdAt:now(),action:typeof action==='string'?action.slice(0,80):'invalid',target:payload.id?String(payload.id).slice(0,160):null,result:'failed',errorCode:error.code||'internal',requestId});
            throw error;
        }
    }
    async function rewardCatalog(){
        const {BREEDS}=await import('./game/poultry.js');
        return{coins:{enabled:true},eggs:Object.entries(BREEDS).map(([key,b])=>({key,name:b.eggName,enabled:true})),chickens:Object.entries(BREEDS).map(([key,b])=>({key,name:b.name,enabled:key==='hen',reason:key==='hen'?'':'第一階段僅開放母雞獎勵'})),items:D.ITEMS.map(key=>({key,name:D.ITEM_NAMES[key],enabled:true})),limits:{coins:1000000,eggs:1000,chicken:20,item:1000}};
    }
    async function announcements(request){
        const identity=await playerSession(request);await throttle('announcements:'+identity.uid,30,60000);
        let query=db.collection(COLLECTIONS.announcements).where('status','in',['published','scheduled']).where('audienceKeys','array-contains-any',['all','account:'+identity.accountId]).orderBy('priority','desc').orderBy('createdAt','desc');
        if(request.data.cursor){const cursor=await db.doc(`${COLLECTIONS.announcements}/${D.id(request.data.cursor)}`).get();if(!cursor.exists)D.fail('failed-precondition','公告分頁已變更');query=query.startAfter(cursor);}
        // Filter time on the server; never return an out-of-window or other-player body.
        const result=await query.limit(101).get(),scanned=result.docs.slice(0,100),stamp=now();
        return{rows:scanned.map(doc=>({...doc.data(),id:doc.id})).filter(a=>D.activeAnnouncement(a,identity.accountId,stamp)).map(({searchTokens,audienceKeys,...a})=>a),nextCursor:result.size>100?scanned.at(-1).id:null,asOf:stamp};
    }
    async function redeem(request){
        const identity=await playerSession(request),requestId=D.requestId(request.data.requestId);
        // Invalid-format attempts are rate limited too, before parsing the code.
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
                const lookup=await t.get(db.doc(`ops_code_index/${codeHash}`));
                if(!lookup.exists)D.fail('not-found','找不到此禮包，請確認兌換碼');
                giftCodeId=lookup.data().giftCodeId;
                const giftRef=db.doc(`${COLLECTIONS.gifts}/${D.id(giftCodeId)}`),giftSnap=await t.get(giftRef),g=giftSnap.data();
                if(!g)D.fail('not-found','找不到此禮包');giftName=g.name;
                const claimRef=giftRef.collection('claims').doc(D.hash(current.accountId)),claim=await t.get(claimRef);
                const ownerRef=db.doc(`groups/${current.groupId}/users/${current.accountId}`),owner=await t.get(ownerRef),stamp=now();
                D.assertRedeemable(g,current.accountId,claim.data()?.count||0,stamp);
                const awarded=await D.award(owner.data()?.farm,g.rewards,stamp);
                const response={redemptionId:receiptId,giftCodeId,name:g.name,rewards:g.rewards,createdAt:stamp};
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
    return{adminAPI,announcements,redeem,rewardCatalog};
}
module.exports={createService,COLLECTIONS};
