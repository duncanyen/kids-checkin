import { collection, doc, getDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Share only concurrent work, never keep a cross-page/account profile cache.
const pendingByDb = new WeakMap();
async function mapBatches(values, read) {
    const batches = [];
    for (let i = 0; i < values.length; i += 10) batches.push(values.slice(i, i + 10));
    const result = new Array(batches.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, batches.length) }, async () => {
        while (cursor < batches.length) {
            const index = cursor++;
            result[index] = await read(batches[index]);
        }
    }));
    return result.flat();
}

export function loadScopedProfiles(db, identifiers, { allowLegacyNames = true } = {}) {
    const ids = [...new Set((identifiers || []).filter(id => typeof id === 'string' && id))];
    let pending = pendingByDb.get(db);
    if (!pending) pendingByDb.set(db, pending = new Map());
    const key = JSON.stringify([ids, allowLegacyNames]);
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
        const read = field => async batch => {
            const snap = await getDocs(query(collection(db, 'users'), where(field, 'in', batch)));
            return snap.docs.map(row => ({ ...row.data(), docId: row.id }));
        };
        const accounts = await mapBatches(ids, read('accountId'));
        const found = new Set(accounts.map(profile => profile.accountId));
        const unresolved = ids.filter(id => !found.has(id));
        const legacy = allowLegacyNames ? await mapBatches(unresolved, read('name')) : [];
        // A name is not an identity. Ambiguous legacy names must not select a
        // random account (possibly in another group).
        const unresolvedNames = new Set(unresolved);
        const legacyCounts = new Map();
        legacy.forEach(profile => legacyCounts.set(profile.name, (legacyCounts.get(profile.name) || 0) + 1));
        const uniqueLegacy = legacy.filter(profile => unresolvedNames.has(profile.name) && legacyCounts.get(profile.name) === 1);
        const result = new Map();
        [...accounts, ...uniqueLegacy].forEach(profile => {
            const identity = profile.accountId || profile.docId;
            if (!result.has(identity)) result.set(identity, profile);
        });
        return [...result.values()];
    })();
    pending.set(key, work);
    work.then(() => pending.delete(key), () => pending.delete(key));
    return work;
}

export async function loadGroupProfiles(db, groupId, group) {
    if (!groupId) return [];
    if (!Array.isArray(group?.members)) {
        const snapshot = await getDoc(doc(db, 'groups', groupId));
        if (!snapshot.exists()) throw new Error('群組不存在或無權讀取');
        group = snapshot.data();
    }
    return loadScopedProfiles(db, group.members);
}

export function profileAvatarMap(profiles) {
    const result = Object.create(null);
    const nameCounts = new Map();
    profiles.forEach(profile => {
        nameCounts.set(profile.name, (nameCounts.get(profile.name) || 0) + 1);
        const avatar = profile.avatar || profile.photoURL || profile.avatarUrl || null;
        if (profile.accountId) result[profile.accountId] = avatar;
    });
    profiles.forEach(profile => {
        const avatar = profile.avatar || profile.photoURL || profile.avatarUrl || null;
        if (profile.name && !Object.hasOwn(result, profile.name) &&
            nameCounts.get(profile.name) === 1) result[profile.name] = avatar;
    });
    return result;
}
