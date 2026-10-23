import { db } from '../firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const isPublicVillage = group => group?.farmVillageVisibility === 'public';
export const villageTitle = group => `${group?.name || '未命名群組'}村落`;
export const villageTargetKey = (groupId, accountId) => encodeURIComponent(JSON.stringify([groupId, accountId])).replaceAll('.', '%2E');
export const filterVillages = (groups, text) => {
    const keyword = text.normalize('NFKC').trim().toLocaleLowerCase();
    return groups.filter(group => isPublicVillage(group) && villageTitle(group).normalize('NFKC').toLocaleLowerCase().includes(keyword));
};

// Read through the supplied transaction when mutating farms, so a concurrent
// privacy change causes a retry and is checked before any write can commit.
export async function readVillageAccess(visitorGroupId, targetGroupId, accountId, reader = getDoc, targetAccountId) {
    const own = await reader(doc(db, 'groups', visitorGroupId));
    if (!own.exists() || !(own.data().members || []).includes(accountId)) throw new Error('你已不在原群組，請重新選擇群組。');
    const target = visitorGroupId === targetGroupId ? own : await reader(doc(db, 'groups', targetGroupId));
    if (!target.exists()) throw new Error('村落不存在。');
    if (visitorGroupId !== targetGroupId && (!isPublicVillage(own.data()) || !isPublicVillage(target.data()))) {
        throw new Error('村落已封閉，無法跨群組拜訪。');
    }
    if (targetAccountId && !(target.data().members || []).includes(targetAccountId)) throw new Error('這位成員已離開村落。');
    return { ...target.data(), id: targetGroupId };
}

export async function listPublicVillages(excludeGroupId) {
    const snapshot = await getDocs(query(collection(db, 'groups'), where('farmVillageVisibility', '==', 'public')));
    const groups = [];
    snapshot.forEach(document => { if (document.id !== excludeGroupId && isPublicVillage(document.data())) groups.push({ ...document.data(), id: document.id }); });
    return groups.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hant') || a.id.localeCompare(b.id));
}

export async function loadVillageFarms(visitorGroupId, targetGroupId, accountId) {
    const group = await readVillageAccess(visitorGroupId, targetGroupId, accountId);
    const ids = [...new Set(group.members || [])].filter(id => typeof id === 'string' && (targetGroupId !== visitorGroupId || id !== accountId));
    const profiles = new Map();
    for (let offset = 0; offset < ids.length; offset += 10) {
        const batch = ids.slice(offset, offset + 10);
        const snapshot = await getDocs(query(collection(db, 'users'), where('accountId', 'in', batch)));
        snapshot.forEach(document => {
            const data = document.data();
            if (batch.includes(data.accountId) && data.role !== 'removed') profiles.set(data.accountId, data);
        });
    }
    const farms = await Promise.all(ids.filter(id => profiles.has(id)).map(async id => {
        const snapshot = await getDoc(doc(db, 'groups', targetGroupId, 'users', id));
        return snapshot.exists() && snapshot.data().farm ? { ...profiles.get(id), farm: snapshot.data().farm } : null;
    }));
    return { group, farms: farms.filter(Boolean) };
}
