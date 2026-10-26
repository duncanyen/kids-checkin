import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, setPersistence, inMemoryPersistence, signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { getDatabase, ref, get, onValue, query, orderByChild, limitToLast } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { REALTIME_REGION } from './live-read-config.js';
const app = getApps().find(app => app.name === 'nexus-live') || initializeApp(firebaseConfig, 'nexus-live');
const auth = getAuth(app), database = getDatabase(app), functions = getFunctions(app, REALTIME_REGION);
let session;
let authQueue = Promise.resolve();
export async function connect(context) {
    const identity = JSON.stringify([context.groupId, context.accountId]);
    if (session?.identity === identity) return session.promise;
    const promise = authQueue.catch(() => {}).then(async () => {
        const user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null');
        if (user?.accountId !== context.accountId) throw Object.assign(new Error('請重新登入'), { code: 'unauthenticated' });
        const response = await httpsCallable(functions, 'liveSession')({ accountId: context.accountId, groupId: context.groupId, secret: user.password || user.pin || '' });
        await setPersistence(auth, inMemoryPersistence);
        await signInWithCustomToken(auth, response.data.token);
        const status = (await get(ref(database, 'nexus/status'))).val() || {};
        return {
            ready: status,
            listen(path, { list, limit }, next, error) {
                let target = ref(database, `nexus/${path}`);
                if (list) target = limit ? query(target, orderByChild('sortTime'), limitToLast(limit)) : query(target, orderByChild('sortTime'));
                return onValue(target, snapshot => next(snapshot.val()), error);
            },
            async read(path) { return (await get(ref(database, `nexus/${path}`))).val(); }
        };
    });
    authQueue = promise;
    session = { identity, promise };
    promise.catch(() => { if (session?.promise === promise) session = null; });
    return promise;
}
