import { doc, collection, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const WELCOME_ID = 'welcome-v1';
export const WELCOME_REWARD = Object.freeze({ coins: 1000, worms: 8, earthworms: 4 });
export const WELCOME_BODY = '歡迎加入咕咕村落，若您有任何疑問，歡迎隨時與我們連絡，感謝您的支持，祝您遊戲愉快';

export function visitorNotice(createdAt) {
    return { type: 'visitor', title: '訪客來訪', note: '訪客來偷蛋', createdAt, readAt: null };
}

export function formatMailTime(value) {
    const date = new Date(value?.toMillis?.() ?? value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * 建立單一玩家的農場通知存取與歡迎禮交易。
 * @param {Object} db - Firestore 實例。
 * @param {{groupId: string, accountId: string}} context - 通知子集合的擁有者。
 * @returns {Object} 通知訂閱、刪除及歡迎禮操作介面。
 * @description 建檔／領取收據與可刪除通知分開，刪信不可造成重複領取。
 */
export function createFarmMailStore(db, { groupId, accountId }) {
    const owner = doc(db, 'groups', groupId, 'users', accountId);
    const notices = collection(db, 'groups', groupId, 'users', accountId, 'farm_notifications');
    const noticeRef = id => {
        if (!id || id.includes('/')) throw new Error('通知資料無效');
        return doc(db, 'groups', groupId, 'users', accountId, 'farm_notifications', id);
    };
    async function readOwner(transaction) {
        const group = await transaction.get(doc(db, 'groups', groupId));
        if (!group.exists() || !group.data().members?.includes(accountId)) throw new Error('你已不在此群組，請重新登入');
        const snapshot = await transaction.get(owner);
        if (!snapshot.data()?.farm) throw new Error('農場尚未準備完成，請稍後再試');
        return snapshot.data();
    }
    return {
        ensureWelcome() {
            const now = Date.now();
            return runTransaction(db, async transaction => {
                const data = await readOwner(transaction);
                // 領取收據刻意與可刪除通知分開保存。
                if (data.farmMail?.welcomeCreatedAt || data.farmMail?.welcomeClaimedAt) return;
                transaction.set(noticeRef(WELCOME_ID), { type: 'system', title: '系統通知', body: WELCOME_BODY, reward: WELCOME_REWARD, createdAt: now, claimedAt: null, readAt: null });
                transaction.update(owner, { 'farmMail.welcomeCreatedAt': now });
            });
        },
        watch(receive, fail) {
            return onSnapshot(notices, snapshot => {
                const rows = [];
                snapshot.forEach(row => rows.push({ ...row.data(), id: row.id }));
                rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id));
                receive(rows);
            }, fail);
        },
        markRead(ids) {
            const unique = [...new Set(ids)];
            if (unique.length > 100) throw new Error('一次最多讀取 100 則通知');
            const now = Date.now();
            return runTransaction(db, async transaction => {
                await readOwner(transaction);
                const snapshots = await Promise.all(unique.map(id => transaction.get(noticeRef(id))));
                snapshots.forEach((snapshot, i) => {
                    if (snapshot.exists() && !snapshot.data().readAt) transaction.update(noticeRef(unique[i]), { readAt: now });
                });
                return now;
            });
        },
        claim(id) {
            if (id !== WELCOME_ID) throw new Error('此通知沒有可領取的獎勵');
            const now = Date.now();
            return runTransaction(db, async transaction => {
                const data = await readOwner(transaction);
                const ref = noticeRef(id), snapshot = await transaction.get(ref);
                if (!snapshot.exists()) throw new Error('通知已刪除，無法領取');
                if (data.farmMail?.welcomeClaimedAt || snapshot.data().claimedAt) return false;
                transaction.update(owner, {
                    'farm.coins': (data.farm.coins || 0) + WELCOME_REWARD.coins,
                    'farm.worms': (data.farm.worms || 0) + WELCOME_REWARD.worms,
                    'farm.earthworms': (data.farm.earthworms || 0) + WELCOME_REWARD.earthworms,
                    'farmMail.welcomeClaimedAt': now
                });
                transaction.update(ref, { claimedAt: now });
                return true;
            });
        },
        removeBatch(ids) {
            const unique = [...new Set(ids)];
            if (unique.length > 100) throw new Error('一次最多刪除 100 則通知');
            const refs = unique.map(noticeRef);
            return runTransaction(db, async transaction => {
                await readOwner(transaction);
                refs.forEach(ref => transaction.delete(ref));
            });
        },
        remove(id) {
            return runTransaction(db, async transaction => {
                await readOwner(transaction);
                transaction.delete(noticeRef(id));
            });
        }
    };
}
