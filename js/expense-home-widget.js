/** 首頁記帳統計：依帳號偏好訂閱群組或個人帳，清理可取消尚未完成的連線。 */
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { personalLedgerDatabase, readLedgerPreferences } from './personal-ledger.js';

export function watchExpenseWidget({ db, user, groupId, onValue, onError }) {
    let active = true, unsubscribe;
    void (async () => {
        const preferences = await readLedgerPreferences(user, groupId);
        if (!active) return;
        const personal = preferences.homepageSource === 'personal';
        const database = personal ? await personalLedgerDatabase(user, groupId) : db;
        if (!active) return;
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const source = personal ? collection(database, 'personalLedgers', user.accountId, 'expenses') : collection(db, 'expenses');
        const filters = personal ? [] : [where('groupId', '==', groupId)];
        unsubscribe = onSnapshot(query(source, ...filters, where('date', '>=', month + '-01'), where('date', '<=', month + '-31')), snapshot => {
            if (!active) return;
            let total = 0;
            snapshot.forEach(row => {
                const data = row.data(), type = String(data.type || 'expense');
                if (['expense', '支出', 'undefined'].includes(type)) total += Number(data.amount || data.price || 0);
            });
            onValue(total, personal ? '個人帳' : '群組帳');
        }, error => { if (active) onError(error); });
    })().catch(error => { if (active) onError(error); });
    return () => { active = false; unsubscribe?.(); };
}
