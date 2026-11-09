import { db } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// 以 groups.members 為依據；users.groupId 無法代表同時加入多個群組的完整資格。
/**
 * 先確認目前帳號仍在 groups.members，再分批讀取該群組的有效 users。
 * @param {string} groupId - 所選群組 ID。
 * @param {string} accountId - 必須屬於該群組的目前帳號。
 * @param {Object} [options] - includeDocumentIds 控制是否包含 users 文件 ID。
 * @returns {Promise<Array<Object>>} 按 members 順序排列、排除 removed 的成員。
 * @throws {Error} 群組不存在或目前帳號已離開；前端檢查仍須搭配後端／Rules。
 */
export async function loadGameGroupMembers(groupId, accountId, { includeDocumentIds = false } = {}) {
    const ids = await getGameGroupMemberIds(groupId, accountId);
    const members = new Map();
    for (let start = 0; start < ids.length; start += 10) {
        const batch = ids.slice(start, start + 10);
        const profiles = await getDocs(query(collection(db, 'users'), where('accountId', 'in', batch)));
        profiles.forEach(snapshot => {
            const profile = snapshot.data();
            if (batch.includes(profile.accountId) && profile.role !== 'removed') members.set(profile.accountId, includeDocumentIds ? { ...profile, docId: snapshot.id } : profile);
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
        alert(error.message || '無法確認群組成員，請稍後重新進入遊戲大廳。');
        window.location.replace('index.html');
        throw error;
    }
}
