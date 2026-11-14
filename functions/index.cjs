/**
 * nexus-live 後端入口：Firestore→RTDB 鏡像、既有登入橋接與成長森林 callable。
 * 以 Admin SDK 存取資料；來源事件可能重送，鏡像須遵守版本比較，勿將前端快取視為授權。
 * @module
 */
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { timingSafeEqual } = require('node:crypto');
const { key } = require('./live-model.cjs');
const demoDatabaseURL=typeof process!=='undefined'&&process.env.FIREBASE_DATABASE_EMULATOR_HOST&&process.env.GCLOUD_PROJECT?.startsWith('demo-')?`https://${process.env.GCLOUD_PROJECT}.firebaseio.com`:null;
initializeApp({ databaseURL: demoDatabaseURL||'https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app' });
const firestore = getFirestore();
let mirrorInstance;
const makeMirror = require('./mirror.cjs');
const getMirror = () => mirrorInstance ||= makeMirror(firestore, getDatabase(),{privateIdentityEnabled:()=>privateIdentityEnabled.value()});
const region = 'asia-southeast1';
const {defineBoolean}=require('firebase-functions/params');
const privateIdentityEnabled=defineBoolean('NEXUS_PRIVATE_IDENTITY_ENABLED',{default:false});
const {createIdentityService}=require('./identity-service.cjs');
const identityService=createIdentityService({db:firestore,auth:getAuth(),enabled:()=>privateIdentityEnabled.value()});
exports.nexusIdentity=onCall({region,cors:true,maxInstances:5,concurrency:4,memory:'512MiB',timeoutSeconds:30},async request=>{try{return await identityService.handle(request);}catch(error){const allowed=['invalid-argument','unauthenticated','permission-denied','already-exists','failed-precondition','resource-exhausted','not-found'];throw new HttpsError(allowed.includes(error.code)?error.code:'internal',allowed.includes(error.code)?error.message:'登入服務暫時無法使用');}});
const trigger = document => ({ document, region, retry: true });
exports.liveFarmMirror = onDocumentWritten(trigger('groups/{groupId}/users/{accountId}'), event => {
    if (JSON.stringify(event.data.before.data()?.farm) === JSON.stringify(event.data.after.data()?.farm)) return;
    return getMirror().farm(event.params.groupId, event.params.accountId, event.data.after, event.time);
});
exports.liveRoomMirror = onDocumentWritten(trigger('rooms/{roomId}'), event => getMirror().room(event.params.roomId, event.data.after, event.data.before, event.time));
exports.liveMessageMirror = onDocumentWritten(trigger('messages/{messageId}'), event => getMirror().message(event.params.messageId, event.data.after, event.data.before, event.time));
exports.liveGroupMirror = onDocumentWritten(trigger('groups/{groupId}'), async event => {
    const before = event.data.before.data(), after = event.data.after.data();
    if (before && after && JSON.stringify(before.members) === JSON.stringify(after.members) && before.farmVillageVisibility === after.farmVillageVisibility) return;
    await getMirror().group(event.params.groupId, event.data.after, event.time);
    await getMirror().refreshGroupRooms(event.params.groupId, event.time);
});
exports.liveIdentityMirror=onDocumentWritten(trigger('ops_identity_credentials/{profileId}'),async event=>{const profile=await firestore.doc('users/'+event.params.profileId).get();if(profile.exists)await getMirror().account(profile.data().accountId,profile,event.time);});
exports.liveProfileMirror = onDocumentWritten(trigger('users/{profileId}'), async event => {
    const old = event.data.before.data(), current = event.data.after.data();
    if (old && current && ['accountId', 'name', 'role'].every(key => old[key] === current[key]) && JSON.stringify(old.nameHistory) === JSON.stringify(current.nameHistory)) return;
    const ids = [...new Set([event.data.before.data()?.accountId, event.data.after.data()?.accountId].filter(Boolean))];
    for (const accountId of ids) {
        await getMirror().account(accountId, event.data.after, event.time);
        const groups = await firestore.collection('groups').where('members', 'array-contains', accountId).get();
        for (const group of groups.docs) await getMirror().refreshGroupRooms(group.id, event.time);
    }
});
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/**
 * 驗證舊制帳號憑證與目前群組資格，供 custom-token 橋接使用。
 * @param {Object} request - callable request；data 含 accountId、groupId、secret。
 * @returns {Promise<Object>} 帳號、群組與查核後文件，供建立最小必要 claims。
 * @throws {HttpsError} 帳號不唯一、已停用、憑證不符或已不在群組。
 * @description 不記錄輸入憑證或完整回傳 Token；這是舊登入相容流程。
 */
