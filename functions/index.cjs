const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { timingSafeEqual } = require('node:crypto');
const { key } = require('./live-model.cjs');
initializeApp({ databaseURL: 'https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app' });
const firestore = getFirestore();
let mirrorInstance;
const makeMirror = require('./mirror.cjs');
const getMirror = () => mirrorInstance ||= makeMirror(firestore, getDatabase());
const region = 'asia-southeast1';
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
exports.liveProfileMirror = onDocumentWritten(trigger('users/{profileId}'), async event => {
    const old = event.data.before.data(), current = event.data.after.data();
    if (old && current && ['accountId', 'name', 'role'].every(key => old[key] === current[key])) return;
    const ids = [...new Set([event.data.before.data()?.accountId, event.data.after.data()?.accountId].filter(Boolean))];
    for (const accountId of ids) {
        await getMirror().account(accountId, event.data.after, event.time);
        const groups = await firestore.collection('groups').where('members', 'array-contains', accountId).get();
        for (const group of groups.docs) await getMirror().refreshGroupRooms(group.id, event.time);
    }
});
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function validateSession(request) {
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
    const { accountId, groupId, user } = await validateSession(request);
    const token = await getAuth().createCustomToken(user.id, { photoAccountId: accountId, photoGroupId: groupId });
    return { token };
});
exports.liveSession = onCall({ region, cors: true, maxInstances: 5 }, async request => {
    const { accountId, groupId, user, group } = await validateSession(request);
    await getMirror().account(accountId, user);
    await getMirror().group(groupId, group);
    const token = await getAuth().createCustomToken(user.id, { accountKey: key(accountId), groupKey: key(groupId) });
    return { token };
});
