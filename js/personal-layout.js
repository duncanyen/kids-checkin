import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Current preferences are account keyed; only read an old name key if its owner
// can be proved. Never move/delete name-keyed documents when a person is renamed.
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
