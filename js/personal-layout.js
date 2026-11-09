import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// 個人設定依 accountId 保存；舊姓名文件僅在可證明歸屬時讀取，更名不搬移或刪除同名文件。
/**
 * 讀取以 accountId 為鍵的個人設定，必要時唯讀相容可證明歸屬的姓名文件。
 * @param {Object} db - Firestore 實例。
 * @param {Object} user - 含 accountId、name 的目前使用者。
 * @returns {Promise<Object>} 設定或空物件；不搬移、刪除同名歷史設定。
 */
export async function readPersonalLayout(db, user) {
    if (!user?.accountId) return {};
    const current = await getDoc(doc(db, 'userSettings', user.accountId));
    if (current.exists()) return current.data();
    if (!user.name || user.name === user.accountId) return {};
    const legacy = await getDoc(doc(db, 'userSettings', user.name));
    if (!legacy.exists()) return {};
    if (legacy.data().accountId) return legacy.data().accountId === user.accountId ? legacy.data() : {};
    const matches = await getDocs(query(collection(db, 'users'), where('name', '==', user.name)));
    return matches.docs.length === 1 && matches.docs[0].data().accountId === user.accountId ? legacy.data() : {};
}
