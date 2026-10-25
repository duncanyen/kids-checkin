import { collection, doc, getDocs } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const normalizeAccountId = value => String(value ?? '').trim().toLowerCase();
export const ACCOUNT_ID_TAKEN = '此登入帳號 ID 已被使用（不分大小寫），請換一個！';

// Legacy users have randomly generated document IDs and mixed-case accountId values.
// Compare those values without rewriting IDs referenced by groups and module data.
export async function findAccountsById(db, accountId) {
    const key = normalizeAccountId(accountId);
    if (!key) return [];
    const users = await getDocs(collection(db, 'users'));
    return users.docs.filter(user => normalizeAccountId(user.data().accountId) === key);
}

// Both registration entry points use the same document path, so Firestore can
// serialize concurrent registrations even when their case differs.
export function newAccountRef(db, accountId) {
    const key = normalizeAccountId(accountId);
    if (!/^[a-z0-9_]+$/.test(key)) throw new Error('帳號 ID 只能包含英文、數字與底線！');
    return doc(db, 'users', `account_${key}`);
}
export async function assertAccountAvailable(transaction, ref) {
    if ((await transaction.get(ref)).exists()) throw new Error(ACCOUNT_ID_TAKEN);
}
