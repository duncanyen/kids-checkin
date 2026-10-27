import { doc, collection, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const WELCOME_ID = 'welcome-v1';
export const WELCOME_REWARD = Object.freeze({ coins: 1000, worms: 8, earthworms: 4 });
export const WELCOME_BODY = '歡迎加入咕咕村落，若您有任何疑問，歡迎隨時與我們連絡，感謝您的支持，祝您遊戲愉快';

export function visitorNotice(createdAt) {
    return { type: 'visitor', title: '訪客來訪', note: '訪客來偷蛋', createdAt };
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
                // This receipt is intentionally outside the deletable notification.
                if (data.farmMail?.welcomeCreatedAt || data.farmMail?.welcomeClaimedAt) return;
                transaction.set(noticeRef(WELCOME_ID), { type: 'system', title: '系統通知', body: WELCOME_BODY, reward: WELCOME_REWARD, createdAt: now, claimedAt: null });
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
        remove(id) {
            return runTransaction(db, async transaction => {
                await readOwner(transaction);
                transaction.delete(noticeRef(id));
            });
        }
    };
}
