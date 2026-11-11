/**
 * 個人記帳使用獨立 Firebase App 的 Auth，避免改變 Nexus 既有 SDK 工作階段。
 * accountId 必須由 photoSession 在伺服器驗證；Firestore Rules 才是資料隔離邊界。
 * 模組只快取本頁連線，不將記帳內容或登入 Token 寫入瀏覽器儲存空間。
 */
import { firebaseConfig } from './firebase-config.js';
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, inMemoryPersistence, setPersistence, signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const DEFAULT_LEDGER_PREFERENCES = Object.freeze({ defaultMode: 'group', homepageSource: 'group' });
export const normalizeLedgerPreferences = value => ({
    defaultMode: value?.defaultMode === 'personal' ? 'personal' : 'group',
    homepageSource: value?.homepageSource === 'personal' ? 'personal' : 'group'
});
const connections = new Map();
function checkAccount(user) {
    const current = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null');
    if (!user?.accountId || current?.accountId !== user.accountId) throw Error('帳號已變更，請重新進入記帳本。');
}

/** 取得由舊制帳號橋接驗證的私有 Firestore；跨群組仍使用同一 accountId。 */
export async function personalLedgerDatabase(user, groupId) {
    checkAccount(user);
    const key = `${user.accountId}:${groupId}`;
    if (!connections.has(key)) connections.set(key, (async () => {
        const name = 'nexus-personal-ledger';
        const app = getApps().find(item => item.name === name) || initializeApp(firebaseConfig, name);
        const auth = getAuth(app);
        await setPersistence(auth, inMemoryPersistence);
        const session = await httpsCallable(getFunctions(app, 'asia-southeast1'), 'photoSession', { timeout: 12000 })({
            accountId: user.accountId, groupId, secret: user.password || user.pin || ''
        });
        checkAccount(user);
        await signInWithCustomToken(auth, session.data.token);
        return getFirestore(app);
    })().catch(error => { connections.delete(key); throw error; }));
    const database = await connections.get(key);
    checkAccount(user);
    return database;
}

export async function readLedgerPreferences(user, groupId) {
    const database = await personalLedgerDatabase(user, groupId);
    const snapshot = await getDoc(doc(database, 'personalLedgers', user.accountId));
    checkAccount(user);
    return normalizeLedgerPreferences(snapshot.exists() ? snapshot.data() : null);
}

export async function saveLedgerPreferences(user, groupId, preferences) {
    const database = await personalLedgerDatabase(user, groupId);
    const value = normalizeLedgerPreferences(preferences);
    checkAccount(user);
    await setDoc(doc(database, 'personalLedgers', user.accountId), value, { merge: true });
    return value;
}
