import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, setPersistence, inMemoryPersistence, signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { getStorage, ref, uploadString, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';
import { firebaseConfig } from './firebase-config.js';

const app = getApps().find(app => app.name === 'nexus-photos') || initializeApp(firebaseConfig, 'nexus-photos');
const auth = getAuth(app), storage = getStorage(app);
let session;
async function authenticate(user, groupId) {
    if (!user?.accountId || !groupId || groupId.includes('/')) throw new Error('請重新登入並選擇群組。');
    const identity = JSON.stringify([groupId, user.accountId]);
    if (session?.identity !== identity) {
        const promise = (session?.promise || Promise.resolve()).catch(() => {}).then(async () => {
            const result = await httpsCallable(getFunctions(app, 'asia-southeast1'), 'photoSession')({
                accountId: user.accountId, groupId, secret: user.password || user.pin || ''
            });
            await setPersistence(auth, inMemoryPersistence);
            return (await signInWithCustomToken(auth, result.data.token)).user;
        });
        session = { identity, promise };
        promise.catch(() => { if (session?.promise === promise) session = null; });
    }
    return session.promise;
}

export async function removePhotoFiles(paths, user, groupId) {
    if (!paths?.length) return [];
    await authenticate(user, groupId);
    const prefix = `photo-dump/${groupId}/`;
    return Promise.allSettled(paths.map(async path => {
        if (typeof path !== 'string' || !path.startsWith(prefix) || path.split('/').length !== 5) throw new Error('照片路徑不符群組。');
        try { await deleteObject(ref(storage, path)); }
        catch (error) { if (error.code !== 'storage/object-not-found') throw error; }
    }));
}

export async function uploadPhotoPost({ images, user, groupId, postId, save, progress = () => {} }) {
    if (!images.length || images.length > 5) throw new Error('請選擇 1 至 5 張照片。');
    const owner = await authenticate(user, groupId);
    const storagePaths = [], imageUrls = [];
    try {
        for (let i = 0; i < images.length; i++) {
            progress(i + 1, images.length);
            const path = `photo-dump/${groupId}/${owner.uid}/${postId}/${crypto.randomUUID()}.jpg`;
            const target = ref(storage, path);
            await uploadString(target, images[i], 'data_url', { contentType: 'image/jpeg' });
            storagePaths.push(path);
            imageUrls.push(await getDownloadURL(target));
        }
        await save({ imageUrls, storagePaths, storageProvider: 'firebase', uploaderAccountId: user.accountId, uploaderUid: owner.uid });
    } catch (error) {
        // Remove already uploaded files when another upload or the post write fails.
        try {
            const results = await removePhotoFiles(storagePaths, user, groupId);
            if (results.some(result => result.status === 'rejected')) console.warn('部分未發佈照片尚未清理。');
        } catch { console.warn('未發佈照片清理失敗。'); }
        throw error;
    }
}
