import { db } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// groups.members is authoritative: users.groupId describes only one group and
// cannot represent a person who has joined several groups.
export async function loadGameGroupMembers(groupId, accountId) {
    const ids = await getGameGroupMemberIds(groupId, accountId);
    const members = new Map();
    for (let start = 0; start < ids.length; start += 10) {
        const batch = ids.slice(start, start + 10);
        const profiles = await getDocs(query(collection(db, 'users'), where('accountId', 'in', batch)));
        profiles.forEach(snapshot => {
            const profile = snapshot.data();
            if (batch.includes(profile.accountId) && profile.role !== 'removed') members.set(profile.accountId, profile);
        });
    }
    return ids.map(id => members.get(id)).filter(Boolean);
}

async function getGameGroupMemberIds(groupId, accountId) {
    const group = await getDoc(doc(db, 'groups', groupId));
    if (!group.exists()) throw new Error('群組不存在，請返回首頁重新選擇。');
    const ids = [...new Set((group.data().members || []).filter(id => typeof id === 'string' && id))];
    if (!ids.includes(accountId)) throw new Error('你已不在此群組，請返回首頁重新選擇。');
    return ids;
}

export async function requireGameMembership(context) {
    try {
        await getGameGroupMemberIds(context.groupId, context.accountId);
    } catch (error) {
        alert(error.message || '無法確認群組成員，請稍後重新進入遊戲區。');
        window.location.replace('index.html');
        throw error;
    }
}
