// Read-only post-backfill checks. Requires Admin SDK credentials for homebasedb.
const { initializeApp } = require('../functions/node_modules/firebase-admin/app');
const { getFirestore } = require('../functions/node_modules/firebase-admin/firestore');
const { getDatabase } = require('../functions/node_modules/firebase-admin/database');
const { key, wire, epochMicros } = require('../functions/live-model.cjs');
const assert = require('node:assert/strict');
initializeApp({ projectId: 'homebasedb', databaseURL: 'https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app' });
const firestore = getFirestore(), database = getDatabase();
(async () => {
    const status = (await database.ref('nexus/status').get()).val();
    assert.ok(status?.farms && status?.chat, 'Backfill readiness markers are missing');
    const counts = { farms: 0, rooms: 0, messages: 0 };
    async function check(path, snapshot, data) {
        const mirror = (await database.ref('nexus/' + path).get()).val();
        const version = epochMicros(snapshot.updateTime);
        assert.ok(mirror?.data && !mirror.deleted && mirror.version >= version, `Missing or lagging mirror: ${path}`);
        // A newer mirror is valid during ongoing traffic; equal versions must match exactly.
        if (mirror.version === version) assert.deepEqual(mirror.data, wire(data), `Mismatched mirror: ${path}`);
    }
    const farms = await firestore.collectionGroup('users').get();
    for (const farm of farms.docs) {
        const group = farm.ref.parent.parent;
        if (group?.parent.id !== 'groups' || !farm.data().farm) continue;
        await check(`farms/${key(group.id)}/${key(farm.id)}`, farm, { farm: farm.data().farm }); counts.farms++;
    }
    const rooms = await firestore.collection('rooms').get();
    for (const room of rooms.docs) {
        const groupId = room.data().groupId;
        if (!groupId) continue;
        await check(`rooms/${key(groupId)}/${key(room.id)}`, room, room.data()); counts.rooms++;
        const messages = await firestore.collection('messages').where('roomId', '==', room.id).orderBy('timestamp', 'desc').limit(30).get();
        for (const message of messages.docs) {
            if (message.data().groupId && message.data().groupId !== groupId) continue;
            await check(`messages/${key(groupId)}/${key(room.id)}/${key(message.id)}`, message, message.data()); counts.messages++;
        }
    }
    console.log(JSON.stringify({ verified: true, counts }));
    // Admin's RTDB connection would otherwise keep this CLI alive.
    await require('../functions/node_modules/firebase-admin/app').deleteApp(require('../functions/node_modules/firebase-admin/app').getApp());
})().catch(error => { console.error('Verification failed:', error.message); process.exit(1); });
