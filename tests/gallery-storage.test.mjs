import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

async function fixture() {
    const events = [], state = { failAt: null };
    globalThis.__photoStorageTest = { events, state };
    const source = readFileSync(new URL('../js/gallery-storage.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
    const mock = `
      const {events,state}=globalThis.__photoStorageTest;
      const firebaseConfig={},getApps=()=>[],initializeApp=()=>({}),getAuth=()=>({}),getStorage=()=>({}),getFunctions=()=>({});
      const inMemoryPersistence={},setPersistence=async()=>{},signInWithCustomToken=async()=>({user:{uid:'profile-1'}});
      const httpsCallable=()=>async data=>{events.push(['auth',data]);if(state.failAt==='auth')throw Object.assign(Error('denied'),{code:'functions/permission-denied'});return{data:{token:'test'}}};
      const ref=(_,path)=>path;
      const uploadString=async(path,data,format,metadata)=>{events.push(['upload',path,data,format,metadata]);if(state.failAt==='upload2'&&events.filter(e=>e[0]==='upload').length===2)throw Error('offline')};
      const getDownloadURL=async path=>{if(state.failAt==='url')throw Error('offline');return 'https://storage.test/'+path};
      const deleteObject=async path=>{events.push(['delete',path]);if(state.failAt==='missing')throw Object.assign(Error(),{code:'storage/object-not-found'})};
    `;
    const mod = await import('data:text/javascript;base64,' + Buffer.from(mock + source + `\n// ${Math.random()}`).toString('base64'));
    return { ...mod, events, state };
}
const user = { accountId: 'alice', password: 'test-secret' };
const options = { images: ['data:image/jpeg;base64,a', 'data:image/jpeg;base64,b'], user, groupId: 'group-a', postId: 'post1' };

test('uploads compressed photos to scoped Storage paths and saves stable account identity', async () => {
    const f = await fixture();
    let saved;
    await f.uploadPhotoPost({ ...options, save: async data => { saved = data; } });
    assert.equal(f.events.filter(e => e[0] === 'auth').length, 1);
    assert.equal(saved.imageUrls.length, 2);
    assert.equal(saved.uploaderAccountId, 'alice');
    assert.equal(saved.uploaderUid, 'profile-1');
    assert.equal(saved.storageProvider, 'firebase');
    assert.equal(new Set(saved.storagePaths).size, 2);
    assert.ok(saved.storagePaths.every(p => p.startsWith('photo-dump/group-a/profile-1/post1/')));
    assert.ok(f.events.filter(e => e[0] === 'upload').every(e => e[3] === 'data_url' && e[4].contentType === 'image/jpeg'));
});

test('cleans successful uploads on partial upload, URL lookup or post save failure', async () => {
    for (const failAt of ['upload2', 'url', 'save']) {
        const f = await fixture();
        f.state.failAt = failAt;
        await assert.rejects(f.uploadPhotoPost({ ...options, save: async () => { throw Error('save failed'); } }));
        assert.equal(f.events.filter(e => e[0] === 'delete').length, failAt === 'save' ? 2 : 1);
    }
});

test('legacy posts require no Storage auth; rejects foreign-group cleanup and unauthorized upload', async () => {
    const f = await fixture();
    assert.deepEqual(await f.removePhotoFiles(undefined, user, 'group-a'), []);
    assert.equal(f.events.length, 0);
    const results = await f.removePhotoFiles(['photo-dump/other/profile/post/file.jpg'], user, 'group-a');
    assert.equal(results[0].status, 'rejected');
    assert.equal(f.events.filter(e => e[0] === 'delete').length, 0);
    f.state.failAt = 'missing';
    assert.equal((await f.removePhotoFiles(['photo-dump/group-a/profile/post/file.jpg'], user, 'group-a'))[0].status, 'fulfilled');
    const denied = await fixture();
    denied.state.failAt = 'auth';
    await assert.rejects(denied.uploadPhotoPost({ ...options, save: async () => assert.fail() }));
    assert.equal(denied.events.filter(e => e[0] === 'upload').length, 0);
    await assert.rejects(f.uploadPhotoPost({ ...options, images: Array(6).fill('x') }));
});

test('photoSession verifies credentials and current membership without accessing RTDB', async () => {
    const source = readFileSync(new URL('../functions/index.cjs', import.meta.url), 'utf8');
    const state = { members: ['alice'], role: 'member', tokens: [] };
    class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const firestore = {
        collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ size: 1, docs: [{ id: 'profile-1', data: () => ({ accountId: 'alice', password: 'secret', role: state.role }) }] }) }) }) }),
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ members: state.members }) }) })
    };
    const exports = {};
    const modules = {
        'firebase-admin/app': { initializeApp() {} },
        'firebase-admin/firestore': { getFirestore: () => firestore },
        'firebase-admin/database': { getDatabase: () => assert.fail('Photo auth must not access RTDB') },
        'firebase-admin/auth': { getAuth: () => ({ createCustomToken: async (uid, claims) => { state.tokens.push({ uid, claims }); return 'token'; } }) },
        'firebase-functions/v2/firestore': { onDocumentWritten: () => null },
        'firebase-functions/v2/https': { onCall: (_, handler) => handler, HttpsError },
        'node:crypto': await import('node:crypto'),
        './live-model.cjs': { key: encodeURIComponent }, './mirror.cjs': () => assert.fail('No mirror')
    };
    vm.runInNewContext(source, { require: id => modules[id], exports, Buffer });
    const request = { data: { accountId: 'alice', groupId: 'group-a', secret: 'secret' } };
    assert.equal((await exports.photoSession(request)).token, 'token');
    assert.equal(state.tokens[0].uid, 'profile-1');
    assert.equal(state.tokens[0].claims.photoGroupId, 'group-a');
    assert.equal(state.tokens[0].claims.photoAccountId, 'alice');
    await assert.rejects(exports.photoSession({ data: { ...request.data, secret: 'wrong' } }), { code: 'unauthenticated' });
    state.members = [];
    await assert.rejects(exports.photoSession(request), { code: 'permission-denied' });
    state.members = ['alice']; state.role = 'removed';
    await assert.rejects(exports.photoSession(request), { code: 'unauthenticated' });
    assert.equal(state.tokens.length, 1);
});
