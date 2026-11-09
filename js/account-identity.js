import { collection, doc, getDocs } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const normalizeAccountId = value => String(value ?? '').trim().toLowerCase();
export const ACCOUNT_ID_TAKEN = '此登入帳號 ID 已被使用（不分大小寫），請換一個！';

// 舊 users 文件 ID 與帳號大小寫不一致；比對時保留既有群組與模組參照。
/**
 * 對歷史隨機文件 ID 的帳號做不分大小寫比對，不改寫既有資料關聯。
 * @param {Object} db - Firestore 實例。
 * @param {string} accountId - 欲查詢的登入帳號。
 * @returns {Promise<Array<Object>>} 相符的文件快照；可能多筆，呼叫端須拒絕歧義。
 * @description 目前會讀取 users 全集合；這是相容舊資料的成本，並非索引查詢。
 */
export async function findAccountsById(db, accountId) {
    const key = normalizeAccountId(accountId);
    if (!key) return [];
    const users = await getDocs(collection(db, 'users'));
    return users.docs.filter(user => normalizeAccountId(user.data().accountId) === key);
}

// 兩個註冊入口共用固定文件鍵，讓大小寫不同的並行註冊也能由交易協調。
/**
 * 取得正規化帳號的固定新文件路徑，供註冊交易協調並行建立。
 * @param {Object} db - Firestore 實例。
 * @param {string} accountId - 僅接受英文、數字及底線的帳號。
 * @returns {Object} users/account_{正規化帳號} 的 DocumentReference。
 * @throws {Error} 帳號格式無效。
 */
export function newAccountRef(db, accountId) {
    const key = normalizeAccountId(accountId);
    if (!/^[a-z0-9_]+$/.test(key)) throw new Error('帳號 ID 只能包含英文、數字與底線！');
    return doc(db, 'users', `account_${key}`);
}
export async function assertAccountAvailable(transaction, ref) {
    if ((await transaction.get(ref)).exists()) throw new Error(ACCOUNT_ID_TAKEN);
}
