const { key, epochMicros, node, newer } = require('./live-model.cjs');
module.exports = function makeMirror(firestore, database) {
    const root = database.ref('nexus');
    const write = (path, value) => root.child(path).transaction(current => newer(current, value), undefined, false);
    async function account(accountId, snapshot, time) {
        if (!accountId) return;
        const data = snapshot?.exists ? snapshot.data() : null;
        await write(`access/accounts/${key(accountId)}`, { version: epochMicros(snapshot?.updateTime || time), active: !!data && data.accountId === accountId && data.role !== 'removed' });
    }
    async function group(groupId, snapshot, time) {
        const data = snapshot?.exists ? snapshot.data() : null;
        const version = epochMicros(snapshot?.updateTime || time);
        const access = { version, public: data?.farmVillageVisibility === 'public', members: Object.fromEntries((data?.members || []).map(id => [key(id), true])) };
        await write(`access/groups/${key(groupId)}`, access);
    }
    async function farm(groupId, accountId, snapshot, time) {
        const value = snapshot?.exists ? snapshot.data()?.farm : null;
        await write(`farms/${key(groupId)}/${key(accountId)}`, node(value ? { farm: value } : null, epochMicros(snapshot?.updateTime || time)));
    }
    async function participantIds(roomData) {
        if (!roomData?.groupId) return [];
        const snapshot = await firestore.doc(`groups/${roomData.groupId}`).get();
        const members = snapshot.data()?.members || [], result = [];
        for (let start = 0; start < members.length; start += 10) {
            const profiles = await firestore.collection('users').where('accountId', 'in', members.slice(start, start + 10)).get();
            profiles.forEach(doc => { const user = doc.data(); if (user.role !== 'removed' && roomData.participants?.includes(user.name)) result.push(user.accountId); });
        }
        return [...new Set(result)];
    }
    async function room(roomId, snapshot, before, time, forceRecipients = false) {
        const data = snapshot?.exists ? snapshot.data() : null, old = before?.exists ? before.data() : null;
        const version = epochMicros(snapshot?.updateTime || time);
        // Union old recipients and current group members so removals get tombstones.
        const oldAccess = (await root.child(`access/rooms/${key(roomId)}`).get()).val();
        const reuse = !forceRecipients && oldAccess?.groupKey === key(data?.groupId) && old?.groupId === data?.groupId && JSON.stringify(old?.participants) === JSON.stringify(data?.participants);
        const recipients = reuse ? Object.keys(oldAccess.participants || {}).map(decodeURIComponent) : await participantIds(data);
        const access = { version, groupKey: data?.groupId ? key(data.groupId) : '', participants: Object.fromEntries(recipients.map(id => [key(id), true])) };
        const paths = new Set();
        if (oldAccess?.groupKey) for (const accountKey of Object.keys(oldAccess.participants || {})) paths.add(`${oldAccess.groupKey}/${accountKey}`);
        if (old?.groupId && !oldAccess) for (const id of await participantIds(old)) paths.add(`${key(old.groupId)}/${key(id)}`);
        if (data?.groupId) for (const id of recipients) paths.add(`${key(data.groupId)}/${key(id)}`);
        const valid = new Set(recipients.map(id => `${key(data.groupId)}/${key(id)}`));
        const sortTime = data?.lastMessageTime?.toMillis?.() || 0;
        // Publish access first: revoked readers cannot keep listening to an old inbox.
        await write(`access/rooms/${key(roomId)}`, access);
        await Promise.all([...paths].map(path => write(`inboxes/${path}/${key(roomId)}`, node(valid.has(path) ? data : null, version, sortTime))));
        if (old?.groupId && old.groupId !== data?.groupId) await write(`rooms/${key(old.groupId)}/${key(roomId)}`, node(null, version));
        if (data?.groupId) await write(`rooms/${key(data.groupId)}/${key(roomId)}`, node(data, version, sortTime));
        else if (oldAccess?.groupKey) await write(`rooms/${oldAccess.groupKey}/${key(roomId)}`, node(null, version));
    }
    async function message(messageId, snapshot, before, time) {
        const data = snapshot?.exists ? snapshot.data() : null, old = before?.exists ? before.data() : null;
        const version = epochMicros(snapshot?.updateTime || time);
        const location = async value => {
            if (!value?.roomId) return null;
            const room = await firestore.doc(`rooms/${value.roomId}`).get();
            const groupId = room.data()?.groupId;
            // Some older system messages lack groupId. Resolve only via their room.
            if (!groupId || (value.groupId && value.groupId !== groupId)) return null;
            return `${key(groupId)}/${key(value.roomId)}/${key(messageId)}`;
        };
        const nextPath = await location(data), oldPath = await location(old);
        if (oldPath && oldPath !== nextPath) await write(`messages/${oldPath}`, node(null, version));
        if (nextPath) await write(`messages/${nextPath}`, node(data, version, data.timestamp?.toMillis?.() || 0));
    }
    async function refreshGroupRooms(groupId, time) {
        const rooms = await firestore.collection('rooms').where('groupId', '==', groupId).get();
        for (const snapshot of rooms.docs) await room(snapshot.id, snapshot, snapshot, time, true);
    }
    return { account, group, farm, room, message, refreshGroupRooms };
};
