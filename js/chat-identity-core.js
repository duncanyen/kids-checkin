// accountId is identity. Names and historical names are display/migration data.
export const profileNames = user => [...new Set([user?.name, ...(Array.isArray(user?.nameHistory) ? user.nameHistory : [])].filter(name => typeof name === 'string' && name))];
export function uniqueNameId(name, profiles) {
    const ids = [...new Set(profiles.filter(user => user.role !== 'removed' && profileNames(user).includes(name)).map(user => user.accountId))];
    return ids.length === 1 ? ids[0] : null;
}
export function roomIdentity(room, profiles, bindings = {}) {
    if (Array.isArray(room?.participantIds)) return { ids: [...new Set(room.participantIds)], unresolved: [], bindings: room.participantNameBindings || {} };
    const names = Array.isArray(room?.participants) ? [...new Set(room.participants)] : [];
    const result = Object.create(null), unresolved = [];
    for (const name of names) {
        if (Object.hasOwn(bindings,name) && bindings[name] === null) { result[name]=null; continue; }
        const id = Object.hasOwn(bindings,name) ? bindings[name] : uniqueNameId(name, profiles);
        if (id && profiles.some(user => user.accountId === id && user.role !== 'removed')) result[name] = id;
        else unresolved.push(name);
    }
    return { ids: [...new Set(Object.values(result).filter(Boolean))], unresolved, bindings: result };
}
export const roomHasMember = (room, accountId, profiles) => roomIdentity(room, profiles).ids.includes(accountId);
export const displayName = (id, profiles, fallback = '') => profiles.find(user => user.accountId === id)?.name || fallback || id;
export const creatorId = (room, profiles) => Object.hasOwn(room,'creatorAccountId') ? room.creatorAccountId : (Object.hasOwn(room.participantNameBindings || {},room.creator) ? room.participantNameBindings[room.creator] : uniqueNameId(room.creator, profiles));
export const senderId = (message, room, profiles) => message.isSystem ? null : message.senderAccountId || (Object.hasOwn(room?.participantNameBindings || {}, message.sender) ? room.participantNameBindings[message.sender] : uniqueNameId(message.sender, profiles));
function legacyValue(room, field, id, profiles) {
    const bindings = room.participantNameBindings || roomIdentity(room, profiles).bindings;
    return Math.max(0, ...Object.entries(room[field] || {}).filter(([name]) => bindings[name] === id).map(([, value]) => Number(value) || 0));
}
export const unreadFor = (room, id, profiles) => Object.hasOwn(room.unreadByAccount || {},id) ? Number(room.unreadByAccount[id]) || 0 : legacyValue(room, 'unreadCount', id, profiles);
export const readFor = (room, id, profiles) => Object.hasOwn(room.readByAccount || {},id) ? Number(room.readByAccount[id]) || 0 : legacyValue(room, 'readTimestamps', id, profiles);
export function roomIdentityPatch(room, profiles, bindings = {}) {
    const identity = roomIdentity(room, profiles, bindings);
    if ((!identity.ids.length && !Object.keys(bindings).length) || identity.unresolved.length) throw new Error('舊聊天室有無法辨識的成員，請管理者確認帳號對應。');
    const legacy={...room,participantNameBindings:identity.bindings};
    return {
        participantIds: identity.ids,
        participantNameBindings: identity.bindings,
        creatorAccountId: creatorId({...room,participantNameBindings:identity.bindings},profiles) || null,
        unreadByAccount: Object.fromEntries(identity.ids.map(id => [id, unreadFor(legacy, id, profiles)])),
        readByAccount: Object.fromEntries(identity.ids.map(id => [id, readFor(legacy, id, profiles)]))
    };
}
