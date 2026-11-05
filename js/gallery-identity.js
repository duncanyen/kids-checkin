import { collection, getDocs, query, where, limit } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
const pending = new WeakMap();
export function loadPhotoAliases(db, user) {
    if (!user?.accountId) return Promise.reject(new Error('請重新登入。'));
    let cache = pending.get(db);
    if (!cache) pending.set(db, cache = new Map());
    const key = JSON.stringify([user.accountId, user.name]);
    if (!cache.has(key)) {
        const work = getDocs(query(collection(db, 'users'), where('accountId', '==', user.accountId), limit(2))).then(snapshot => {
            const profile = snapshot.docs.length === 1 ? snapshot.docs[0].data() : {};
            return [...new Set([user.name, ...(user.nameHistory || []), profile.name, ...(profile.nameHistory || [])].filter(Boolean))];
        });
        cache.set(key, work);
        work.then(() => cache.delete(key), () => cache.delete(key));
    }
    return cache.get(key);
}