async function validateSession(request) {
    if(identityService.configured()){const actor=await identityService.groupIdentity(request);return{accountId:actor.accountId,groupId:actor.groupId,user:{id:actor.profileId},group:actor.group,privateActor:actor};}
    const { accountId, groupId, secret } = request.data || {};
    if (typeof accountId !== 'string' || typeof groupId !== 'string' || typeof secret !== 'string' || !secret || !groupId || groupId.includes('/') || accountId.length > 500 || groupId.length > 500 || secret.length > 1000) throw new HttpsError('unauthenticated', '請重新登入。');
    const users = await firestore.collection('users').where('accountId', '==', accountId).limit(2).get();
    const user = users.size === 1 ? users.docs[0] : null;
    const profile = user?.data();
    if (!profile || profile.role === 'removed' || (!same(profile.password, secret) && !same(profile.pin, secret))) throw new HttpsError('unauthenticated', '請重新登入。');
    const group = await firestore.doc(`groups/${groupId}`).get();
    if (!group.exists || !group.data().members?.includes(accountId)) throw new HttpsError('permission-denied', '你已不在此群組。');
    return { accountId, groupId, user, group };
}
exports.photoSession = onCall({ region, cors: true, maxInstances: 5 }, async request => {
    const { accountId, groupId, user, privateActor } = await validateSession(request);
    if(privateActor)return{token:await identityService.tokenFor(privateActor,{photoAccountId:accountId,photoGroupId:groupId})};
    const token = await getAuth().createCustomToken(user.id, { photoAccountId: accountId, photoGroupId: groupId });
    return { token };
});
exports.liveSession = onCall({ region, cors: true, maxInstances: 5 }, async request => {
    const { accountId, groupId, user, group, privateActor } = await validateSession(request);
    await getMirror().account(accountId, privateActor?await firestore.doc('users/'+privateActor.profileId).get():user);
    await getMirror().group(groupId, group);
    if(privateActor)return{token:await identityService.tokenFor(privateActor,{accountKey:key(accountId),groupKey:key(groupId)})};
    const token = await getAuth().createCustomToken(user.id, { accountKey: key(accountId), groupKey: key(groupId) });
    return { token };
});

// 成長森林沿用既有伺服器驗證的 Nexus custom-token 身分。
let growthService;
exports.growthForest=onCall({region,cors:true,maxInstances:10},async request=>{
    try{growthService ||= require('./growth-service.cjs').createGrowthService({db:firestore,resolvePrivateIdentity:async(request,t)=>{if(!privateIdentityEnabled.value())return null;if(!(await (t?t.get(firestore.doc('ops_identity_state/global')):firestore.doc('ops_identity_state/global').get())).data()?.ready)throw new HttpsError('failed-precondition','私有登入尚未完成切換');return require('./identity-access.cjs').assertIdentity(request,firestore,t);}});return await growthService.handle(request);}
    catch(error){
        const codes=['invalid-argument','unauthenticated','permission-denied','not-found','already-exists','failed-precondition','resource-exhausted'];
        if(codes.includes(error.code))throw new HttpsError(error.code,error.message);
        console.error('growth-forest-failure',{code:typeof error.code==='string'?error.code:'internal'});
        throw new HttpsError('internal','暫時無法儲存，請以同一請求重試');
    }
});
